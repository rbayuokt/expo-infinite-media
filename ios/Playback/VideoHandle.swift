import AVFoundation

protocol VideoHandleDelegate: AnyObject {
  func handle(_ handle: VideoHandle, didChange state: PlaybackState)
  func handle(_ handle: VideoHandle, didFail error: MediaError)
  func handleDidStall(_ handle: VideoHandle)
}

/**
 One pooled player bound to one item for as long as the item is current or prepared.
 Main thread only. Every observer lives here and dies in `release()`.
 */
final class VideoHandle {
  let item: NativeItem
  let player: AVPlayer
  let generation: UInt64
  weak var delegate: VideoHandleDelegate?

  private(set) var state: PlaybackState = .idle
  private(set) var fromCache = false
  var isCurrent = false {
    didSet { playerItem?.preferredForwardBufferDuration = isCurrent ? Self.currentBuffer : Self.preparedBuffer }
  }
  var loop = true
  var attempt = 0
  var evictedForCorruption = false
  var firstFrameRendered = false
  var firstFrameEmitted = false
  var becameCurrentAt: CFTimeInterval = 0
  /** Play as soon as the item is ready. */
  private(set) var wantsPlay = false
  private var playerItem: AVPlayerItem?
  private var seekInFlight = false
  private var pendingSeek: (seconds: Double, precise: Bool)?
  private var observations: [NSKeyValueObservation] = []
  private var tokens: [NSObjectProtocol] = []

  static var liveObservers = 0
  /**
   Left to AVFoundation, the current item reads as far ahead as it likes, which on a feed
   means pulling whole files while the next posts are still preloading. Media3 caps its
   players at 30 s, so iOS matches it.
   */
  private static let currentBuffer: TimeInterval = 30
  private static let preparedBuffer: TimeInterval = 2

  init(item: NativeItem, player: AVPlayer, generation: UInt64) {
    self.item = item
    self.player = player
    self.generation = generation
  }

  func prepare() {
    transition(.bind)
    transition(.prepare)
    load()
  }

  func play() {
    wantsPlay = true
    switch state {
    case .ready, .paused:
      player.play()
      transition(.play)
    case .ended:
      player.seek(to: .zero)
      player.play()
      transition(.play)
    default:
      break
    }
  }

  func pause() {
    wantsPlay = false
    player.pause()
    transition(.pause)
  }

  func setMuted(_ muted: Bool) { player.isMuted = muted }

  /**
   Precise seeks decode from the previous keyframe, which is far too much work to repeat
   while a finger is dragging. Scrubbing asks for a tolerant seek, and only one seek is ever
   in flight: later requests replace the pending one instead of queueing behind it.
   */
  func seek(to seconds: Double, precise: Bool = true) {
    guard playerItem != nil else { return }
    if seekInFlight {
      pendingSeek = (seconds, precise)
      return
    }
    performSeek(seconds, precise)
  }

  private func performSeek(_ seconds: Double, _ precise: Bool) {
    let time = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
    let tolerance = precise ? CMTime.zero : CMTime(seconds: 0.4, preferredTimescale: 600)
    seekInFlight = true
    player.seek(to: time, toleranceBefore: tolerance, toleranceAfter: tolerance) { [weak self] _ in
      guard let self else { return }
      self.seekInFlight = false
      guard let next = self.pendingSeek else { return }
      self.pendingSeek = nil
      self.performSeek(next.seconds, next.precise)
    }
    if state == .ended { transition(wantsPlay ? .play : .pause) }
  }

  func retry() {
    guard state == .error else { return }
    teardownItem()
    transition(.retry)
    load()
  }

  func release() {
    guard state != .releasing else { return }
    pendingSeek = nil
    transition(.release)
    teardownItem()
    player.pause()
    transition(.released)
  }

  /** Seconds buffered ahead of the playhead. */
  var bufferedAhead: Double {
    guard let item = playerItem else { return 0 }
    let now = item.currentTime()
    for value in item.loadedTimeRanges {
      let range = value.timeRangeValue
      if range.containsTime(now) || range.start == now { return CMTimeGetSeconds(CMTimeRangeGetEnd(range) - now) }
    }
    return 0
  }

  var remaining: Double {
    guard let item = playerItem else { return 0 }
    let d = CMTimeGetSeconds(item.duration)
    return d.isFinite ? max(0, d - CMTimeGetSeconds(item.currentTime())) : .infinity
  }

  var progress: (position: Double, duration: Double, buffered: Double)? {
    guard let item = playerItem else { return nil }
    let position = CMTimeGetSeconds(item.currentTime())
    let duration = CMTimeGetSeconds(item.duration)
    return (position.isFinite ? position : 0, duration.isFinite ? duration : 0, (position.isFinite ? position : 0) + bufferedAhead)
  }

  var accessLogDroppedFrames: Int {
    playerItem?.accessLog()?.events.reduce(0) { $0 + max(0, $1.numberOfDroppedVideoFrames) } ?? 0
  }

  // MARK: - Private

  private func transition(_ event: PlaybackEvent) {
    guard let next = PlaybackStateMachine.next(state, event) else {
      Log.debug("ignored \(event) in \(state) for \(item.id)")
      return
    }
    guard next != state else { return }
    state = next
    delegate?.handle(self, didChange: next)
  }

  private func load() {
    guard let made = VideoCache.shared.makeAsset(for: item) else {
      fail(MediaError(code: "SOURCE_NOT_FOUND", message: "invalid uri", retryable: false))
      return
    }
    fromCache = made.fromCache
    let item = AVPlayerItem(asset: made.asset)
    item.preferredForwardBufferDuration = isCurrent ? Self.currentBuffer : Self.preparedBuffer
    playerItem = item
    observe(item)
    player.replaceCurrentItem(with: item)
  }

  private func observe(_ item: AVPlayerItem) {
    observations.append(item.observe(\.status, options: [.new]) { [weak self] item, _ in
      DispatchQueue.main.async { self?.statusChanged(item) }
    })
    observations.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
      DispatchQueue.main.async { self?.timeControlChanged(player) }
    })
    let center = NotificationCenter.default
    tokens.append(center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
      self?.didEnd()
    })
    tokens.append(center.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main) { [weak self] note in
      self?.fail(MediaError.from(note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error))
    })
    tokens.append(center.addObserver(forName: AVPlayerItem.playbackStalledNotification, object: item, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.delegate?.handleDidStall(self)
    })
    Self.liveObservers += observations.count + tokens.count
  }

  private func teardownItem() {
    Self.liveObservers -= observations.count + tokens.count
    observations.forEach { $0.invalidate() }
    observations.removeAll()
    tokens.forEach { NotificationCenter.default.removeObserver($0) }
    tokens.removeAll()
    if let playerItem { playerItem.asset.cancelLoading() }
    playerItem = nil
    player.replaceCurrentItem(with: nil)
  }

  /** KVO can deliver after the item was swapped, so check it's still ours. */
  private func isCurrentItem(_ item: AVPlayerItem) -> Bool {
    state != .releasing && playerItem === item && player.currentItem === item
  }

  private func statusChanged(_ item: AVPlayerItem) {
    guard isCurrentItem(item) else { return }
    switch item.status {
    case .readyToPlay:
      guard state == .preparing else { return }
      transition(.ready)
      if wantsPlay {
        player.play()
        transition(.play)
      }
    case .failed:
      fail(MediaError.from(item.error))
    default:
      break
    }
  }

  private func timeControlChanged(_ player: AVPlayer) {
    guard let item = playerItem, isCurrentItem(item) else { return }
    switch player.timeControlStatus {
    case .waitingToPlayAtSpecifiedRate:
      // Only starvation counts. The player also waits here while it primes at play(),
      // which on a prepared item is a few milliseconds with a full buffer behind it.
      if state == .playing && player.reasonForWaitingToPlay == .toMinimizeStalls {
        transition(.bufferStart)
      }
    case .playing:
      if state == .buffering { transition(.bufferEnd) }
    default:
      break
    }
  }

  private func didEnd() {
    guard state == .playing || state == .buffering else { return }
    transition(.ended)
    if loop && wantsPlay {
      player.seek(to: .zero)
      player.play()
      transition(.play)
    }
  }

  private func fail(_ mapped: MediaError) {
    guard state != .error, state != .releasing else { return }
    var error = mapped
    if error.httpStatus == nil, let status = VideoCache.shared.lastHTTPFailure(item.key) {
      error = MediaError.http(status, native: mapped.nativeCode)
    }
    player.pause()
    transition(.fail)
    delegate?.handle(self, didFail: error)
  }
}

import AVFoundation
import ExpoModulesCore
import UIKit

/**
 One per mounted feed. Owns the item list, the slots on screen, which item is current, and the
 handles (pooled players) for current and prepared items. Main thread only.
 */
final class FeedSession: SharedObject {
  private(set) var items: [NativeItem] = []
  private var indexById: [String: Int] = [:]
  private(set) var config = SessionConfig()
  var activeSeq = 0

  private let slots = NSHashTable<MediaSlotView>.weakObjects()
  private let visibility = VisibilityTracker()
  private(set) var currentId: String?
  private var landingIndex: Int?
  private var handles: [String: VideoHandle] = [:]
  /** Speculative items that failed. They're retried only once they become current. */
  private var failedSpeculative: Set<String> = []
  private var imageTokens: [String: Int] = [:]
  private var preloadKeys: Set<String> = []
  private var imageAttempts: [String: Int] = [:]
  private var userPaused = false
  private var released = false

  private var bufferHealthy = true
  private var healthySince: CFTimeInterval = 0
  private var healthTimer: Timer?
  private var progressObserver: (player: AVPlayer, token: Any)?
  private var retryWork: DispatchWorkItem?
  /** Current item and handle generation to resume after background or an interruption. */
  private var resumeToken: (id: String, generation: UInt64)?

  let metrics = SessionMetrics()
  private var metricsTimer: Timer?

  /** Read-ahead is held above this many seconds of buffer, and let go below the lower one. */
  private static let readAheadHigh: Double = 25
  private static let readAheadLow: Double = 12

  private var coordinator: Coordinator { .shared }
  private var focused: Bool { coordinator.isFocused(self) }

  /** Built on the JS thread. Everything after this runs on main. */
  override init() {
    super.init()
    visibility.onScroll = { [weak self] in self?.evaluateVisibility() }
    DispatchQueue.main.async { Coordinator.shared.add(self) }
  }

  override func sharedObjectWillRelease() {
    DispatchQueue.main.async { self.teardown() }
  }

  // MARK: - JS API

  func setItems(_ next: [NativeItem]) {
    items = next
    rebuildIndex()
    // A handle survives only if its item is unchanged, so the current video keeps playing.
    handles.filter { id, handle in item(id) != handle.item }.map(\.key).forEach(releaseHandle)
    if let id = currentId, indexById[id] == nil {
      stopProgress()
      currentId = nil
    }
    for slot in slots.allObjects where slot.boundItem != slot.itemId.flatMap(item) { bind(slot) }
    replan()
    evaluateVisibility()
  }

  func appendItems(_ more: [NativeItem]) {
    let start = items.count
    items.append(contentsOf: more)
    for (offset, item) in more.enumerated() where indexById[item.id] == nil {
      indexById[item.id] = start + offset
    }
    // Only slots that registered before their item arrived need binding.
    for slot in slots.allObjects where slot.generation == 0 { bind(slot) }
    replan()
    evaluateVisibility()
  }

  func setConfig(_ next: SessionConfig) {
    let old = config
    config = next
    if old.active != next.active || activeSeq == 0 && next.active {
      coordinator.setActive(self, next.active)
    }
    if let handle = currentHandle {
      handle.loop = next.loop
      if old.muted != next.muted { applyAudio(handle) }
      if !old.autoplay && next.autoplay && !userPaused && focused { handle.play() }
    }
    for handle in handles.values { handle.loop = next.loop }
    if old.progressInterval != next.progressInterval { restartProgress() }
    if old.diagnostics != next.diagnostics { restartMetrics() }
    replan()
  }

  func play() {
    userPaused = false
    guard focused, coordinator.foreground else { return }
    if let handle = currentHandle {
      applyAudio(handle)
      handle.play()
    }
  }

  func pause() {
    userPaused = true
    resumeToken = nil
    currentHandle?.pause()
  }

  func seek(to seconds: Double, precise: Bool) { currentHandle?.seek(to: seconds, precise: precise) }

  func setMuted(_ muted: Bool) {
    config.muted = muted
    if let handle = currentHandle { applyAudio(handle) }
  }

  func retry() {
    guard let id = currentId, let item = item(id) else { return }
    retryWork?.cancel()
    if item.isVideo {
      failedSpeculative.remove(id)
      if let handle = handles[id] {
        handle.attempt = 0
        handle.retry()
      } else {
        replan()
      }
    } else {
      imageAttempts[id] = 0
      if let slot = slot(for: id) { bind(slot) }
    }
  }

  // MARK: - Lifecycle hooks from the coordinator

  func focusChanged(_ isFocused: Bool) {
    if isFocused {
      replanAndStart()
    } else {
      stopProgress()
      stopHealthTimer()
      Array(handles.keys).forEach(releaseHandle)
      cancelSpeculative()
    }
  }

  func appDidEnterBackground() {
    if let handle = currentHandle, handle.state == .playing || handle.state == .buffering {
      resumeToken = (handle.item.id, handle.generation)
    }
    currentHandle?.pause()
    cancelSpeculative()
  }

  func appWillEnterForeground() {
    let token = resumeToken
    resumeToken = nil
    replan()
    // Only the same item, still current, on the same handle. Never an older video.
    guard config.resumeOnForeground, focused, !userPaused, let token,
          let handle = currentHandle, handle.item.id == token.id, handle.generation == token.generation
    else { return }
    applyAudio(handle)
    handle.play()
  }

  func systemPause() {
    if let handle = currentHandle, handle.state == .playing || handle.state == .buffering {
      resumeToken = (handle.item.id, handle.generation)
      handle.pause()
    }
  }

  func systemResume() {
    let token = resumeToken
    resumeToken = nil
    guard focused, coordinator.foreground, !userPaused, let token, let handle = currentHandle,
          handle.item.id == token.id, handle.generation == token.generation else { return }
    applyAudio(handle)
    handle.play()
  }

  func networkRestored() {
    guard let handle = currentHandle, handle.state == .error else { return }
    handle.attempt = 0
    handle.retry()
  }

  // MARK: - Slots

  func register(_ slot: MediaSlotView) {
    slots.add(slot)
    if let sv = Self.scrollView(containing: slot) { visibility.attach(sv) }
    bind(slot)
    evaluateVisibility()
  }

  func unregister(_ slot: MediaSlotView) {
    slots.remove(slot)
    cancelImages(on: slot)
    slot.generation = 0
    slot.boundItem = nil
    slot.reset()
    if slots.count == 0 { visibility.detach() }
  }

  func slotDidLayout(_ slot: MediaSlotView) { evaluateVisibility() }

  func slotReadyForDisplay(_ slot: MediaSlotView) {
    guard let id = slot.itemId, let handle = handles[id], slot.playerLayer.player === handle.player,
          slot.playerLayer.isReadyForDisplay else { return }
    slot.showImageLayer(false, animated: true)
    handle.firstFrameRendered = true
    if handle.isCurrent { emitFirstFrame(handle) }
  }

  private func slot(for id: String) -> MediaSlotView? {
    slots.allObjects.first { $0.itemId == id }
  }

  /** Fresh generation, fresh visuals. Anything async started for the old binding is now stale. */
  private func bind(_ slot: MediaSlotView) {
    cancelImages(on: slot)
    slot.reset()
    guard let id = slot.itemId, let item = item(id) else {
      slot.generation = 0
      slot.boundItem = nil
      return
    }
    slot.generation = Generation.next()
    slot.boundItem = item
    slot.fullImageShown = false
    // The poster is small and lands first, whether it stands in for a video or a photo.
    if let poster = item.posterURL {
      loadImage(into: slot, key: "poster:" + item.key, url: poster, headers: item.headers, isPoster: true)
    }
    if item.isVideo {
      if let handle = handles[id] { slot.attach(handle.player) }
    } else if let url = item.url {
      loadImage(into: slot, key: item.key, url: url, headers: item.headers, isPoster: false)
    }
  }

  private func cancelImages(on slot: MediaSlotView) {
    if let token = slot.imageToken { ImagePipeline.shared.cancel(token) }
    if let token = slot.posterToken { ImagePipeline.shared.cancel(token) }
    slot.imageToken = nil
    slot.posterToken = nil
    slot.fullImageShown = false
  }

  private func loadImage(into slot: MediaSlotView, key: String, url: URL, headers: [String: String]?, isPoster: Bool) {
    let target = slot.pixelSize
    if let image = ImagePipeline.shared.cached(key, target) {
      if !isPoster || !slot.fullImageShown {
        slot.setImage(image, animated: false)
        slot.fullImageShown = slot.fullImageShown || !isPoster
      }
      return
    }
    let generation = slot.generation
    let id = slot.itemId
    let priority: Priority = id == currentId ? .p0 : .p1
    let token = ImagePipeline.shared.load(key: key, url: url, headers: headers, target: target, priority: priority) {
      [weak self, weak slot] result in
      guard let self, let slot, slot.generation == generation else { return }
      if isPoster { slot.posterToken = nil } else { slot.imageToken = nil }
      switch result {
      case .success(let image):
        // A poster that arrives after the photo is thrown away.
        guard !isPoster || !slot.fullImageShown else { return }
        slot.setImage(image, animated: true)
        if !isPoster { slot.fullImageShown = true }
      case .failure(let error):
        // A failed poster is not worth an error event, the real media is still coming.
        guard !isPoster, let id, let item = self.item(id), !item.isVideo else { return }
        self.imageFailed(id, error)
      }
    }
    if isPoster { slot.posterToken = token } else { slot.imageToken = token }
  }

  private func imageFailed(_ id: String, _ error: MediaError) {
    guard id == currentId else { return }
    let attempt = (imageAttempts[id] ?? 0) + 1
    imageAttempts[id] = attempt
    let willRetry = error.retryable && attempt <= 3
    emit(event: "error", arguments: error.payload(itemId: id, attempt: attempt, recoverable: willRetry))
    metrics.errors += 1
    guard willRetry else { return }
    scheduleRetry(attempt) { [weak self] in
      guard let self, self.currentId == id, let slot = self.slot(for: id) else { return }
      self.bind(slot)
    }
  }

  // MARK: - Visibility

  private func evaluateVisibility() {
    guard !released else { return }
    var best: (slot: MediaSlotView, fraction: CGFloat)?
    for slot in slots.allObjects where slot.generation != 0 {
      let f = visibility.fraction(of: slot)
      if f > (best?.fraction ?? 0) { best = (slot, f) }
    }
    guard let best, let id = best.slot.itemId, let index = indexById[id] else { return }
    var needsPlan = false
    if landingIndex != index {
      landingIndex = index
      needsPlan = true
    }
    if best.fraction >= 0.98 {
      visibility.settled()
      if id != currentId {
        becomeCurrent(id, index: index)
        return
      }
    }
    if needsPlan { replan() }
  }

  private func becomeCurrent(_ id: String, index: Int) {
    if let old = currentHandle {
      old.isCurrent = false
      old.pause()
      old.setMuted(true)
    }
    stopProgress()
    retryWork?.cancel()
    resumeToken = nil
    currentId = id
    userPaused = false
    failedSpeculative.remove(id)
    imageAttempts[id] = 0
    emit(event: "indexChange", arguments: ["index": index, "itemId": id] as [String: Any])
    replanAndStart()
  }

  /** replan() starts the current item itself when it had to create its handle. */
  private func replanAndStart() {
    let had = currentHandle != nil
    replan()
    if had { startCurrent() }
  }

  /** Hands the current item audio and playback if this session is allowed to play. */
  private func startCurrent() {
    guard let id = currentId, let item = item(id) else { return }
    if !item.isVideo {
      stopHealthTimer()
      return
    }
    guard focused, let handle = handles[id] else { return }
    handle.isCurrent = true
    handle.loop = config.loop
    handle.becameCurrentAt = CACurrentMediaTime()
    handle.firstFrameEmitted = false
    emitState(handle)
    if handle.firstFrameRendered { emitFirstFrame(handle) }
    if config.autoplay && !userPaused && coordinator.foreground {
      applyAudio(handle)
      handle.play()
    }
    restartProgress()
    startHealthTimer()
  }

  private func applyAudio(_ handle: VideoHandle) {
    for other in handles.values where other !== handle { other.setMuted(true) }
    guard handle.isCurrent else {
      handle.setMuted(true)
      return
    }
    coordinator.configureAudio(muted: config.muted)
    handle.setMuted(config.muted)
  }

  private var currentHandle: VideoHandle? { currentId.flatMap { handles[$0] } }

  // MARK: - Planning

  func replan() {
    guard !released else { return }
    guard focused, !items.isEmpty else {
      if !focused { Array(handles.keys).filter { $0 != currentId }.forEach(releaseHandle) }
      return
    }
    let currentIndex = currentId.flatMap { indexById[$0] }
    let anchor = landingIndex ?? currentIndex ?? 0
    let plan = PreloadPolicy.plan(PolicyInput(
      currentIndex: anchor,
      direction: visibility.direction,
      velocity: visibility.velocity,
      bufferHealthy: bufferHealthy,
      network: coordinator.foreground ? coordinator.network : .offline,
      memory: coordinator.memoryLevel,
      tier: DeviceProfile.tier,
      itemCount: items.count,
      ahead: config.preloadAhead,
      behind: config.preloadBehind
    ))

    // Players: the current item always keeps its handle, the plan decides the rest.
    var wanted: [(String, Bool)] = []
    if let id = currentId, let item = item(id), item.isVideo { wanted.append((id, true)) }
    for entry in plan.entries where entry.video == .play || entry.video == .prepare {
      let item = items[entry.index]
      guard item.isVideo, item.id != currentId, !failedSpeculative.contains(item.id) else { continue }
      wanted.append((item.id, false))
    }
    let wantedIds = Set(wanted.map(\.0))
    handles.keys.filter { !wantedIds.contains($0) }.forEach(releaseHandle)
    for (id, isCurrent) in wanted where handles[id] == nil {
      guard let item = item(id) else { continue }
      if isCurrent, handles.count >= PlayerPool.maxPlayers, let spare = handles.keys.first(where: { $0 != id }) {
        releaseHandle(spare)
      }
      guard let player = coordinator.pool.acquire() else { continue }
      let handle = VideoHandle(item: item, player: player, generation: Generation.next())
      handle.delegate = self
      handle.loop = config.loop
      handle.isCurrent = false
      handles[id] = handle
      handle.prepare()
      if let slot = slot(for: id) { slot.attach(player) }
      if isCurrent { startCurrent() }
    }

    var keepPreloads: Set<String> = []
    var keepImages: Set<String> = []
    var pinned: Set<String> = []
    for entry in plan.entries {
      let item = items[entry.index]
      let pri = Self.taskPriority(entry.priority)
      if entry.priority <= .p1 { pinned.insert(item.key) }
      if item.isVideo {
        if entry.video == .prepare || entry.video == .startup {
          keepPreloads.insert(item.key)
          VideoCache.shared.preload(item, bytes: Int64(plan.startupBytes), priority: pri)
        }
        if entry.video != .none, let poster = item.posterURL {
          keepImages.insert("poster:" + item.key)
          ImagePipeline.shared.prefetch(key: "poster:" + item.key, url: poster, headers: item.headers, priority: entry.priority)
        }
      } else if let url = item.url, entry.image != .none, entry.image != .display {
        keepImages.insert(item.key)
        ImagePipeline.shared.prefetch(key: item.key, url: url, headers: item.headers, priority: entry.priority)
        if entry.image == .decode, slot(for: item.id) == nil { warmDecode(item, url: url) }
      }
    }
    if let id = currentId, let item = item(id) {
      pinned.insert(item.key)
      keepImages.insert(item.key)
    }
    for key in preloadKeys.subtracting(keepPreloads) { VideoCache.shared.cancelPreload(key) }
    preloadKeys = keepPreloads
    ImagePipeline.shared.cancelPrefetches(except: keepImages)
    for (id, token) in imageTokens where !plan.entries.contains(where: { items[$0.index].id == id }) {
      ImagePipeline.shared.cancel(token)
      imageTokens.removeValue(forKey: id)
    }
    VideoCache.shared.setPinned(pinned)
  }

  /** Decodes an upcoming image at screen size before its slot mounts. */
  private func warmDecode(_ item: NativeItem, url: URL) {
    guard imageTokens[item.id] == nil else { return }
    let scale = UIScreen.main.scale
    let size = visibility.scrollView?.bounds.size ?? UIScreen.main.bounds.size
    let target = ImagePipeline.Target(width: Int(size.width * scale), height: Int(size.height * scale), cover: true)
    guard ImagePipeline.shared.cached(item.key, target) == nil else { return }
    imageTokens[item.id] = ImagePipeline.shared.load(key: item.key, url: url, headers: item.headers, target: target, priority: .p1) {
      [weak self] _ in self?.imageTokens.removeValue(forKey: item.id)
    }
  }

  private func cancelSpeculative() {
    for key in preloadKeys { VideoCache.shared.cancelPreload(key) }
    preloadKeys.removeAll()
    ImagePipeline.shared.cancelPrefetches(except: [])
    imageTokens.values.forEach { ImagePipeline.shared.cancel($0) }
    imageTokens.removeAll()
  }

  private func releaseHandle(_ id: String) {
    guard let handle = handles.removeValue(forKey: id) else { return }
    VideoCache.shared.setReadAheadPaused(handle.item.key, false)
    if handle.isCurrent { stopProgress() }
    if let slot = slot(for: id), slot.playerLayer.player === handle.player { slot.attach(nil) }
    handle.delegate = nil
    handle.release()
    coordinator.pool.release(handle.player)
  }

  // MARK: - Buffer health, progress, metrics

  private func startHealthTimer() {
    guard healthTimer == nil else { return }
    healthTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.sampleHealth() }
  }

  private func stopHealthTimer() {
    healthTimer?.invalidate()
    healthTimer = nil
  }

  private func sampleHealth() {
    guard let handle = currentHandle else { return }
    let now = CACurrentMediaTime()
    let stalled = handle.state == .buffering
    let ahead = handle.bufferedAhead
    // Hysteresis, so the gate doesn't flap once a second.
    if ahead > Self.readAheadHigh {
      VideoCache.shared.setReadAheadPaused(handle.item.key, true)
    } else if ahead < Self.readAheadLow {
      VideoCache.shared.setReadAheadPaused(handle.item.key, false)
    }
    let short = handle.state == .playing && ahead < 2 && handle.remaining > 2
    if stalled || short {
      healthySince = 0
      if bufferHealthy {
        bufferHealthy = false
        replan()
      }
    } else if !bufferHealthy {
      if healthySince == 0 { healthySince = now }
      if now - healthySince >= 5 {
        bufferHealthy = true
        replan()
      }
    }
    if config.diagnostics { metrics.droppedFrames = handle.accessLogDroppedFrames }
  }

  private func restartProgress() {
    stopProgress()
    guard config.progressInterval > 0, let handle = currentHandle, handle.isCurrent else { return }
    let interval = CMTime(value: CMTimeValue(config.progressInterval), timescale: 1000)
    let player = handle.player
    let id = handle.item.id
    let token = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self, weak handle] _ in
      guard let self, let handle, handle.state == .playing, let p = handle.progress else { return }
      self.emit(event: "progress", arguments: [
        "itemId": id, "position": p.position, "duration": p.duration, "buffered": p.buffered,
      ] as [String: Any])
    }
    progressObserver = (player, token)
  }

  private func stopProgress() {
    if let (player, token) = progressObserver { player.removeTimeObserver(token) }
    progressObserver = nil
  }

  private func restartMetrics() {
    metricsTimer?.invalidate()
    metricsTimer = nil
    guard config.diagnostics else { return }
    metricsTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
      guard let self else { return }
      let pool = self.coordinator.pool
      let payload = self.metrics.payload(
        cache: VideoCache.shared.snapshotStats(),
        playersActive: self.currentHandle?.state == .playing ? 1 : 0,
        playersPrepared: self.handles.values.filter { !$0.isCurrent && ($0.state == .ready || $0.state == .paused) }.count,
        playersTotal: pool.created,
        liveObservers: VideoHandle.liveObservers,
        liveSurfaces: MediaSlotView.live,
        memoryWarnings: self.coordinator.memoryWarnings
      )
      // Sizes read on the cache queues, off main.
      DispatchQueue.global(qos: .utility).async { [weak self] in
        var out = payload
        out["videoCacheBytes"] = VideoCache.shared.size()
        out["imageCacheBytes"] = ImagePipeline.shared.size()
        DispatchQueue.main.async { self?.emit(event: "metrics", arguments: out) }
      }
    }
  }

  // MARK: - Events and retries

  private func emitState(_ handle: VideoHandle) {
    guard handle.isCurrent, let name = PlaybackStateMachine.publicName(handle.state) else { return }
    emit(event: "playbackStateChange", arguments: ["itemId": handle.item.id, "state": name] as [String: Any])
  }

  private func emitFirstFrame(_ handle: VideoHandle) {
    guard !handle.firstFrameEmitted else { return }
    handle.firstFrameEmitted = true
    let ms = Int(max(0, CACurrentMediaTime() - handle.becameCurrentAt) * 1000)
    metrics.recordStartup(ms, fromCache: handle.fromCache)
    emit(event: "firstFrame", arguments: ["itemId": handle.item.id, "startupMs": ms, "fromCache": handle.fromCache] as [String: Any])
  }

  private func scheduleRetry(_ attempt: Int, _ body: @escaping () -> Void) {
    retryWork?.cancel()
    let delays = [0.5, 1.0, 2.0]
    let work = DispatchWorkItem(block: body)
    retryWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delays[min(attempt, delays.count) - 1], execute: work)
  }

  private func teardown() {
    guard !released else { return }
    released = true
    retryWork?.cancel()
    stopProgress()
    stopHealthTimer()
    metricsTimer?.invalidate()
    metricsTimer = nil
    Array(handles.keys).forEach(releaseHandle)
    cancelSpeculative()
    for slot in slots.allObjects {
      cancelImages(on: slot)
      slot.reset()
    }
    slots.removeAllObjects()
    visibility.detach()
    coordinator.remove(self)
  }

  // MARK: - Helpers

  private func item(_ id: String) -> NativeItem? { indexById[id].map { items[$0] } }

  private func rebuildIndex() {
    indexById.removeAll(keepingCapacity: true)
    for (i, item) in items.enumerated() where indexById[item.id] == nil { indexById[item.id] = i }
  }

  private static func taskPriority(_ p: Priority) -> Float {
    switch p {
    case .p0: return URLSessionTask.highPriority
    case .p1: return URLSessionTask.defaultPriority
    default: return URLSessionTask.lowPriority
    }
  }

  private static func scrollView(containing view: UIView) -> UIScrollView? {
    var v = view.superview
    while let current = v {
      if let sv = current as? UIScrollView { return sv }
      v = current.superview
    }
    return nil
  }
}

// MARK: - VideoHandleDelegate

extension FeedSession: VideoHandleDelegate {
  func handle(_ handle: VideoHandle, didChange state: PlaybackState) {
    guard handles[handle.item.id] === handle else { return }
    // Waiting before the first frame is startup, not a rebuffer.
    if handle.isCurrent {
      if state == .buffering && handle.firstFrameRendered { metrics.bufferStart() } else { metrics.bufferEnd() }
    }
    if state == .playing, handle.isCurrent { handle.attempt = 0 }
    emitState(handle)
  }

  func handle(_ handle: VideoHandle, didFail error: MediaError) {
    guard handles[handle.item.id] === handle else { return }
    let id = handle.item.id
    guard handle.isCurrent || id == currentId else {
      // Speculative work gets no retries.
      failedSpeculative.insert(id)
      releaseHandle(id)
      return
    }
    // Bytes from disk that won't decode: drop them and refetch once, silently.
    if handle.fromCache, !handle.evictedForCorruption, error.code == "DECODE_FAILED" || error.code == "UNSUPPORTED_FORMAT" {
      handle.evictedForCorruption = true
      VideoCache.shared.remove(handle.item.key)
      handle.retry()
      return
    }
    if error.code == "DECODER_INIT_FAILED" {
      handles.keys.filter { $0 != id }.forEach(releaseHandle)
    }
    handle.attempt += 1
    let attempt = handle.attempt
    let willRetry = error.retryable && attempt <= 3 && coordinator.network != .offline
    // Offline: networkRestored() retries it, so it's still recoverable.
    let offlineRetry = error.retryable && coordinator.network == .offline
    metrics.errors += 1
    emit(event: "error", arguments: error.payload(itemId: id, attempt: attempt, recoverable: willRetry || offlineRetry))
    guard willRetry else { return }
    let generation = handle.generation
    scheduleRetry(attempt) { [weak self] in
      guard let self, let h = self.handles[id], h.generation == generation, h.isCurrent else { return }
      h.retry()
    }
  }

  func handleDidStall(_ handle: VideoHandle) {
    guard handle.isCurrent, bufferHealthy else { return }
    bufferHealthy = false
    healthySince = 0
    replan()
  }
}

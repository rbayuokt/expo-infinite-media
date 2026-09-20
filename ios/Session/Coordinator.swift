import AVFoundation
import Network
import UIKit

/**
 Process-wide state every session reads: app state, network, memory, focus, the player pool
 and the audio session. Main thread only.
 */
final class Coordinator {
  static let shared = Coordinator()

  let pool = PlayerPool()
  private(set) var network: NetworkKind = .wifi
  private(set) var foreground = UIApplication.shared.applicationState != .background
  var mixWithOthers = false
  private(set) var memoryWarnings = 0

  private var memory: MemoryLevel = .normal
  private var thermalSerious = false
  private var lastWarning: CFTimeInterval = 0
  private var memoryDecay: DispatchWorkItem?
  private let sessions = NSHashTable<FeedSession>.weakObjects()
  private var activeSeq = 0
  private weak var focused: FeedSession?
  private let monitor = NWPathMonitor()
  private var audioCategory: AVAudioSession.Category?

  private init() {
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(memoryWarning), name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
    center.addObserver(self, selector: #selector(thermalChanged), name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
    center.addObserver(self, selector: #selector(interruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
    center.addObserver(self, selector: #selector(routeChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
    thermalSerious = ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue
    monitor.pathUpdateHandler = { [weak self] path in
      let kind: NetworkKind
      if path.status != .satisfied {
        kind = .offline
      } else if path.isConstrained {
        kind = .constrained
      } else if path.isExpensive || path.usesInterfaceType(.cellular) {
        kind = .cellular
      } else {
        kind = .wifi
      }
      DispatchQueue.main.async { self?.networkChanged(kind) }
    }
    monitor.start(queue: DispatchQueue(label: "expo.modules.infinitemedia.network"))
  }

  var memoryLevel: MemoryLevel {
    memory == .normal && thermalSerious ? .pressure : memory
  }

  // MARK: - Sessions and focus

  func add(_ session: FeedSession) { sessions.add(session) }

  func remove(_ session: FeedSession) {
    sessions.remove(session)
    if focused === session {
      focused = nil
      refocus()
    }
    if sessions.count == 0 { pool.drain() }
  }

  func isFocused(_ session: FeedSession) -> Bool { focused === session }

  func setActive(_ session: FeedSession, _ active: Bool) {
    if active {
      activeSeq += 1
      session.activeSeq = activeSeq
    } else {
      session.activeSeq = 0
    }
    refocus()
  }

  /** The most recently activated session owns playback. */
  private func refocus() {
    let next = sessions.allObjects.filter { $0.activeSeq > 0 }.max { $0.activeSeq < $1.activeSeq }
    guard next !== focused else { return }
    let old = focused
    focused = next
    old?.focusChanged(false)
    next?.focusChanged(true)
  }

  private func forEachSession(_ body: (FeedSession) -> Void) { sessions.allObjects.forEach(body) }

  // MARK: - App state (from module lifecycle hooks)

  func appDidEnterBackground() {
    foreground = false
    forEachSession { $0.appDidEnterBackground() }
  }

  func appWillEnterForeground() {
    foreground = true
    forEachSession { $0.appWillEnterForeground() }
  }

  // MARK: - Audio

  /** Muted feeds use ambient so they don't stop the user's music. */
  func configureAudio(muted: Bool) {
    let session = AVAudioSession.sharedInstance()
    let category: AVAudioSession.Category = muted ? .ambient : .playback
    let options: AVAudioSession.CategoryOptions = mixWithOthers || muted ? [.mixWithOthers] : []
    guard category != audioCategory || session.categoryOptions != options else { return }
    do {
      try session.setCategory(category, mode: .moviePlayback, options: options)
      try session.setActive(true)
      audioCategory = category
    } catch {
      Log.warn("audio session: \(error.localizedDescription)")
    }
  }

  @objc private func interruption(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    let resume: Bool
    if type == .ended, let optionsRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt {
      resume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume)
    } else {
      resume = false
    }
    DispatchQueue.main.async {
      if type == .began {
        self.audioCategory = nil
        self.focused?.systemPause()
      } else if resume {
        self.focused?.systemResume()
      }
    }
  }

  @objc private func routeChange(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
          AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
    // Headphones pulled: stay paused, like every other player.
    DispatchQueue.main.async { self.focused?.pause() }
  }

  // MARK: - Memory, thermal, network

  @objc private func memoryWarning() {
    let now = CACurrentMediaTime()
    memory = now - lastWarning < 10 ? .critical : .pressure
    lastWarning = now
    memoryWarnings += 1
    ImagePipeline.shared.trimMemory()
    pool.drain()
    memoryDecay?.cancel()
    let decay = DispatchWorkItem { [weak self] in
      self?.memory = .normal
      self?.forEachSession { $0.replan() }
    }
    memoryDecay = decay
    DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: decay)
    forEachSession { $0.replan() }
  }

  @objc private func thermalChanged() {
    let serious = ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue
    DispatchQueue.main.async {
      guard serious != self.thermalSerious else { return }
      self.thermalSerious = serious
      self.forEachSession { $0.replan() }
    }
  }

  private func networkChanged(_ kind: NetworkKind) {
    guard kind != network else { return }
    let wasOffline = network == .offline
    network = kind
    forEachSession {
      $0.replan()
      if wasOffline { $0.networkRestored() }
    }
  }
}

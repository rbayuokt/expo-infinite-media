import Foundation

// Pure. Mirrored in android/.../core/PlaybackStateMachine.kt.

enum PlaybackState: String {
  case idle, poster, preparing, ready, playing, paused, buffering, ended, error, releasing
}

enum PlaybackEvent {
  case bind, prepare, ready, play, pause, bufferStart, bufferEnd, ended, fail, retry, release, released
}

enum PlaybackStateMachine {
  /** nil means the move is illegal and the caller must ignore the event. */
  static func next(_ from: PlaybackState, _ event: PlaybackEvent) -> PlaybackState? {
    if from == .releasing { return event == .released ? .idle : nil }
    if event == .release { return from == .idle ? nil : .releasing }
    if event == .fail { return from == .idle || from == .error ? nil : .error }

    switch (from, event) {
    case (.idle, .bind): return .poster
    case (.poster, .prepare): return .preparing
    case (.preparing, .ready): return .ready
    case (.ready, .play), (.paused, .play), (.ended, .play), (.buffering, .bufferEnd): return .playing
    case (.playing, .pause), (.buffering, .pause), (.ready, .pause): return .paused
    case (.playing, .bufferStart): return .buffering
    case (.playing, .ended), (.buffering, .ended): return .ended
    case (.error, .retry): return .preparing
    default: return nil
    }
  }

  /** States shown to JS. releasing stays internal. */
  static func publicName(_ state: PlaybackState) -> String? {
    state == .releasing ? nil : state.rawValue
  }
}

package expo.modules.infinitemedia.core

// Pure. Mirrors ios/Core/PlaybackStateMachine.swift.

enum class PlaybackState(val jsName: String) {
  IDLE("idle"), POSTER("poster"), PREPARING("preparing"), READY("ready"), PLAYING("playing"),
  PAUSED("paused"), BUFFERING("buffering"), ENDED("ended"), ERROR("error"), RELEASING("releasing");

  /** States shown to JS. releasing stays internal. */
  val publicName: String? get() = if (this == RELEASING) null else jsName
}

enum class PlaybackEvent { BIND, PREPARE, READY, PLAY, PAUSE, BUFFER_START, BUFFER_END, ENDED, FAIL, RETRY, RELEASE, RELEASED }

object PlaybackStateMachine {
  /** null means the move is illegal and the caller must ignore the event. */
  fun next(from: PlaybackState, event: PlaybackEvent): PlaybackState? {
    if (from == PlaybackState.RELEASING) return if (event == PlaybackEvent.RELEASED) PlaybackState.IDLE else null
    if (event == PlaybackEvent.RELEASE) return if (from == PlaybackState.IDLE) null else PlaybackState.RELEASING
    if (event == PlaybackEvent.FAIL) {
      return if (from == PlaybackState.IDLE || from == PlaybackState.ERROR) null else PlaybackState.ERROR
    }
    return when (from to event) {
      PlaybackState.IDLE to PlaybackEvent.BIND -> PlaybackState.POSTER
      PlaybackState.POSTER to PlaybackEvent.PREPARE -> PlaybackState.PREPARING
      PlaybackState.PREPARING to PlaybackEvent.READY -> PlaybackState.READY
      PlaybackState.READY to PlaybackEvent.PLAY,
      PlaybackState.PAUSED to PlaybackEvent.PLAY,
      PlaybackState.ENDED to PlaybackEvent.PLAY,
      PlaybackState.BUFFERING to PlaybackEvent.BUFFER_END -> PlaybackState.PLAYING
      PlaybackState.PLAYING to PlaybackEvent.PAUSE,
      PlaybackState.BUFFERING to PlaybackEvent.PAUSE,
      PlaybackState.READY to PlaybackEvent.PAUSE -> PlaybackState.PAUSED
      PlaybackState.PLAYING to PlaybackEvent.BUFFER_START -> PlaybackState.BUFFERING
      PlaybackState.PLAYING to PlaybackEvent.ENDED,
      PlaybackState.BUFFERING to PlaybackEvent.ENDED -> PlaybackState.ENDED
      PlaybackState.ERROR to PlaybackEvent.RETRY -> PlaybackState.PREPARING
      else -> null
    }
  }
}

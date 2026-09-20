package expo.modules.infinitemedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import expo.modules.infinitemedia.core.PlaybackEvent as E
import expo.modules.infinitemedia.core.PlaybackState as S

class PlaybackStateMachineTest {
  private val legal = mapOf(
    (S.IDLE to E.BIND) to S.POSTER,
    (S.POSTER to E.PREPARE) to S.PREPARING,
    (S.PREPARING to E.READY) to S.READY,
    (S.READY to E.PLAY) to S.PLAYING,
    (S.PAUSED to E.PLAY) to S.PLAYING,
    (S.ENDED to E.PLAY) to S.PLAYING,
    (S.BUFFERING to E.BUFFER_END) to S.PLAYING,
    (S.PLAYING to E.PAUSE) to S.PAUSED,
    (S.BUFFERING to E.PAUSE) to S.PAUSED,
    (S.READY to E.PAUSE) to S.PAUSED,
    (S.PLAYING to E.BUFFER_START) to S.BUFFERING,
    (S.PLAYING to E.ENDED) to S.ENDED,
    (S.BUFFERING to E.ENDED) to S.ENDED,
    (S.ERROR to E.RETRY) to S.PREPARING,
    (S.RELEASING to E.RELEASED) to S.IDLE
  )

  @Test fun everyEdge() {
    for (from in S.values()) for (event in E.values()) {
      val expected = legal[from to event] ?: when {
        from == S.RELEASING -> null
        event == E.RELEASE -> if (from == S.IDLE) null else S.RELEASING
        event == E.FAIL -> if (from == S.IDLE || from == S.ERROR) null else S.ERROR
        else -> null
      }
      assertEquals("$from + $event", expected, PlaybackStateMachine.next(from, event))
    }
  }

  @Test fun happyPathAndLoop() {
    var s = S.IDLE
    for (e in listOf(E.BIND, E.PREPARE, E.READY, E.PLAY, E.BUFFER_START, E.BUFFER_END, E.ENDED, E.PLAY)) {
      s = PlaybackStateMachine.next(s, e)!!
    }
    assertEquals(S.PLAYING, s)
  }

  @Test fun releasingIgnoresLateEvents() {
    for (e in E.values()) if (e != E.RELEASED) assertNull(PlaybackStateMachine.next(S.RELEASING, e))
  }

  @Test fun releasingHidden() {
    assertNull(S.RELEASING.publicName)
    assertEquals("buffering", S.BUFFERING.publicName)
  }
}

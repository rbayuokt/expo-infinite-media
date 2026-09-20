package expo.modules.infinitemedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Rapid swipes rebind one slot many times. Only the latest binding may apply its result. */
class GenerationTest {
  private class FakeSlot {
    var binding: Binding? = null
    var shown: String? = null
  }

  @Test fun staleCompletionsAreDropped() {
    val slot = FakeSlot()
    val pending = ArrayList<Pair<Binding, String>>()
    for (id in listOf("0", "1", "2", "3", "4", "10", "20", "21", "5", "100")) {
      val b = Generations.next(id)
      slot.binding = b
      pending.add(b to id)
    }
    // Completions land in scrambled order.
    for ((b, id) in pending.shuffled(java.util.Random(7))) {
      if (slot.binding.matches(b)) slot.shown = id
    }
    assertEquals("100", slot.shown)
  }

  @Test fun sameItemRebindIsANewGeneration() {
    val a = Generations.next("x")
    val b = Generations.next("x")
    assertFalse(a.matches(b))
    assertTrue(b.matches(b))
    assertFalse((null as Binding?).matches(b))
  }
}

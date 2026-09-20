package expo.modules.infinitemedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CacheIndexTest {
  @Test fun evictsOldestToNinetyPercent() {
    val idx = CacheIndex(1000)
    idx.record("a", 400, now = 1.0)
    idx.record("b", 400, now = 2.0)
    idx.record("c", 400, now = 3.0)
    assertEquals(listOf("a"), idx.evictions(emptySet()))
  }

  @Test fun touchChangesOrder() {
    val idx = CacheIndex(1000)
    idx.record("a", 400, now = 1.0)
    idx.record("b", 400, now = 2.0)
    idx.record("c", 400, now = 3.0)
    idx.touch("a", 4.0)
    assertEquals(listOf("b"), idx.evictions(emptySet()))
  }

  @Test fun pinnedSurvive() {
    val idx = CacheIndex(1000)
    idx.record("current", 600, now = 1.0)
    idx.record("next", 300, now = 2.0)
    idx.record("old", 300, now = 3.0)
    assertEquals(listOf("old"), idx.evictions(setOf("current", "next")))
  }

  @Test fun underBudgetNoop() {
    val idx = CacheIndex(1000)
    idx.record("a", 1000, now = 1.0)
    assertTrue(idx.evictions(emptySet()).isEmpty())
  }

  @Test fun status() {
    val idx = CacheIndex(1000)
    assertEquals("none" to 0L, idx.status("x"))
    idx.record("x", 100, totalBytes = 300, now = 1.0)
    assertEquals("partial" to 100L, idx.status("x"))
    idx.record("x", 300, now = 2.0)
    assertEquals("complete" to 300L, idx.status("x"))
    idx.remove("x")
    assertEquals("none" to 0L, idx.status("x"))
  }
}

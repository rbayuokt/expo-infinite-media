package expo.modules.infinitemedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Same table as ios/Tests. Change both together.
class PreloadPolicyTest {
  private fun plan(i: PolicyInput) = PreloadPolicy.plan(i)
  private fun at(i: Int, count: Int = 1000) = PolicyInput(currentIndex = i, itemCount = count)

  @Test fun slowViewing() {
    val p = plan(at(100))
    assertEquals(PlanEntry(100, Priority.P0, VideoAction.PLAY, ImageAction.DISPLAY), p.entry(100))
    assertEquals(PlanEntry(101, Priority.P1, VideoAction.PREPARE, ImageAction.DECODE), p.entry(101))
    assertEquals(PlanEntry(102, Priority.P2, VideoAction.STARTUP, ImageAction.FETCH), p.entry(102))
    assertEquals(PlanEntry(99, Priority.P3, VideoAction.POSTER, ImageAction.DECODE), p.entry(99))
    assertEquals(4, p.entries.size)
    assertEquals(1, p.preparedCount)
    // Sorted by priority.
    assertEquals(listOf(100, 101, 102, 99), p.entries.map { it.index })
  }

  @Test fun fastFlingOnlyWarmsTheLanding() {
    val p = plan(at(105).copy(velocity = 4.0))
    assertEquals(VideoAction.STARTUP, p.entry(106)!!.video)
    assertEquals(ImageAction.FETCH, p.entry(106)!!.image)
    assertNull(p.entry(107))
    assertNull(p.entry(104))
    assertEquals(0, p.preparedCount)
  }

  @Test fun backwardFollowsDirection() {
    val p = plan(at(50).copy(direction = -1))
    assertEquals(Priority.P1, p.entry(49)!!.priority)
    assertEquals(Priority.P2, p.entry(48)!!.priority)
    assertEquals(Priority.P3, p.entry(51)!!.priority)
  }

  @Test fun jumpFarAwayOnlyPlansAroundTarget() {
    val p = plan(at(500))
    assertTrue(p.entries.all { it.index in 499..502 })
    assertNull(p.entry(1))
  }

  @Test fun memoryPressureDropsPreparedPlayers() {
    val p = plan(at(10).copy(memory = MemoryLevel.PRESSURE))
    assertEquals(VideoAction.STARTUP, p.entry(11)!!.video)
    assertNull(p.entry(12))
    assertEquals(ImageAction.NONE, p.entry(9)!!.image)
    assertEquals(0, p.preparedCount)
  }

  @Test fun criticalAndOfflineKeepOnlyCurrent() {
    assertEquals(listOf(10), plan(at(10).copy(memory = MemoryLevel.CRITICAL)).entries.map { it.index })
    assertEquals(listOf(10), plan(at(10).copy(network = NetworkKind.OFFLINE)).entries.map { it.index })
  }

  @Test fun cellularShrinksStartupAndDropsSecondVideo() {
    val p = plan(at(10).copy(network = NetworkKind.CELLULAR))
    assertEquals(1000, p.startupMs)
    assertEquals(512 * 1024, p.startupBytes)
    assertEquals(VideoAction.PREPARE, p.entry(11)!!.video)
    assertEquals(VideoAction.POSTER, p.entry(12)!!.video)
    assertEquals(ImageAction.FETCH, p.entry(12)!!.image)
  }

  @Test fun unhealthyBufferStopsSpeculation() {
    val p = plan(at(10).copy(bufferHealthy = false))
    assertEquals(PlanEntry(11, Priority.P1, VideoAction.POSTER, ImageAction.NONE), p.entry(11))
    assertNull(p.entry(12))
    assertEquals(VideoAction.POSTER, p.entry(9)!!.video)
    assertEquals(0, p.preparedCount)
  }

  @Test fun tiers() {
    assertEquals(0, plan(at(10).copy(tier = DeviceTier.LOW)).preparedCount)
    val low = plan(at(10).copy(tier = DeviceTier.LOW))
    assertEquals(VideoAction.POSTER, low.entry(12)!!.video)
    val high = plan(at(10).copy(tier = DeviceTier.HIGH))
    assertEquals(VideoAction.PREPARE, high.entry(9)!!.video)
    assertEquals(2, high.preparedCount)
  }

  @Test fun edges() {
    assertTrue(plan(at(0, 0)).entries.isEmpty())
    assertEquals(listOf(0), plan(at(0, 1)).entries.map { it.index })
    val last = plan(at(9, 10))
    assertTrue(last.entries.all { it.index in 0..9 })
    assertEquals(listOf(9, 8), last.entries.map { it.index })
    assertEquals(listOf(0), plan(at(0, 5).copy(ahead = 0, behind = 0)).entries.map { it.index })
    // Out-of-range index is clamped.
    assertEquals(4, plan(at(50, 5)).entries.first().index)
  }

  @Test fun rapidIndexChangesAreStateless() {
    // 0 -> 1 -> 2 -> 3 -> 4 -> 10 -> 20 -> 21 -> 5 -> 100: each plan depends only on its input.
    for (i in listOf(0, 1, 2, 3, 4, 10, 20, 21, 5, 100)) {
      val p = plan(at(i))
      assertEquals(i, p.entries.first().index)
      assertTrue(p.entries.all { kotlin.math.abs(it.index - i) <= 2 })
    }
  }
}

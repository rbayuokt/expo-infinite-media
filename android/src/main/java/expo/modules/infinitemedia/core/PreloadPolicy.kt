package expo.modules.infinitemedia.core

// Pure. Mirrors ios/Core/PreloadPolicy.swift, same test table.

enum class Priority { P0, P1, P2, P3, CANCEL }

enum class VideoAction {
  PLAY,
  /** Own a paused, prepared player plus the startup range. */
  PREPARE,
  /** Startup bytes to disk only. */
  STARTUP,
  POSTER,
  NONE
}

enum class ImageAction {
  DISPLAY,
  /** Decode to the memory cache at slot size. */
  DECODE,
  /** Bytes to disk only. */
  FETCH,
  NONE
}

enum class NetworkKind { WIFI, CELLULAR, CONSTRAINED, OFFLINE }
enum class MemoryLevel { NORMAL, PRESSURE, CRITICAL }
enum class DeviceTier { LOW, MID, HIGH }

data class PolicyInput(
  val currentIndex: Int,
  val itemCount: Int,
  val direction: Int = 1,
  val velocity: Double = 0.0,
  val bufferHealthy: Boolean = true,
  val network: NetworkKind = NetworkKind.WIFI,
  val memory: MemoryLevel = MemoryLevel.NORMAL,
  val tier: DeviceTier = DeviceTier.MID,
  val ahead: Int = 2,
  val behind: Int = 1
)

data class PlanEntry(val index: Int, val priority: Priority, val video: VideoAction, val image: ImageAction)

data class PreloadPlan(val entries: List<PlanEntry>, val startupBytes: Int, val startupMs: Int) {
  fun entry(index: Int): PlanEntry? = entries.firstOrNull { it.index == index }
  val preparedCount: Int get() = entries.count { it.video == VideoAction.PREPARE }
}

object PreloadPolicy {
  const val FAST_FLING_PAGES_PER_SEC = 2.0

  fun plan(input: PolicyInput): PreloadPlan {
    val cellular = input.network == NetworkKind.CELLULAR
    val startupBytes = if (cellular) 512 * 1024 else 1536 * 1024
    val startupMs = if (cellular) 1000 else 3000
    if (input.itemCount <= 0) return PreloadPlan(emptyList(), startupBytes, startupMs)

    val current = input.currentIndex.coerceIn(0, input.itemCount - 1)
    val dir = if (input.direction >= 0) 1 else -1
    val entries = mutableListOf(PlanEntry(current, Priority.P0, VideoAction.PLAY, ImageAction.DISPLAY))

    if (input.network == NetworkKind.OFFLINE || input.memory == MemoryLevel.CRITICAL) {
      return PreloadPlan(entries, startupBytes, startupMs)
    }

    val constrained = input.memory == MemoryLevel.PRESSURE ||
      input.tier == DeviceTier.LOW ||
      input.network == NetworkKind.CONSTRAINED
    val flinging = input.velocity > FAST_FLING_PAGES_PER_SEC
    val unhealthy = !input.bufferHealthy

    fun add(index: Int, priority: Priority, video: VideoAction, image: ImageAction) {
      if (index < 0 || index >= input.itemCount || index == current) return
      if (entries.any { it.index == index }) return
      entries.add(PlanEntry(index, priority, video, image))
    }

    for (k in 1..input.ahead) {
      val i = current + dir * k
      when (k) {
        1 -> when {
          unhealthy -> add(i, Priority.P1, VideoAction.POSTER, ImageAction.NONE)
          flinging || constrained -> add(i, Priority.P1, VideoAction.STARTUP, ImageAction.FETCH)
          else -> add(i, Priority.P1, VideoAction.PREPARE, ImageAction.DECODE)
        }
        2 -> {
          if (unhealthy || flinging || (constrained && input.memory == MemoryLevel.PRESSURE)) continue
          if (constrained || cellular) {
            add(i, Priority.P2, VideoAction.POSTER, ImageAction.FETCH)
          } else {
            add(i, Priority.P2, VideoAction.STARTUP, ImageAction.FETCH)
          }
        }
        else -> {
          if (unhealthy || flinging || constrained) continue
          add(i, Priority.P3, VideoAction.POSTER, ImageAction.NONE)
        }
      }
    }

    if (input.behind > 0 && !flinging) {
      val warmPrev = input.tier == DeviceTier.HIGH && input.memory == MemoryLevel.NORMAL && !unhealthy
      add(
        current - dir,
        Priority.P3,
        if (warmPrev) VideoAction.PREPARE else VideoAction.POSTER,
        if (constrained) ImageAction.NONE else ImageAction.DECODE
      )
    }

    entries.sortWith(compareBy<PlanEntry>({ it.priority }, { it.index }))
    return PreloadPlan(entries, startupBytes, startupMs)
  }
}

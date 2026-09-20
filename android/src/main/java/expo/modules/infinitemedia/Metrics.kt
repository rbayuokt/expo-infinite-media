package expo.modules.infinitemedia

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** Counters for diagnostics. Aggregated here, emitted as one map every 2 s when enabled. */
internal class Metrics {
  private val startups = ArrayList<Long>()
  var rebufferCount = 0
  var rebufferMs = 0L
  var cacheHits = 0
  var cacheMisses = 0
  var preloadCancels = 0
  var droppedFrames = 0L
  var errors = 0

  // Written from Media3 loader threads.
  val bytesActive = AtomicLong()
  val bytesSpeculative = AtomicLong()
  /** Speculative bytes per cache key, cleared once the key actually plays. */
  val speculativeByKey = ConcurrentHashMap<String, AtomicLong>()

  fun startup(ms: Long) {
    startups.add(ms)
    // Bounded, a long session only needs recent history for percentiles.
    if (startups.size > 200) startups.removeAt(0)
  }

  fun played(key: String) {
    speculativeByKey.remove(key)
  }

  fun snapshot(extra: Map<String, Any>, wastedKeys: Set<String>): Map<String, Any> {
    val sorted = startups.sorted()
    fun pct(p: Double) = if (sorted.isEmpty()) 0L else sorted[((sorted.size - 1) * p).toInt()]
    val wasted = wastedKeys.sumOf { speculativeByKey[it]?.get() ?: 0L }
    return mapOf(
      "startupMsP50" to pct(0.5),
      "startupMsP90" to pct(0.9),
      "firstFrames" to startups.size,
      "rebufferCount" to rebufferCount,
      "rebufferMs" to rebufferMs,
      "cacheHits" to cacheHits,
      "cacheMisses" to cacheMisses,
      "bytesActive" to bytesActive.get(),
      "bytesSpeculative" to bytesSpeculative.get(),
      "bytesWasted" to wasted,
      "preloadCancels" to preloadCancels,
      "droppedFrames" to droppedFrames,
      "errors" to errors
    ) + extra
  }
}

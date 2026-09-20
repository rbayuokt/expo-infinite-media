import QuartzCore

/** Counters only. Aggregated and sent every 2 s when diagnostics are on. */
final class SessionMetrics {
  var errors = 0
  var droppedFrames = 0
  private var startups: [Int] = []
  private var firstFrames = 0
  private var rebufferCount = 0
  private var rebufferMs = 0.0
  private var bufferStartedAt: CFTimeInterval?

  func recordStartup(_ ms: Int, fromCache: Bool) {
    firstFrames += 1
    startups.append(ms)
    if startups.count > 200 { startups.removeFirst(startups.count - 200) }
  }

  func bufferStart() {
    guard bufferStartedAt == nil else { return }
    bufferStartedAt = CACurrentMediaTime()
    rebufferCount += 1
  }

  func bufferEnd() {
    guard let start = bufferStartedAt else { return }
    rebufferMs += (CACurrentMediaTime() - start) * 1000
    bufferStartedAt = nil
  }

  func payload(cache: VideoCache.Stats, playersActive: Int, playersPrepared: Int, playersTotal: Int,
               liveObservers: Int, liveSurfaces: Int, memoryWarnings: Int) -> [String: Any] {
    let sorted = startups.sorted()
    func pct(_ p: Double) -> Int { sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))] }
    return [
      "startupMsP50": pct(0.5), "startupMsP90": pct(0.9), "firstFrames": firstFrames,
      "rebufferCount": rebufferCount, "rebufferMs": Int(rebufferMs),
      "cacheHits": cache.hits, "cacheMisses": cache.misses,
      "bytesActive": cache.bytesActive, "bytesSpeculative": cache.bytesSpeculative, "bytesWasted": cache.bytesWasted,
      "preloadCancels": cache.preloadCancels, "droppedFrames": droppedFrames,
      "playersActive": playersActive, "playersPrepared": playersPrepared, "playersTotal": playersTotal,
      "liveObservers": liveObservers, "liveSurfaces": liveSurfaces, "memoryWarnings": memoryWarnings,
      "errors": errors, "videoCacheBytes": 0, "imageCacheBytes": 0,
    ]
  }
}

import XCTest

// Pure core only, so these also run on macOS with plain xctest (see README, Contributing).

final class PreloadPolicyTests: XCTestCase {
  private func plan(_ current: Int, count: Int = 100, _ tweak: (inout PolicyInput) -> Void = { _ in }) -> PreloadPlan {
    var input = PolicyInput(currentIndex: current, itemCount: count)
    tweak(&input)
    return PreloadPolicy.plan(input)
  }

  func testSlowViewing() {
    let p = plan(100, count: 200)
    XCTAssertEqual(p.entry(100), PlanEntry(index: 100, priority: .p0, video: .play, image: .display))
    XCTAssertEqual(p.entry(101), PlanEntry(index: 101, priority: .p1, video: .prepare, image: .decode))
    XCTAssertEqual(p.entry(102), PlanEntry(index: 102, priority: .p2, video: .startup, image: .fetch))
    XCTAssertEqual(p.entry(99)?.priority, .p3)
    XCTAssertEqual(p.entry(99)?.video, .poster)
    XCTAssertNil(p.entry(103))
    XCTAssertEqual(p.preparedCount, 1)
  }

  func testFastFlingPreparesNothing() {
    let p = plan(105, count: 200) { $0.velocity = 4 }
    XCTAssertEqual(p.entry(106)?.video, .startup)
    XCTAssertNil(p.entry(107))
    XCTAssertNil(p.entry(104), "no warm-behind while flinging")
    XCTAssertEqual(p.preparedCount, 0)
  }

  func testBackwardFollowsDirection() {
    let p = plan(50) { $0.direction = -1 }
    XCTAssertEqual(p.entry(49)?.priority, .p1)
    XCTAssertEqual(p.entry(48)?.priority, .p2)
    XCTAssertEqual(p.entry(51)?.priority, .p3)
  }

  func testJumpFarOnlyTouchesNeighbours() {
    let p = plan(500, count: 1000)
    XCTAssertEqual(Set(p.entries.map(\.index)), [499, 500, 501, 502])
  }

  func testMemoryPressure() {
    let p = plan(10) { $0.memory = .pressure }
    XCTAssertEqual(p.entry(11)?.video, .startup)
    XCTAssertNil(p.entry(12))
    XCTAssertEqual(p.preparedCount, 0)
  }

  func testCriticalKeepsOnlyCurrent() {
    let p = plan(10) { $0.memory = .critical }
    XCTAssertEqual(p.entries.map(\.index), [10])
  }

  func testOffline() {
    XCTAssertEqual(plan(3) { $0.network = .offline }.entries.count, 1)
  }

  func testCellularShrinksStartupAndP2() {
    let p = plan(3) { $0.network = .cellular }
    XCTAssertEqual(p.entry(5)?.video, .poster)
    XCTAssertLessThan(p.startupBytes, plan(3).startupBytes)
    XCTAssertEqual(p.startupMs, 1000)
  }

  func testUnhealthyBufferStopsSpeculation() {
    let p = plan(3) { $0.bufferHealthy = false }
    XCTAssertEqual(p.entry(4)?.video, .poster)
    XCTAssertEqual(p.entry(4)?.image, ImageAction.none)
    XCTAssertNil(p.entry(5))
    XCTAssertEqual(p.preparedCount, 0)
  }

  func testLowTier() {
    let p = plan(3) { $0.tier = .low }
    XCTAssertEqual(p.preparedCount, 0)
    XCTAssertEqual(p.entry(5)?.video, .poster)
  }

  func testHighTierWarmsPrevious() {
    let p = plan(3) { $0.tier = .high }
    XCTAssertEqual(p.entry(2)?.video, .prepare)
    XCTAssertEqual(p.preparedCount, 2)
  }

  func testEdgesAndEmpty() {
    XCTAssertEqual(plan(0, count: 1).entries.map(\.index), [0])
    XCTAssertTrue(plan(0, count: 0).entries.isEmpty)
    XCTAssertEqual(plan(99, count: 100).entry(99)?.priority, .p0)
    XCTAssertNil(plan(99, count: 100).entry(100))
    XCTAssertEqual(plan(500, count: 10).entry(9)?.priority, .p0, "clamps")
  }

  func testAheadZero() {
    let p = plan(5) { $0.ahead = 0; $0.behind = 0 }
    XCTAssertEqual(p.entries.map(\.index), [5])
  }

  func testRapidSequenceNeverKeepsPassedItems() {
    var previous: Set<Int> = []
    for index in [0, 1, 2, 3, 4, 10, 20, 21, 5, 100] {
      let p = plan(index, count: 200)
      let now = Set(p.entries.map(\.index))
      XCTAssertTrue(now.allSatisfy { abs($0 - index) <= 2 })
      XCTAssertEqual(p.entries.filter { $0.priority == .p0 }.map(\.index), [index])
      previous = now
    }
    XCTAssertFalse(previous.contains(21))
  }
}

final class PlaybackStateMachineTests: XCTestCase {
  typealias SM = PlaybackStateMachine

  func testHappyPath() {
    var s = PlaybackState.idle
    for (event, expected) in [(PlaybackEvent.bind, PlaybackState.poster), (.prepare, .preparing), (.ready, .ready),
                              (.play, .playing), (.bufferStart, .buffering), (.bufferEnd, .playing), (.pause, .paused),
                              (.play, .playing), (.ended, .ended), (.play, .playing), (.release, .releasing), (.released, .idle)] {
      s = SM.next(s, event)!
      XCTAssertEqual(s, expected)
    }
  }

  func testErrorAndRetry() {
    XCTAssertEqual(SM.next(.playing, .fail), .error)
    XCTAssertEqual(SM.next(.preparing, .fail), .error)
    XCTAssertEqual(SM.next(.error, .retry), .preparing)
    XCTAssertNil(SM.next(.error, .fail))
    XCTAssertNil(SM.next(.idle, .fail))
  }

  func testReleasingAbsorbsEverything() {
    let all: [PlaybackEvent] = [.bind, .prepare, .ready, .play, .pause, .bufferStart, .bufferEnd, .ended, .fail, .retry, .release]
    for e in all { XCTAssertNil(SM.next(.releasing, e), "\(e)") }
    XCTAssertEqual(SM.next(.releasing, .released), .idle)
    XCTAssertNil(SM.next(.idle, .release))
  }

  func testIllegalMoves() {
    XCTAssertNil(SM.next(.idle, .play))
    XCTAssertNil(SM.next(.poster, .play))
    XCTAssertNil(SM.next(.preparing, .play), "play before ready is intent, not a transition")
    XCTAssertNil(SM.next(.paused, .bufferStart))
    XCTAssertNil(SM.next(.ready, .ended))
    XCTAssertNil(SM.next(.playing, .ready))
    XCTAssertNil(SM.next(.playing, .bind))
  }

  func testAnyLiveStateCanRelease() {
    for s: PlaybackState in [.poster, .preparing, .ready, .playing, .paused, .buffering, .ended, .error] {
      XCTAssertEqual(SM.next(s, .release), .releasing)
    }
  }

  func testReleasingIsNotPublic() {
    XCTAssertNil(SM.publicName(.releasing))
    XCTAssertEqual(SM.publicName(.playing), "playing")
  }
}

final class CacheIndexTests: XCTestCase {
  func testEvictsOldestToNinetyPercent() {
    var index = CacheIndex(budget: 1000)
    for (i, key) in ["a", "b", "c", "d"].enumerated() { index.record(key, bytes: 300, now: Double(i)) }
    XCTAssertEqual(index.evictions(pinned: []), ["a"], "1200 > 1000, one eviction gets to 900")
  }

  func testPinnedSurvive() {
    var index = CacheIndex(budget: 1000)
    for (i, key) in ["a", "b", "c", "d"].enumerated() { index.record(key, bytes: 300, now: Double(i)) }
    XCTAssertEqual(index.evictions(pinned: ["a"]), ["b"])
  }

  func testTouchRefreshes() {
    var index = CacheIndex(budget: 1000)
    for (i, key) in ["a", "b", "c", "d"].enumerated() { index.record(key, bytes: 300, now: Double(i)) }
    index.touch("a", now: 10)
    XCTAssertEqual(index.evictions(pinned: []), ["b"])
  }

  func testUnderBudgetKeepsAll() {
    var index = CacheIndex(budget: 1000)
    index.record("a", bytes: 1000, now: 0)
    XCTAssertTrue(index.evictions(pinned: []).isEmpty)
  }

  func testStatus() {
    var index = CacheIndex(budget: 1000)
    index.record("p", bytes: 10, totalBytes: 100, now: 0)
    index.record("c", bytes: 100, totalBytes: 100, now: 0)
    XCTAssertEqual(index.status("p").state, "partial")
    XCTAssertEqual(index.status("c").state, "complete")
    XCTAssertEqual(index.status("x").state, "none")
  }

  func testCodableRoundTrip() throws {
    var index = CacheIndex(budget: 42)
    index.record("a", bytes: 7, totalBytes: 9, now: 1)
    let decoded = try JSONDecoder().decode(CacheIndex.self, from: JSONEncoder().encode(index))
    XCTAssertEqual(decoded.entries, index.entries)
    XCTAssertEqual(decoded.budget, 42)
  }
}

/** The slot guard in FeedSession, reduced to its rule: a completion applies only to its own binding. */
final class GenerationGuardTests: XCTestCase {
  private struct Slot {
    var itemId: String?
    var generation: UInt64 = 0
    var shown: String?
  }

  func testInterleavedStaleCompletionsAreDropped() {
    var counter: UInt64 = 0
    var slot = Slot()
    var pending: [(id: String, generation: UInt64)] = []
    for id in ["0", "1", "2", "3", "4", "10", "20", "21", "5", "100"] {
      counter += 1
      slot.itemId = id
      slot.generation = counter
      pending.append((id, counter))
    }
    // Completions land in reverse, the worst case.
    for completion in pending.reversed() where completion.generation == slot.generation {
      slot.shown = completion.id
    }
    XCTAssertEqual(slot.shown, "100")
  }
}

final class RangeMetaTests: XCTestCase {
  func testMergeAndAvailability() {
    var m = RangeMeta()
    m.add(0...99)
    m.add(200...299)
    m.add(100...199)
    XCTAssertEqual(m.ranges, [0...299])
    XCTAssertEqual(m.available(at: 50), 250)
    XCTAssertEqual(m.cachedBytes, 300)
  }

  func testGapsAndNext() {
    var m = RangeMeta()
    m.add(0...9)
    m.add(50...59)
    XCTAssertEqual(m.available(at: 20), 0)
    XCTAssertEqual(m.nextCachedStart(after: 20), 50)
    XCTAssertNil(m.nextCachedStart(after: 55))
    m.add(5...52)
    XCTAssertEqual(m.ranges, [0...59])
  }
}

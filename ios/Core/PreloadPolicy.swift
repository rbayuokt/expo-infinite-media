import Foundation

// Pure. Mirrored in android/.../core/PreloadPolicy.kt with the same test table.

enum Priority: Int, Comparable {
  case p0 = 0, p1, p2, p3, cancel
  static func < (a: Priority, b: Priority) -> Bool { a.rawValue < b.rawValue }
}

enum VideoAction: Equatable {
  case play
  /** Own a paused, prepared player plus the startup range. */
  case prepare
  /** Startup bytes to disk only. */
  case startup
  case poster
  case none
}

enum ImageAction: Equatable {
  case display
  /** Decode to the memory cache at slot size. */
  case decode
  /** Bytes to disk only. */
  case fetch
  case none
}

enum NetworkKind { case wifi, cellular, constrained, offline }
enum MemoryLevel { case normal, pressure, critical }
enum DeviceTier { case low, mid, high }

struct PolicyInput {
  var currentIndex: Int
  var direction: Int = 1
  var velocity: Double = 0
  var bufferHealthy = true
  var network: NetworkKind = .wifi
  var memory: MemoryLevel = .normal
  var tier: DeviceTier = .mid
  var itemCount: Int
  var ahead = 2
  var behind = 1
}

struct PlanEntry: Equatable {
  let index: Int
  let priority: Priority
  let video: VideoAction
  let image: ImageAction
}

struct PreloadPlan: Equatable {
  let entries: [PlanEntry]
  let startupBytes: Int
  let startupMs: Int

  func entry(_ index: Int) -> PlanEntry? { entries.first { $0.index == index } }
  var preparedCount: Int { entries.filter { $0.video == .prepare }.count }
}

enum PreloadPolicy {
  static let fastFlingPagesPerSec = 2.0

  static func plan(_ input: PolicyInput) -> PreloadPlan {
    let cellular = input.network == .cellular
    let startupBytes = cellular ? 512 * 1024 : 1536 * 1024
    let startupMs = cellular ? 1000 : 3000
    guard input.itemCount > 0 else {
      return PreloadPlan(entries: [], startupBytes: startupBytes, startupMs: startupMs)
    }
    let current = min(max(0, input.currentIndex), input.itemCount - 1)
    let dir = input.direction >= 0 ? 1 : -1
    var entries = [PlanEntry(index: current, priority: .p0, video: .play, image: .display)]

    let offline = input.network == .offline
    let critical = input.memory == .critical
    if offline || critical {
      return PreloadPlan(entries: entries, startupBytes: startupBytes, startupMs: startupMs)
    }

    let constrained = input.memory == .pressure || input.tier == .low || input.network == .constrained
    let flinging = input.velocity > fastFlingPagesPerSec
    let unhealthy = !input.bufferHealthy

    func add(_ index: Int, _ priority: Priority, _ video: VideoAction, _ image: ImageAction) {
      guard index >= 0, index < input.itemCount, index != current else { return }
      guard !entries.contains(where: { $0.index == index }) else { return }
      entries.append(PlanEntry(index: index, priority: priority, video: video, image: image))
    }

    for k in 1...max(1, input.ahead) where k <= input.ahead {
      let i = current + dir * k
      switch k {
      case 1:
        if unhealthy {
          add(i, .p1, .poster, .none)
        } else if flinging || constrained {
          add(i, .p1, .startup, .fetch)
        } else {
          add(i, .p1, .prepare, .decode)
        }
      case 2:
        if unhealthy || flinging || (constrained && input.memory == .pressure) { continue }
        if constrained || cellular {
          add(i, .p2, .poster, .fetch)
        } else {
          add(i, .p2, .startup, .fetch)
        }
      default:
        if unhealthy || flinging || constrained { continue }
        add(i, .p3, .poster, .none)
      }
    }

    if input.behind > 0 && !flinging {
      let i = current - dir
      let warmPrev = input.tier == .high && input.memory == .normal && !unhealthy
      add(i, .p3, warmPrev ? .prepare : .poster, constrained ? .none : .decode)
    }

    entries.sort { ($0.priority, $0.index) < ($1.priority, $1.index) }
    return PreloadPlan(entries: entries, startupBytes: startupBytes, startupMs: startupMs)
  }
}

private func < (a: (Priority, Int), b: (Priority, Int)) -> Bool {
  a.0 != b.0 ? a.0 < b.0 : a.1 < b.1
}

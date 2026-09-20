import Foundation

// Pure LRU bookkeeping. Mirrored in android/.../core/CacheIndex.kt.

struct CacheEntry: Codable, Equatable {
  var bytes: Int64
  var lastAccess: Double
  /** Total length when known, so partial and complete can be told apart. */
  var totalBytes: Int64?
}

struct CacheIndex: Codable {
  private(set) var entries: [String: CacheEntry] = [:]
  var budget: Int64

  init(budget: Int64) { self.budget = budget }

  var totalBytes: Int64 { entries.values.reduce(0) { $0 + $1.bytes } }

  mutating func record(_ key: String, bytes: Int64, totalBytes: Int64? = nil, now: Double) {
    var entry = entries[key] ?? CacheEntry(bytes: 0, lastAccess: now, totalBytes: nil)
    entry.bytes = bytes
    entry.lastAccess = now
    if let totalBytes { entry.totalBytes = totalBytes }
    entries[key] = entry
  }

  mutating func touch(_ key: String, now: Double) {
    entries[key]?.lastAccess = now
  }

  mutating func remove(_ key: String) { entries.removeValue(forKey: key) }
  mutating func removeAll() { entries.removeAll() }

  func status(_ key: String) -> (state: String, bytes: Int64) {
    guard let e = entries[key], e.bytes > 0 else { return ("none", 0) }
    if let total = e.totalBytes, e.bytes >= total { return ("complete", e.bytes) }
    return ("partial", e.bytes)
  }

  /**
   Keys to delete, oldest first, to get back under 90% of the budget once it's exceeded.
   Pinned keys (current and next items) are never evicted.
   */
  func evictions(pinned: Set<String>) -> [String] {
    var total = totalBytes
    guard total > budget else { return [] }
    let target = budget / 10 * 9
    var out: [String] = []
    for (key, entry) in entries.sorted(by: { $0.value.lastAccess < $1.value.lastAccess }) {
      if total <= target { break }
      if pinned.contains(key) { continue }
      out.append(key)
      total -= entry.bytes
    }
    return out
  }
}

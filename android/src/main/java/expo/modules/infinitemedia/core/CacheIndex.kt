package expo.modules.infinitemedia.core

// Pure LRU bookkeeping. Mirrors ios/Core/CacheIndex.swift.

data class CacheEntry(var bytes: Long, var lastAccess: Double, var totalBytes: Long? = null)

class CacheIndex(var budget: Long) {
  val entries = LinkedHashMap<String, CacheEntry>()

  val totalBytes: Long get() = entries.values.sumOf { it.bytes }

  fun record(key: String, bytes: Long, totalBytes: Long? = null, now: Double) {
    val entry = entries.getOrPut(key) { CacheEntry(0, now) }
    entry.bytes = bytes
    entry.lastAccess = now
    if (totalBytes != null) entry.totalBytes = totalBytes
  }

  fun touch(key: String, now: Double) {
    entries[key]?.lastAccess = now
  }

  fun remove(key: String) {
    entries.remove(key)
  }

  fun removeAll() = entries.clear()

  /** "none" | "partial" | "complete" to bytes. */
  fun status(key: String): Pair<String, Long> {
    val e = entries[key] ?: return "none" to 0L
    if (e.bytes <= 0) return "none" to 0L
    val total = e.totalBytes
    return if (total != null && e.bytes >= total) "complete" to e.bytes else "partial" to e.bytes
  }

  /** Keys to delete, oldest first, to get back under 90% once over budget. Pinned keys stay. */
  fun evictions(pinned: Set<String>): List<String> {
    var total = totalBytes
    if (total <= budget) return emptyList()
    val target = budget / 10 * 9
    val out = mutableListOf<String>()
    for ((key, entry) in entries.entries.sortedBy { it.value.lastAccess }) {
      if (total <= target) break
      if (key in pinned) continue
      out.add(key)
      total -= entry.bytes
    }
    return out
  }
}

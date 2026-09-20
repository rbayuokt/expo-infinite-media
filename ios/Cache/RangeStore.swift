import CryptoKit
import Foundation

struct RangeMeta: Codable {
  var contentLength: Int64?
  var contentType: String?
  /** Sorted, non-overlapping, merged. */
  var ranges: [ClosedRange<Int64>] = []

  var cachedBytes: Int64 { ranges.reduce(0) { $0 + ($1.upperBound - $1.lowerBound + 1) } }

  /** Contiguous bytes available at `offset`, 0 if none. */
  func available(at offset: Int64) -> Int64 {
    guard let r = ranges.first(where: { $0.contains(offset) }) else { return 0 }
    return r.upperBound - offset + 1
  }

  /** Start of the next cached range after `offset`, if any. */
  func nextCachedStart(after offset: Int64) -> Int64? {
    ranges.first(where: { $0.lowerBound > offset })?.lowerBound
  }

  mutating func add(_ range: ClosedRange<Int64>) {
    var merged = range
    var out: [ClosedRange<Int64>] = []
    for r in ranges {
      if r.upperBound + 1 < merged.lowerBound || merged.upperBound + 1 < r.lowerBound {
        out.append(r)
      } else {
        merged = min(r.lowerBound, merged.lowerBound)...max(r.upperBound, merged.upperBound)
      }
    }
    out.append(merged)
    ranges = out.sorted { $0.lowerBound < $1.lowerBound }
  }
}

/**
 Sparse on-disk file per cache key plus its range index. Every call must be made on `queue`.
 ponytail: one serial IO queue for all keys, per-key queues if parallel reads ever matter.
 */
final class RangeStore {
  let queue = DispatchQueue(label: "expo.modules.infinitemedia.video-io", qos: .utility)
  let directory: URL
  private var metas: [String: RangeMeta] = [:]
  private var handles: [String: FileHandle] = [:]
  private var dirty: Set<String> = []

  init(directory: URL) {
    self.directory = directory
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  static func fileName(_ key: String) -> String {
    SHA256.hash(data: Data(key.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
  }

  private func dataURL(_ key: String) -> URL { directory.appendingPathComponent(Self.fileName(key) + ".data") }
  private func metaURL(_ key: String) -> URL { directory.appendingPathComponent(Self.fileName(key) + ".meta") }

  func meta(_ key: String) -> RangeMeta {
    if let m = metas[key] { return m }
    var m = RangeMeta()
    if let data = try? Data(contentsOf: metaURL(key)), let decoded = try? JSONDecoder().decode(RangeMeta.self, from: data) {
      // A meta without its data file is left over from a crash or a partial delete.
      if FileManager.default.fileExists(atPath: dataURL(key).path) { m = decoded }
    }
    metas[key] = m
    return m
  }

  func setInfo(_ key: String, contentLength: Int64?, contentType: String?) {
    var m = meta(key)
    if let contentLength { m.contentLength = contentLength }
    if let contentType { m.contentType = contentType }
    metas[key] = m
    dirty.insert(key)
  }

  func write(_ key: String, offset: Int64, data: Data) throws {
    guard !data.isEmpty else { return }
    let handle = try handle(key)
    try handle.seek(toOffset: UInt64(offset))
    try handle.write(contentsOf: data)
    var m = meta(key)
    m.add(offset...(offset + Int64(data.count) - 1))
    metas[key] = m
    dirty.insert(key)
  }

  func read(_ key: String, offset: Int64, length: Int) throws -> Data {
    let handle = try handle(key)
    try handle.seek(toOffset: UInt64(offset))
    let data = try handle.read(upToCount: length) ?? Data()
    if data.count < length { throw CocoaError(.fileReadCorruptFile) }
    return data
  }

  func flush() {
    for key in dirty {
      guard let m = metas[key], let data = try? JSONEncoder().encode(m) else { continue }
      try? data.write(to: metaURL(key), options: .atomic)
    }
    dirty.removeAll()
  }

  func remove(_ key: String) {
    try? handles.removeValue(forKey: key)?.close()
    metas.removeValue(forKey: key)
    dirty.remove(key)
    try? FileManager.default.removeItem(at: dataURL(key))
    try? FileManager.default.removeItem(at: metaURL(key))
  }

  func removeAll() {
    for handle in handles.values { try? handle.close() }
    handles.removeAll()
    metas.removeAll()
    dirty.removeAll()
    try? FileManager.default.removeItem(at: directory)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  /** Closes handles for keys nobody is reading, so open file count stays small. */
  func closeHandles(except keep: Set<String>) {
    for key in handles.keys where !keep.contains(key) {
      try? handles.removeValue(forKey: key)?.close()
    }
  }

  private func handle(_ key: String) throws -> FileHandle {
    if let h = handles[key] { return h }
    let url = dataURL(key)
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(atPath: url.path, contents: nil)
    }
    let h = try FileHandle(forUpdating: url)
    handles[key] = h
    return h
  }
}

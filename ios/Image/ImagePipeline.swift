import ImageIO
import UIKit

/**
 Fetch, disk cache, downsample, memory cache. Downloads are deduped per cache key and
 decodes per (key, target size, mode). Bookkeeping runs on `queue`, decoding on `decodeQueue`,
 completions on main.
 */
final class ImagePipeline {
  static let shared = ImagePipeline()

  typealias Completion = (Result<UIImage, MediaError>) -> Void

  struct Target: Hashable {
    /** Pixels. */
    let width: Int
    let height: Int
    let cover: Bool
  }

  private final class Download {
    var task: URLSessionTask?
    var waiters: [(Result<URL, MediaError>) -> Void] = []
    /** Prefetch-only downloads can be cancelled when they fall out of the plan. */
    var speculative = true
  }

  private final class Decode {
    var waiters: [Int: Completion] = [:]
    var cancelled = false
  }

  private let queue = DispatchQueue(label: "expo.modules.infinitemedia.image", qos: .userInitiated)
  private let decodeQueue: OperationQueue = {
    let q = OperationQueue()
    q.maxConcurrentOperationCount = 2
    q.qualityOfService = .userInitiated
    return q
  }()
  private let memory = NSCache<NSString, UIImage>()
  private let session: URLSession
  private let directory: URL
  private var index: CacheIndex
  private var downloads: [String: Download] = [:]
  private var decodes: [String: Decode] = [:]
  private var tokenOwner: [Int: String] = [:]
  private var nextToken = 1
  private var indexDirty = false

  private init() {
    directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("infinite-media/image", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let indexURL = directory.appendingPathComponent("index.json")
    if let data = try? Data(contentsOf: indexURL), let decoded = try? JSONDecoder().decode(CacheIndex.self, from: data) {
      index = decoded
    } else {
      index = CacheIndex(budget: 200 * 1024 * 1024)
      try? FileManager.default.removeItem(at: directory)
      try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    memory.totalCostLimit = 64 * 1024 * 1024
    let config = URLSessionConfiguration.default
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 15
    session = URLSession(configuration: config)
  }

  // MARK: - Config

  func setDiskBudget(_ bytes: Int64) { queue.async { self.index.budget = bytes } }
  func setMemoryBudget(_ bytes: Int) { memory.totalCostLimit = bytes }
  func trimMemory() { memory.removeAllObjects() }

  // MARK: - Loading

  static func memoryKey(_ key: String, _ target: Target) -> String {
    "\(key)@\(target.width)x\(target.height)\(target.cover ? "c" : "f")"
  }

  /** Main thread, synchronous memory lookup. */
  func cached(_ key: String, _ target: Target) -> UIImage? {
    memory.object(forKey: Self.memoryKey(key, target) as NSString)
  }

  /** Returns a token for `cancel`. Completion runs on main, never synchronously. */
  @discardableResult
  func load(key: String, url: URL, headers: [String: String]?, target: Target, priority: Priority,
            completion: @escaping Completion) -> Int {
    let token = nextTokenValue()
    let memKey = Self.memoryKey(key, target)
    queue.async {
      self.tokenOwner[token] = memKey
      if let decode = self.decodes[memKey] {
        decode.waiters[token] = completion
        return
      }
      let decode = Decode()
      decode.waiters[token] = completion
      self.decodes[memKey] = decode
      self.fetch(key: key, url: url, headers: headers, priority: priority, speculative: false) { result in
        switch result {
        case .failure(let error): self.finishDecode(memKey, .failure(error))
        case .success(let file): self.decode(file, key: key, memKey: memKey, target: target, decode: decode)
        }
      }
    }
    return token
  }

  func cancel(_ token: Int) {
    queue.async {
      guard let memKey = self.tokenOwner.removeValue(forKey: token), let decode = self.decodes[memKey] else { return }
      decode.waiters.removeValue(forKey: token)
      if decode.waiters.isEmpty {
        decode.cancelled = true
        self.decodes.removeValue(forKey: memKey)
      }
    }
  }

  /** Disk only. */
  func prefetch(key: String, url: URL, headers: [String: String]?, priority: Priority) {
    queue.async {
      self.fetch(key: key, url: url, headers: headers, priority: priority, speculative: true) { _ in }
    }
  }

  /** Cancels speculative downloads for keys not in `keep`. */
  func cancelPrefetches(except keep: Set<String>) {
    queue.async {
      for (key, download) in self.downloads where download.speculative && !keep.contains(key) {
        download.task?.cancel()
      }
    }
  }

  func remove(_ key: String) {
    queue.sync {
      try? FileManager.default.removeItem(at: file(key))
      index.remove(key)
      indexDirty = true
    }
    // Memory entries are keyed by size too, cheaper to drop them all than to track sizes.
    memory.removeAllObjects()
  }

  func clear() {
    queue.sync {
      try? FileManager.default.removeItem(at: directory)
      try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      index.removeAll()
      persistIndex()
    }
    memory.removeAllObjects()
  }

  func size() -> Int64 { queue.sync { index.totalBytes } }
  func status(_ key: String) -> (state: String, bytes: Int64) { queue.sync { index.status(key) } }

  // MARK: - Internals (queue)

  private func nextTokenValue() -> Int {
    // Tokens are only handed out on main.
    dispatchPrecondition(condition: .onQueue(.main))
    defer { nextToken += 1 }
    return nextToken
  }

  private func file(_ key: String) -> URL { directory.appendingPathComponent(RangeStore.fileName(key)) }

  private func fetch(key: String, url: URL, headers: [String: String]?, priority: Priority, speculative: Bool,
                     completion: @escaping (Result<URL, MediaError>) -> Void) {
    let target = file(key)
    if FileManager.default.fileExists(atPath: target.path) {
      index.touch(key, now: Date().timeIntervalSince1970)
      indexDirty = true
      completion(.success(target))
      return
    }
    if url.isFileURL {
      completion(.success(url))
      return
    }
    if let existing = downloads[key] {
      existing.waiters.append(completion)
      if !speculative {
        existing.speculative = false
        existing.task?.priority = Self.taskPriority(priority)
      }
      return
    }
    let download = Download()
    download.speculative = speculative
    download.waiters.append(completion)
    downloads[key] = download
    var request = URLRequest(url: url)
    for (k, v) in headers ?? [:] { request.setValue(v, forHTTPHeaderField: k) }
    let task = session.downloadTask(with: request) { tmp, response, error in
      // The temp file is gone once this closure returns, so move it first.
      var result: Result<URL, MediaError>
      if let error {
        result = .failure(MediaError.from(error))
      } else if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
        result = .failure(MediaError.http(http.statusCode))
      } else if let tmp {
        do {
          try? FileManager.default.removeItem(at: target)
          try FileManager.default.moveItem(at: tmp, to: target)
          result = .success(target)
        } catch {
          result = .failure(MediaError(code: "CACHE_CORRUPT", message: error.localizedDescription, retryable: true))
        }
      } else {
        result = .failure(MediaError(code: "UNKNOWN", message: "empty response", retryable: true))
      }
      self.queue.async {
        self.downloads.removeValue(forKey: key)
        if case .success(let file) = result {
          let bytes = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 } ?? 0
          self.index.record(key, bytes: Int64(bytes), totalBytes: Int64(bytes), now: Date().timeIntervalSince1970)
          self.evictIfNeeded(keep: key)
        }
        download.waiters.forEach { $0(result) }
      }
    }
    task.priority = Self.taskPriority(priority)
    download.task = task
    task.resume()
  }

  private func decode(_ file: URL, key: String, memKey: String, target: Target, decode: Decode) {
    guard !decode.cancelled else { return }
    decodeQueue.addOperation {
      let image = Self.downsample(file, target: target)
      self.queue.async {
        guard let image else {
          // A cached file that won't decode is dropped so the next attempt refetches it.
          if file.path.hasPrefix(self.directory.path) {
            try? FileManager.default.removeItem(at: file)
            self.index.remove(key)
          }
          self.finishDecode(memKey, .failure(MediaError(code: "IMAGE_DECODE_FAILED", message: "decode failed", retryable: true)))
          return
        }
        let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
        self.memory.setObject(image, forKey: memKey as NSString, cost: cost)
        self.finishDecode(memKey, .success(image))
      }
    }
  }

  private func finishDecode(_ memKey: String, _ result: Result<UIImage, MediaError>) {
    guard let decode = decodes.removeValue(forKey: memKey) else { return }
    let waiters = decode.waiters
    for token in waiters.keys { tokenOwner.removeValue(forKey: token) }
    DispatchQueue.main.async { waiters.values.forEach { $0(result) } }
  }

  private func evictIfNeeded(keep: String) {
    for key in index.evictions(pinned: [keep]) {
      try? FileManager.default.removeItem(at: file(key))
      index.remove(key)
    }
    indexDirty = true
    persistIndexSoon()
  }

  private var persistScheduled = false
  private func persistIndexSoon() {
    guard !persistScheduled else { return }
    persistScheduled = true
    queue.asyncAfter(deadline: .now() + 2) {
      self.persistScheduled = false
      if self.indexDirty { self.persistIndex() }
    }
  }

  private func persistIndex() {
    indexDirty = false
    if let data = try? JSONEncoder().encode(index) {
      try? data.write(to: directory.appendingPathComponent("index.json"), options: .atomic)
    }
  }

  private static func taskPriority(_ p: Priority) -> Float {
    switch p {
    case .p0: return URLSessionTask.highPriority
    case .p1: return URLSessionTask.defaultPriority
    default: return URLSessionTask.lowPriority
    }
  }

  /** Decodes straight to the size needed for the target, never the full source. */
  static func downsample(_ file: URL, target: Target) -> UIImage? {
    let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithURL(file as CFURL, sourceOptions),
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let w = props[kCGImagePropertyPixelWidth] as? CGFloat, let h = props[kCGImagePropertyPixelHeight] as? CGFloat,
          w > 0, h > 0
    else { return nil }
    // EXIF orientations 5 to 8 swap the axes.
    let orientation = props[kCGImagePropertyOrientation] as? UInt32 ?? 1
    let (iw, ih) = orientation >= 5 ? (h, w) : (w, h)
    let tw = CGFloat(max(1, target.width)), th = CGFloat(max(1, target.height))
    let scale = target.cover ? max(tw / iw, th / ih) : min(tw / iw, th / ih)
    let maxPixel = min(max(iw, ih), ceil(max(iw, ih) * scale))
    let options = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ] as CFDictionary
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
    return UIImage(cgImage: cg)
  }
}

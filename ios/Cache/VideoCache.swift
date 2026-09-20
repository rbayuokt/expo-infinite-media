import AVFoundation
import Foundation
import UniformTypeIdentifiers

/**
 Disk cache for progressive video, fed through AVAssetResourceLoader so preload bytes and
 playback bytes are the same bytes. HLS and file URLs bypass it.

 Everything here runs on `store.queue`: loader callbacks, URLSession delegate callbacks and
 file IO. One queue, no locks.
 */
final class VideoCache: NSObject {
  static let shared = VideoCache()
  static let scheme = "imcache"

  private struct Source {
    let key: String
    let url: URL
    let headers: [String: String]
  }

  private final class Fetch {
    let key: String
    let start: Int64
    var written: Int64 = 0
    /** Bytes to drop when a server ignores Range and answers 200 from byte 0. */
    var skip: Int64 = 0
    var failed = false
    init(key: String, start: Int64) {
      self.key = key
      self.start = start
    }
  }

  private final class LoaderJob {
    let request: AVAssetResourceLoadingRequest
    let source: Source
    var cursor: Int64
    let end: Int64?
    var fetch: Fetch?
    var task: URLSessionDataTask?
    init(request: AVAssetResourceLoadingRequest, source: Source) {
      self.request = request
      self.source = source
      if let data = request.dataRequest {
        cursor = data.requestedOffset
        end = data.requestsAllDataToEndOfResource ? nil : data.requestedOffset + Int64(data.requestedLength) - 1
      } else {
        cursor = 0
        end = nil
      }
    }
  }

  private final class PreloadJob {
    let fetch: Fetch
    let task: URLSessionDataTask
    let limit: Int64
    var completions: [() -> Void] = []
    init(fetch: Fetch, task: URLSessionDataTask, limit: Int64) {
      self.fetch = fetch
      self.task = task
      self.limit = limit
    }
  }

  struct Stats {
    var bytesActive: Int64 = 0
    var bytesSpeculative: Int64 = 0
    var bytesWasted: Int64 = 0
    var preloadCancels = 0
    var hits = 0
    var misses = 0
  }

  let store: RangeStore
  private var index: CacheIndex
  private var sources: [String: Source] = [:]
  private var sourceOrder: [String] = []
  private var jobs: [LoaderJob] = []
  private var jobsByTask: [Int: LoaderJob] = [:]
  private var preloads: [String: PreloadJob] = [:]
  private var preloadsByTask: [Int: PreloadJob] = [:]
  /** Speculative bytes per key that playback hasn't touched yet. */
  private var unplayed: [String: Int64] = [:]
  private var pinned: Set<String> = []
  /**
   Keys whose player already holds enough buffer. AVFoundation asks for data to the end of the
   file whatever its buffer setting says, so without this the loader races ahead and starves
   every other download on the connection.
   */
  private var satisfied: Set<String> = []
  /** Last HTTP failure per key. AVFoundation doesn't always pass our error's userInfo through. */
  private var httpFailures: [String: Int] = [:]
  private var stats = Stats()
  private var flushScheduled = false
  private var session: URLSession!

  private override init() {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("infinite-media/video", isDirectory: true)
    store = RangeStore(directory: dir)
    let indexURL = dir.appendingPathComponent("index.json")
    if let data = try? Data(contentsOf: indexURL), let decoded = try? JSONDecoder().decode(CacheIndex.self, from: data) {
      index = decoded
    } else {
      // No index means we can't account for what's on disk, so start clean.
      index = CacheIndex(budget: 500 * 1024 * 1024)
      store.removeAll()
    }
    super.init()
    let config = URLSessionConfiguration.default
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.urlCache = nil
    config.timeoutIntervalForRequest = 15
    config.httpMaximumConnectionsPerHost = 4
    let delegateQueue = OperationQueue()
    delegateQueue.underlyingQueue = store.queue
    delegateQueue.maxConcurrentOperationCount = 1
    session = URLSession(configuration: config, delegate: self, delegateQueue: delegateQueue)
  }

  private var indexURL: URL { store.directory.appendingPathComponent("index.json") }

  // MARK: - Public API (any thread)

  func setBudget(_ bytes: Int64) {
    store.queue.async {
      self.index.budget = bytes
      self.scheduleFlush()
    }
  }

  static func isCacheable(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
    let ext = url.pathExtension.lowercased()
    return ext != "m3u8" && ext != "mpd"
  }

  /** Main thread. Returns the asset AVPlayer should use and whether it'll start from cache. */
  func makeAsset(for item: NativeItem) -> (asset: AVURLAsset, fromCache: Bool)? {
    guard let url = item.url else { return nil }
    let headers = item.headers ?? [:]
    guard Self.isCacheable(url), var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      let options: [String: Any] = headers.isEmpty ? [:] : ["AVURLAssetHTTPHeaderFieldsKey": headers]
      return (AVURLAsset(url: url, options: options), false)
    }
    comps.scheme = "\(Self.scheme)-\(url.scheme!.lowercased())"
    guard let custom = comps.url else { return nil }
    let key = item.key
    let fromCache = store.queue.sync { () -> Bool in
      register(custom.absoluteString, Source(key: key, url: url, headers: headers))
      return store.meta(key).available(at: 0) > 0
    }
    let asset = AVURLAsset(url: custom)
    asset.resourceLoader.setDelegate(self, queue: store.queue)
    return (asset, fromCache)
  }

  /** Caches the first `bytes` of the resource. Completion runs on the IO queue. */
  func preload(_ item: NativeItem, bytes: Int64, priority: Float, completion: (() -> Void)? = nil) {
    guard let url = item.url, Self.isCacheable(url) else {
      completion?()
      return
    }
    store.queue.async {
      let key = item.key
      if let existing = self.preloads[key] {
        existing.task.priority = priority
        if let completion { existing.completions.append(completion) }
        return
      }
      let meta = self.store.meta(key)
      let have = meta.available(at: 0)
      let limit = meta.contentLength.map { min($0, bytes) } ?? bytes
      guard have < limit else {
        completion?()
        return
      }
      var request = URLRequest(url: url)
      for (k, v) in item.headers ?? [:] { request.setValue(v, forHTTPHeaderField: k) }
      request.setValue("bytes=\(have)-\(limit - 1)", forHTTPHeaderField: "Range")
      let task = self.session.dataTask(with: request)
      task.priority = priority
      let job = PreloadJob(fetch: Fetch(key: key, start: have), task: task, limit: limit)
      if let completion { job.completions.append(completion) }
      self.preloads[key] = job
      self.preloadsByTask[task.taskIdentifier] = job
      task.resume()
    }
  }

  func cancelPreload(_ key: String) {
    store.queue.async { self.cancelPreloadLocked(key) }
  }

  /** Cancels speculative downloads not in `keep`. */
  func cancelPreloads(except keep: Set<String>) {
    store.queue.async {
      for key in self.preloads.keys where !keep.contains(key) { self.cancelPreloadLocked(key) }
    }
  }

  func setPinned(_ keys: Set<String>) {
    store.queue.async { self.pinned = keys }
  }

  /** From the buffer sampler: true holds read-ahead for that item, false lets it run again. */
  func setReadAheadPaused(_ key: String, _ paused: Bool) {
    store.queue.async {
      let was = self.satisfied.contains(key)
      if paused { self.satisfied.insert(key) } else { self.satisfied.remove(key) }
      guard was && !paused else { return }
      for job in self.jobs where job.source.key == key && job.task == nil { self.drive(job) }
    }
  }

  func remove(_ key: String) {
    store.queue.sync {
      cancelPreloadLocked(key)
      store.remove(key)
      index.remove(key)
      unplayed.removeValue(forKey: key)
      scheduleFlush()
    }
  }

  func clear() {
    store.queue.sync {
      for key in Array(preloads.keys) { cancelPreloadLocked(key) }
      store.removeAll()
      index.removeAll()
      unplayed.removeAll()
      persistIndex()
    }
  }

  func size() -> Int64 { store.queue.sync { index.totalBytes } }

  func lastHTTPFailure(_ key: String) -> Int? { store.queue.sync { httpFailures[key] } }

  func status(_ key: String) -> (state: String, bytes: Int64) { store.queue.sync { index.status(key) } }

  func snapshotStats() -> Stats { store.queue.sync { stats } }

  // MARK: - IO queue internals

  private func register(_ url: String, _ source: Source) {
    if sources[url] == nil { sourceOrder.append(url) }
    sources[url] = source
    if sourceOrder.count > 256 {
      let drop = sourceOrder.removeFirst()
      sources.removeValue(forKey: drop)
    }
  }

  private func cancelPreloadLocked(_ key: String) {
    guard let job = preloads.removeValue(forKey: key) else { return }
    preloadsByTask.removeValue(forKey: job.task.taskIdentifier)
    job.task.cancel()
    stats.preloadCancels += 1
    let completions = job.completions
    job.completions.removeAll()
    completions.forEach { $0() }
  }

  private func drive(_ job: LoaderJob) {
    guard jobs.contains(where: { $0 === job }), job.task == nil else { return }
    let key = job.source.key
    let meta = store.meta(key)
    let needsInfo = job.request.contentInformationRequest != nil && meta.contentLength == nil
    if let info = job.request.contentInformationRequest, meta.contentLength != nil { fill(info, meta: meta) }

    guard job.request.dataRequest != nil else {
      if needsInfo { startFetch(job, from: 0, to: 1) } else { finish(job) }
      return
    }
    if let end = job.end, job.cursor > end { return finish(job) }
    if let length = meta.contentLength, job.cursor >= length { return finish(job) }

    let available = needsInfo ? 0 : meta.available(at: job.cursor)
    if available > 0 {
      let remaining = job.end.map { $0 - job.cursor + 1 } ?? available
      let count = Int(min(available, remaining, 256 * 1024))
      do {
        let data = try store.read(key, offset: job.cursor, length: count)
        job.request.dataRequest?.respond(with: data)
        job.cursor += Int64(count)
      } catch {
        // Corrupt span: drop the entry and fetch it fresh.
        Log.warn("cache read failed for \(key), evicting")
        store.remove(key)
        index.remove(key)
      }
      // Yield between chunks so other requests on this queue get a turn.
      store.queue.async { self.drive(job) }
      return
    }

    // The player already holds enough. Wait instead of reading on to the end of the file.
    if satisfied.contains(key) {
      store.queue.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.drive(job) }
      return
    }

    var upTo = job.end
    if let next = meta.nextCachedStart(after: job.cursor) { upTo = min(upTo ?? .max, next - 1) }
    startFetch(job, from: job.cursor, to: upTo)
  }

  private func startFetch(_ job: LoaderJob, from start: Int64, to end: Int64?) {
    var request = URLRequest(url: job.source.url)
    for (k, v) in job.source.headers { request.setValue(v, forHTTPHeaderField: k) }
    request.setValue("bytes=\(start)-\(end.map(String.init) ?? "")", forHTTPHeaderField: "Range")
    let task = session.dataTask(with: request)
    task.priority = URLSessionTask.highPriority
    job.fetch = Fetch(key: job.source.key, start: start)
    job.task = task
    jobsByTask[task.taskIdentifier] = job
    // Playback caught up with a speculative download, so those bytes weren't wasted.
    unplayed.removeValue(forKey: job.source.key)
    task.resume()
  }

  private func fill(_ info: AVAssetResourceLoadingContentInformationRequest, meta: RangeMeta) {
    let mime = meta.contentType ?? "video/mp4"
    info.contentType = UTType(mimeType: mime)?.identifier ?? UTType.mpeg4Movie.identifier
    info.contentLength = meta.contentLength ?? 0
    info.isByteRangeAccessSupported = true
  }

  private func finish(_ job: LoaderJob, error: Error? = nil) {
    job.task?.cancel()
    if let task = job.task { jobsByTask.removeValue(forKey: task.taskIdentifier) }
    job.task = nil
    jobs.removeAll { $0 === job }
    if !job.request.isFinished && !job.request.isCancelled {
      if let error { job.request.finishLoading(with: error) } else { job.request.finishLoading() }
    }
    unplayed.removeValue(forKey: job.source.key)
    scheduleFlush()
  }

  private func scheduleFlush() {
    guard !flushScheduled else { return }
    flushScheduled = true
    store.queue.asyncAfter(deadline: .now() + 2) {
      self.flushScheduled = false
      self.store.flush()
      self.evictIfNeeded()
      self.persistIndex()
      let reading = Set(self.jobs.map { $0.source.key }).union(self.preloads.keys)
      self.store.closeHandles(except: reading)
    }
  }

  private func evictIfNeeded() {
    let busy = pinned.union(jobs.map { $0.source.key }).union(preloads.keys)
    for key in index.evictions(pinned: busy) {
      if let wasted = unplayed.removeValue(forKey: key) { stats.bytesWasted += wasted }
      store.remove(key)
      index.remove(key)
    }
  }

  private func persistIndex() {
    if let data = try? JSONEncoder().encode(index) { try? data.write(to: indexURL, options: .atomic) }
  }

  private func record(_ key: String) {
    let meta = store.meta(key)
    index.record(key, bytes: meta.cachedBytes, totalBytes: meta.contentLength, now: Date().timeIntervalSince1970)
  }

  /** Handles headers for loader fetches and preloads. A non-nil error stops the task. */
  private func accept(_ response: URLResponse, fetch: Fetch) -> Error? {
    guard let http = response as? HTTPURLResponse else { return nil }
    guard (200..<300).contains(http.statusCode) else {
      httpFailures[fetch.key] = http.statusCode
      return NSError(domain: NSURLErrorDomain, code: NSURLErrorBadServerResponse,
                     userInfo: [MediaError.httpStatusKey: http.statusCode])
    }
    httpFailures.removeValue(forKey: fetch.key)
    var total: Int64?
    if let range = http.value(forHTTPHeaderField: "Content-Range"), let slash = range.lastIndex(of: "/") {
      total = Int64(range[range.index(after: slash)...])
    } else if http.statusCode == 200, http.expectedContentLength > 0 {
      total = http.expectedContentLength
      fetch.skip = fetch.start
    }
    let type = http.mimeType.flatMap { $0.hasPrefix("video/") || $0.hasPrefix("audio/") ? $0 : nil }
    store.setInfo(fetch.key, contentLength: total, contentType: type)
    return nil
  }

  /** Writes a chunk and returns the part that belongs after the skip, positioned at its offset. */
  private func save(_ data: Data, fetch: Fetch) -> (offset: Int64, data: Data)? {
    var chunk = data
    if fetch.skip > 0 {
      let drop = Int(min(fetch.skip, Int64(chunk.count)))
      chunk = chunk.subdata(in: drop..<chunk.count)
      fetch.skip -= Int64(drop)
      if chunk.isEmpty { return nil }
    }
    let offset = fetch.start + fetch.written
    do {
      try store.write(fetch.key, offset: offset, data: chunk)
    } catch {
      fetch.failed = true
      Log.warn("cache write failed for \(fetch.key): \(error.localizedDescription)")
    }
    fetch.written += Int64(chunk.count)
    record(fetch.key)
    return (offset, chunk)
  }
}

// MARK: - AVAssetResourceLoaderDelegate

extension VideoCache: AVAssetResourceLoaderDelegate {
  func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                      shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
    guard let url = loadingRequest.request.url?.absoluteString, let source = sources[url] else { return false }
    let job = LoaderJob(request: loadingRequest, source: source)
    jobs.append(job)
    if loadingRequest.dataRequest != nil {
      if store.meta(source.key).available(at: job.cursor) > 0 { stats.hits += 1 } else { stats.misses += 1 }
    }
    // A preload for the item now on screen is no longer speculative.
    preloads[source.key]?.task.priority = URLSessionTask.highPriority
    drive(job)
    return true
  }

  func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
    guard let job = jobs.first(where: { $0.request === loadingRequest }) else { return }
    finish(job)
  }
}

// MARK: - URLSessionDataDelegate

extension VideoCache: URLSessionDataDelegate {
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    let id = dataTask.taskIdentifier
    if let job = jobsByTask[id], let fetch = job.fetch {
      if let error = accept(response, fetch: fetch) {
        completionHandler(.cancel)
        finish(job, error: error)
        return
      }
      if let info = job.request.contentInformationRequest {
        fill(info, meta: store.meta(fetch.key))
        if job.request.dataRequest == nil {
          completionHandler(.cancel)
          finish(job)
          return
        }
      }
      completionHandler(.allow)
    } else if let preload = preloadsByTask[id] {
      if accept(response, fetch: preload.fetch) != nil {
        completionHandler(.cancel)
        preloadsByTask.removeValue(forKey: id)
        preloads.removeValue(forKey: preload.fetch.key)
        preload.completions.forEach { $0() }
        return
      }
      completionHandler(.allow)
    } else {
      completionHandler(.cancel)
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    let id = dataTask.taskIdentifier
    if let job = jobsByTask[id], let fetch = job.fetch {
      stats.bytesActive += Int64(data.count)
      guard let (offset, chunk) = save(data, fetch: fetch) else { return }
      // Only answer with bytes at the cursor; anything else is already on disk for later.
      guard offset == job.cursor else { return }
      var answer = chunk
      if let end = job.end, job.cursor + Int64(chunk.count) - 1 > end {
        answer = chunk.prefix(Int(end - job.cursor + 1))
      }
      job.request.dataRequest?.respond(with: answer)
      job.cursor += Int64(answer.count)
      if let end = job.end, job.cursor > end { finish(job) }
    } else if let preload = preloadsByTask[id] {
      stats.bytesSpeculative += Int64(data.count)
      unplayed[preload.fetch.key, default: 0] += Int64(data.count)
      _ = save(data, fetch: preload.fetch)
      if preload.fetch.start + preload.fetch.written >= preload.limit { dataTask.cancel() }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let id = task.taskIdentifier
    scheduleFlush()
    if let job = jobsByTask.removeValue(forKey: id) {
      job.task = nil
      job.fetch = nil
      if let error = error as NSError?, error.code != NSURLErrorCancelled {
        finish(job, error: error)
      } else if jobs.contains(where: { $0 === job }) {
        drive(job)
      }
    } else if let preload = preloadsByTask.removeValue(forKey: id) {
      preloads.removeValue(forKey: preload.fetch.key)
      preload.completions.forEach { $0() }
    }
  }
}

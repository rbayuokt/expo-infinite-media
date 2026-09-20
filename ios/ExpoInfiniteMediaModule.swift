import ExpoModulesCore

public class ExpoInfiniteMediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoInfiniteMedia")

    OnCreate {
      // Build the singletons on main before any session needs them.
      DispatchQueue.main.async { _ = Coordinator.shared }
    }

    OnAppEntersBackground {
      Coordinator.shared.appDidEnterBackground()
    }

    OnAppEntersForeground {
      Coordinator.shared.appWillEnterForeground()
    }

    Function("configure") { (options: ConfigureOptions) in
      if let level = options.logLevel { Log.level = LogLevel(name: level) }
      if let bytes = options.maxVideoDiskBytes { VideoCache.shared.setBudget(bytes) }
      if let bytes = options.maxImageDiskBytes { ImagePipeline.shared.setDiskBudget(bytes) }
      if let bytes = options.maxImageMemoryBytes { ImagePipeline.shared.setMemoryBudget(bytes) }
      if let mix = options.mixWithOthers {
        DispatchQueue.main.async { Coordinator.shared.mixWithOthers = mix }
      }
    }

    AsyncFunction("preload") { (items: [NativeItem], promise: Promise) in
      let group = DispatchGroup()
      for item in items {
        guard let url = item.url else { continue }
        group.enter()
        if item.isVideo {
          VideoCache.shared.preload(item, bytes: 1536 * 1024, priority: URLSessionTask.lowPriority) { group.leave() }
          if let poster = item.posterURL {
            ImagePipeline.shared.prefetch(key: "poster:" + item.key, url: poster, headers: item.headers, priority: .p3)
          }
        } else {
          ImagePipeline.shared.prefetch(key: item.key, url: url, headers: item.headers, priority: .p3)
          group.leave()
        }
      }
      group.notify(queue: .main) { promise.resolve() }
    }

    Function("cancelPreload") { (ids: [String]) in
      ids.forEach { VideoCache.shared.cancelPreload($0) }
    }

    AsyncFunction("clearCache") {
      VideoCache.shared.clear()
      ImagePipeline.shared.clear()
    }

    AsyncFunction("removeFromCache") { (key: String) in
      VideoCache.shared.remove(key)
      VideoCache.shared.remove("poster:" + key)
      ImagePipeline.shared.remove(key)
      ImagePipeline.shared.remove("poster:" + key)
    }

    AsyncFunction("getCacheSize") { () -> [String: Int64] in
      ["videoBytes": VideoCache.shared.size(), "imageBytes": ImagePipeline.shared.size()]
    }

    AsyncFunction("getCacheStatus") { (key: String) -> [String: Any] in
      let video = VideoCache.shared.status(key)
      let status = video.state != "none" ? video : ImagePipeline.shared.status(key)
      return ["state": status.state, "bytes": status.bytes]
    }

    // Session calls return immediately and run on main in call order.
    Class(FeedSession.self) {
      Constructor { () -> FeedSession in
        FeedSession()
      }

      Function("setItems") { (session: FeedSession, items: [NativeItem]) in
        DispatchQueue.main.async { session.setItems(items) }
      }

      Function("appendItems") { (session: FeedSession, items: [NativeItem]) in
        DispatchQueue.main.async { session.appendItems(items) }
      }

      Function("setConfig") { (session: FeedSession, config: SessionConfig) in
        DispatchQueue.main.async { session.setConfig(config) }
      }

      Function("play") { (session: FeedSession) in
        DispatchQueue.main.async { session.play() }
      }

      Function("pause") { (session: FeedSession) in
        DispatchQueue.main.async { session.pause() }
      }

      Function("seekTo") { (session: FeedSession, seconds: Double, precise: Bool?) in
        DispatchQueue.main.async { session.seek(to: seconds, precise: precise ?? true) }
      }

      Function("setMuted") { (session: FeedSession, muted: Bool) in
        DispatchQueue.main.async { session.setMuted(muted) }
      }

      Function("retry") { (session: FeedSession) in
        DispatchQueue.main.async { session.retry() }
      }
    }

    View(MediaSlotView.self) {
      Prop("session") { (view: MediaSlotView, session: FeedSession?) in
        view.session = session
      }

      Prop("itemId") { (view: MediaSlotView, itemId: String?) in
        view.itemId = itemId
      }

      Prop("resizeMode") { (view: MediaSlotView, mode: String?) in
        view.cover = mode != "contain"
      }

      OnViewDidUpdateProps { view in
        view.propsDidUpdate()
      }
    }
  }
}

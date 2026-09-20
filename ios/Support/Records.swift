import ExpoModulesCore

struct NativeItem: Record, Equatable {
  @Field var id: String = ""
  @Field var type: String = "video"
  @Field var uri: String = ""
  @Field var poster: String?
  @Field var headers: [String: String]?
  @Field var cacheKey: String?

  var isVideo: Bool { type == "video" }
  var key: String { cacheKey ?? id }
  var url: URL? { URL(string: uri) }
  var posterURL: URL? { poster.flatMap(URL.init(string:)) }

  static func == (a: NativeItem, b: NativeItem) -> Bool {
    a.id == b.id && a.type == b.type && a.uri == b.uri && a.poster == b.poster
      && a.headers == b.headers && a.cacheKey == b.cacheKey
  }
}

struct SessionConfig: Record {
  @Field var active: Bool = true
  @Field var autoplay: Bool = true
  @Field var loop: Bool = true
  @Field var muted: Bool = false
  @Field var preloadAhead: Int = 2
  @Field var preloadBehind: Int = 1
  @Field var resumeOnForeground: Bool = true
  @Field var progressInterval: Int = 0
  @Field var diagnostics: Bool = false
}

struct ConfigureOptions: Record {
  @Field var maxVideoDiskBytes: Int64?
  @Field var maxImageDiskBytes: Int64?
  @Field var maxImageMemoryBytes: Int?
  @Field var logLevel: String?
  @Field var mixWithOthers: Bool?
}

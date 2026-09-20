package expo.modules.infinitemedia

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class NativeItemRecord : Record {
  @Field val id: String = ""
  @Field val type: String = "video"
  @Field val uri: String = ""
  @Field val poster: String? = null
  @Field val headers: Map<String, String>? = null
  @Field val cacheKey: String? = null
}

class SessionConfigRecord : Record {
  @Field val active: Boolean = true
  @Field val autoplay: Boolean = true
  @Field val loop: Boolean = true
  @Field val muted: Boolean = false
  @Field val preloadAhead: Int = 2
  @Field val preloadBehind: Int = 1
  @Field val resumeOnForeground: Boolean = true
  @Field val progressInterval: Int = 0
  @Field val diagnostics: Boolean = false
}

class ConfigureRecord : Record {
  @Field val maxVideoDiskBytes: Double? = null
  @Field val maxImageDiskBytes: Double? = null
  @Field val maxImageMemoryBytes: Double? = null
  @Field val logLevel: String? = null
  @Field val mixWithOthers: Boolean? = null
}

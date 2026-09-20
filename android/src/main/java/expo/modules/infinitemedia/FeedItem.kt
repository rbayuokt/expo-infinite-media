package expo.modules.infinitemedia

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util

@OptIn(UnstableApi::class)
internal class FeedItem(
  val id: String,
  val isVideo: Boolean,
  val uri: String,
  val poster: String?,
  val headers: Map<String, String>,
  cacheKey: String?
) {
  /** What caches are keyed by. */
  val key: String = cacheKey ?: id

  /** Plain files. HLS and DASH can't take a custom cache key or a byte-range pre-cache. */
  val isProgressive: Boolean by lazy { Util.inferContentType(Uri.parse(uri)) == C.CONTENT_TYPE_OTHER }

  val mediaItem: MediaItem by lazy {
    MediaItem.Builder().setMediaId(id).setUri(uri).apply { if (isProgressive) setCustomCacheKey(key) }.build()
  }

  /** Same content as another record for the same id, so a replace can keep its state. */
  fun sameContent(o: FeedItem) =
    isVideo == o.isVideo && uri == o.uri && poster == o.poster && headers == o.headers && key == o.key

  companion object {
    fun from(r: NativeItemRecord) = FeedItem(r.id, r.type != "image", r.uri, r.poster, r.headers ?: emptyMap(), r.cacheKey)
  }
}

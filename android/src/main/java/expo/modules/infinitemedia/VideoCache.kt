package expo.modules.infinitemedia

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** Bounded disk cache for video bytes, shared by players, the preload manager and preload(). */
@OptIn(UnstableApi::class)
internal class VideoCache(ctx: Context, maxBytes: Long, private val onBytes: (key: String?, bytes: Long) -> Unit) {
  val cache = SimpleCache(
    File(ctx.cacheDir, "infinite-media/video"),
    LeastRecentlyUsedCacheEvictor(maxBytes),
    StandaloneDatabaseProvider(ctx)
  )

  // Per-item request headers, looked up by uri since MediaItem has no header field.
  private val headers = ConcurrentHashMap<String, Map<String, String>>()

  private val counter = object : TransferListener {
    override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) = Unit
    override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) = Unit
    override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) = Unit
    override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
      if (isNetwork) onBytes(dataSpec.key, bytesTransferred.toLong())
    }
  }

  private val http = DefaultHttpDataSource.Factory()
    .setConnectTimeoutMs(8_000)
    .setReadTimeoutMs(8_000)
    .setAllowCrossProtocolRedirects(true)
    .setTransferListener(counter)

  /** Network (or file) source with per-item headers. The preload manager wraps it with the cache. */
  val upstream: DataSource.Factory = DefaultDataSource.Factory(
    ctx,
    ResolvingDataSource.Factory(http) { spec ->
      headers[spec.uri.toString()]?.let { spec.withAdditionalHeaders(it) } ?: spec
    }
  )

  /** Reads and writes the cache. Media3's default player source only reads it. */
  val readWrite: CacheDataSource.Factory = CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(upstream)

  fun register(item: FeedItem) {
    if (item.headers.isNotEmpty()) headers[item.uri] = item.headers
  }

  /** "none" | "partial" | "complete" with cached bytes. Does disk-backed lookups, call off main. */
  fun status(key: String): Pair<String, Long> {
    val bytes = cache.getCachedBytes(key, 0, C.LENGTH_UNSET.toLong())
    if (bytes <= 0) return "none" to 0L
    val length = ContentMetadata.getContentLength(cache.getContentMetadata(key))
    return (if (length > 0 && bytes >= length) "complete" else "partial") to bytes
  }

  fun size(): Long = cache.cacheSpace

  fun hasStart(key: String) = cache.isCached(key, 0, 64 * 1024)

  fun remove(key: String) = cache.removeResource(key)

  fun clear() = cache.keys.toList().forEach { cache.removeResource(it) }

  /** Caches the first [bytes] of an item. Blocking, run on IO. Cancel through the returned writer. */
  fun startupWriter(item: FeedItem, bytes: Long): CacheWriter {
    register(item)
    val spec = DataSpec.Builder()
      .setUri(item.uri)
      .setPosition(0)
      .setLength(bytes)
      .setKey(item.key)
      .build()
    return CacheWriter(readWrite.createDataSourceForDownloading(), spec, null, null)
  }
}

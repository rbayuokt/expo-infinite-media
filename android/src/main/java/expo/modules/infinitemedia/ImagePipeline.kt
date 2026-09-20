package expo.modules.infinitemedia

import android.content.Context
import android.widget.ImageView
import coil3.Image
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.CachePolicy
import coil3.request.Disposable
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.request.crossfade
import coil3.request.target
import okio.Path.Companion.toOkioPath
import java.io.File

/**
 * Images never touch the video path. Coil gives memory and disk caching, in-flight dedupe,
 * downsampling to the target view size and cancellation through [Disposable].
 */
internal class ImagePipeline(ctx: Context, maxDiskBytes: Long, maxMemoryBytes: Long?) {
  private val app = ctx.applicationContext

  val loader: ImageLoader = ImageLoader.Builder(app)
    .memoryCache {
      MemoryCache.Builder().apply {
        if (maxMemoryBytes != null) maxSizeBytes(maxMemoryBytes) else maxSizePercent(app, 0.125)
      }.build()
    }
    .diskCache {
      DiskCache.Builder()
        .directory(File(app.cacheDir, "infinite-media/images").toOkioPath())
        .maxSizeBytes(maxDiskBytes)
        .build()
    }
    .build()

  // Prefetches keyed by item id so the plan can cancel them. Main thread only.
  private val prefetches = HashMap<String, Disposable>()

  /**
   * Loads into the view without taking it over as Coil's target, so a second request for the
   * same view (the full photo over its poster) doesn't cancel this one.
   */
  fun displayDetached(
    view: ImageView,
    uri: String,
    key: String,
    headers: Map<String, String>,
    w: Int,
    h: Int,
    onReady: (Image) -> Unit,
    onError: (Throwable) -> Unit
  ): Disposable {
    val b = request(uri, key, headers)
    if (w > 0 && h > 0) b.size(w, h)
    return loader.enqueue(
      b.target(
        onSuccess = { image -> onReady(image) },
        onError = { }
      )
        .listener(onError = { _, result -> onError(result.throwable) })
        .build()
    )
  }

  /** decode=true warms the memory cache at [w]x[h], otherwise bytes go to disk only. */
  fun prefetch(id: String, uri: String, key: String, headers: Map<String, String>, decode: Boolean, w: Int, h: Int) {
    if (prefetches[id]?.isDisposed == false) return
    val b = request(uri, key, headers)
    if (decode && w > 0 && h > 0) {
      b.size(w, h)
    } else {
      // Tiny decode, the point is the disk write.
      b.size(64, 64).memoryCachePolicy(CachePolicy.DISABLED)
    }
    prefetches[id] = loader.enqueue(b.listener(onSuccess = { _, _ -> prefetches.remove(id) }).build())
  }

  /** Disk-only fetch that reports completion, cancellation included. Main only. */
  fun prefetchAwait(id: String, uri: String, key: String, headers: Map<String, String>, done: () -> Unit) {
    prefetches.remove(id)?.dispose()
    val request = request(uri, key, headers)
      .size(64, 64)
      .memoryCachePolicy(CachePolicy.DISABLED)
      .listener(
        onCancel = { done() },
        onError = { _, _ -> done() },
        onSuccess = { _, _ ->
          prefetches.remove(id)
          done()
        }
      )
      .build()
    prefetches[id] = loader.enqueue(request)
  }

  fun cancel(id: String) {
    prefetches.remove(id)?.dispose()
  }

  fun cancelAllExcept(keep: Set<String>) {
    val it = prefetches.entries.iterator()
    while (it.hasNext()) {
      val e = it.next()
      if (e.key !in keep) {
        e.value.dispose()
        it.remove()
      }
    }
  }

  val diskBytes: Long get() = loader.diskCache?.size ?: 0L

  fun isOnDisk(key: String): Long? = loader.diskCache?.openSnapshot(key)?.use { it.data.toFile().length() }

  fun remove(key: String) {
    loader.memoryCache?.remove(MemoryCache.Key(key))
    loader.diskCache?.remove(key)
  }

  fun clear() {
    loader.memoryCache?.clear()
    loader.diskCache?.clear()
  }

  fun trimMemory() = loader.memoryCache?.clear()

  private fun request(uri: String, key: String, headers: Map<String, String>): ImageRequest.Builder {
    val b = ImageRequest.Builder(app)
      .data(uri)
      .memoryCacheKey(key)
      .diskCacheKey(key)
      // Hardware bitmaps are cheaper to draw and live outside the Java heap.
      .allowHardware(true)
    if (headers.isNotEmpty()) {
      b.httpHeaders(NetworkHeaders.Builder().apply { headers.forEach { (k, v) -> set(k, v) } }.build())
    }
    return b
  }
}

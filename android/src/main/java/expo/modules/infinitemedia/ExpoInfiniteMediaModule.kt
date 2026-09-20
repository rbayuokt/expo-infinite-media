package expo.modules.infinitemedia

import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.cache.CacheWriter
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

@OptIn(UnstableApi::class)
class ExpoInfiniteMediaModule : Module() {
  // Module-level preload() writers, so cancelPreload() can stop them mid-download.
  private val writers = ConcurrentHashMap<String, CacheWriter>()

  override fun definition() = ModuleDefinition {
    Name("ExpoInfiniteMedia")

    OnCreate {
      Coordinator.init(appContext.reactContext ?: throw Exceptions.ReactContextLost())
    }

    OnDestroy {
      writers.values.forEach { it.cancel() }
      writers.clear()
      Coordinator.onDestroy()
    }

    OnActivityEntersBackground { Coordinator.onBackground() }
    OnActivityEntersForeground { Coordinator.onForeground() }

    Function("configure") { r: ConfigureRecord ->
      r.maxVideoDiskBytes?.let { Coordinator.maxVideoDiskBytes = it.toLong() }
      r.maxImageDiskBytes?.let { Coordinator.maxImageDiskBytes = it.toLong() }
      r.maxImageMemoryBytes?.let { Coordinator.maxImageMemoryBytes = it.toLong() }
      Log.setLevel(r.logLevel)
      // mixWithOthers is iOS only. Android audio focus has no equivalent that keeps other audio.
    }

    AsyncFunction("preload") Coroutine { records: List<NativeItemRecord> ->
      val items = records.map(FeedItem::from)
      coroutineScope {
        items.map { item -> async { preloadOne(item) } }.awaitAll()
      }
      Unit
    }

    Function("cancelPreload") { ids: List<String> ->
      ids.forEach { id -> writers.remove(id)?.cancel() }
      onMain { ids.forEach { Coordinator.images.cancel("preload:$it") } }
    }

    AsyncFunction("clearCache") Coroutine { ->
      withContext(Dispatchers.IO) {
        Coordinator.videoCache.clear()
        Coordinator.images.clear()
      }
      Unit
    }

    AsyncFunction("removeFromCache") Coroutine { key: String ->
      withContext(Dispatchers.IO) {
        Coordinator.videoCache.remove(key)
        Coordinator.images.remove(key)
        Coordinator.images.remove("$key#poster")
      }
      Unit
    }

    AsyncFunction("getCacheSize") Coroutine { ->
      withContext(Dispatchers.IO) {
        mapOf("videoBytes" to Coordinator.videoCache.size(), "imageBytes" to Coordinator.images.diskBytes)
      }
    }

    AsyncFunction("getCacheStatus") Coroutine { key: String ->
      withContext(Dispatchers.IO) {
        val (state, bytes) = Coordinator.videoCache.status(key)
        if (state != "none") {
          mapOf("state" to state, "bytes" to bytes)
        } else {
          // Images are stored whole or not at all.
          val image = Coordinator.images.isOnDisk(key)
          if (image != null) mapOf("state" to "complete", "bytes" to image) else mapOf("state" to "none", "bytes" to 0L)
        }
      }
    }

    Class(FeedSession::class) {
      Constructor { FeedSession(appContext) }

      // Sync from JS, then applied on main in call order. Nothing here blocks the JS thread.
      Function("setItems") { s: FeedSession, items: List<NativeItemRecord> -> onMain { s.setItems(items) } }
      Function("appendItems") { s: FeedSession, items: List<NativeItemRecord> -> onMain { s.appendItems(items) } }
      Function("setConfig") { s: FeedSession, config: SessionConfigRecord -> onMain { s.setConfig(config) } }
      Function("play") { s: FeedSession -> onMain { s.play() } }
      Function("pause") { s: FeedSession -> onMain { s.pause() } }
      Function("seekTo") { s: FeedSession, seconds: Double, precise: Boolean? ->
        onMain { s.seekTo(seconds, precise ?: true) }
      }
      Function("setMuted") { s: FeedSession, muted: Boolean -> onMain { s.setMuted(muted) } }
      Function("retry") { s: FeedSession -> onMain { s.retry() } }
    }

    View(MediaSlotView::class) {
      Prop("session") { view: MediaSlotView, session: FeedSession? -> view.session = session }
      Prop("itemId") { view: MediaSlotView, id: String? -> view.itemId = id }
      Prop("resizeMode") { view: MediaSlotView, mode: String? -> view.resizeMode = mode ?: "cover" }
      OnViewDestroys { view: MediaSlotView -> view.session = null }
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  private fun onMain(block: () -> Unit) {
    mainHandler.post(block)
  }

  private suspend fun preloadOne(item: FeedItem) {
    if (!item.isVideo) {
      withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
          Coordinator.images.prefetchAwait("preload:${item.id}", item.uri, item.key, item.headers) {
            if (cont.isActive) cont.resume(Unit)
          }
        }
      }
      return
    }
    // Streams aren't byte-range cached, the player warms them when they get close.
    if (!item.isProgressive) return
    withContext(Dispatchers.IO) {
      val writer = Coordinator.videoCache.startupWriter(item, STARTUP_BYTES)
      writers[item.id] = writer
      try {
        writer.cache()
      } catch (e: Exception) {
        // Cancelled or failed: preload is best effort, playback will fetch on its own.
        Log.d("preload ${item.id} stopped: ${e.message}")
      } finally {
        writers.remove(item.id, writer)
      }
    }
  }

  companion object {
    private const val STARTUP_BYTES = 1536L * 1024
  }
}

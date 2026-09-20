package expo.modules.infinitemedia

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.Cache
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.preload.DefaultPreloadManager
import androidx.media3.exoplayer.source.preload.MediaSourceFactorySupplier
import java.util.concurrent.atomic.AtomicLong

/**
 * Process-wide owner of everything expensive: the cache, the preload manager, the player pool,
 * images and environment monitoring. Sessions borrow from it. Main thread only unless noted.
 */
@OptIn(UnstableApi::class)
internal object Coordinator {
  private var context: Context? = null

  // Settable through configure() until first use.
  var maxVideoDiskBytes = 500L * 1024 * 1024
  var maxImageDiskBytes = 200L * 1024 * 1024
  var maxImageMemoryBytes: Long? = null

  val metrics = Metrics()

  /** Cache key of the active item, read from loader threads for byte accounting. */
  @Volatile var activeKey: String? = null

  var foreground = true
    private set

  private val sessions = ArrayList<FeedSession>()
  /** Most recently focused last. Only the last one owns playback. */
  private val focusStack = ArrayList<FeedSession>()
  val focused: FeedSession? get() = focusStack.lastOrNull()

  private val ctx: Context get() = context ?: error("InfiniteMedia used before the module was created")

  val videoCache by lazy {
    VideoCache(ctx, maxVideoDiskBytes) { key, bytes ->
      if (key != null && key == activeKey) {
        metrics.bytesActive.addAndGet(bytes)
      } else {
        metrics.bytesSpeculative.addAndGet(bytes)
        if (key != null) metrics.speculativeByKey.getOrPut(key) { AtomicLong() }.addAndGet(bytes)
      }
    }
  }

  private var engineOrNull: Engine? = null
  /** Preload manager and players. Recreated after onDestroy, since a released manager is dead. */
  val engine: Engine get() = engineOrNull ?: Engine(ctx, videoCache).also { engineOrNull = it }

  val images by lazy { ImagePipeline(ctx, maxImageDiskBytes, maxImageMemoryBytes) }

  private var envOrNull: Environment? = null
  val env: Environment
    get() = envOrNull ?: Environment(ctx) { reconnected -> focused?.onEnvironmentChanged(reconnected) }
      .also {
        envOrNull = it
        it.start()
      }

  fun init(appContext: Context) {
    context = appContext.applicationContext
  }

  fun register(session: FeedSession) {
    sessions.add(session)
    env // start monitoring on first use
  }

  fun unregister(session: FeedSession) {
    sessions.remove(session)
    val wasFocused = focused === session
    focusStack.remove(session)
    if (wasFocused) focused?.onFocusGained()
    if (sessions.isEmpty()) shutdownIdle()
  }

  fun focus(session: FeedSession) {
    val previous = focused
    if (previous === session) return
    focusStack.remove(session)
    focusStack.add(session)
    previous?.onFocusLost()
    session.onFocusGained()
  }

  fun blur(session: FeedSession) {
    val wasFocused = focused === session
    if (!focusStack.remove(session)) return
    if (wasFocused) {
      session.onFocusLost()
      focused?.onFocusGained()
    }
  }

  fun onBackground() {
    foreground = false
    sessions.forEach { it.onBackground() }
    if (sessions.isEmpty()) shutdownIdle()
  }

  fun onForeground() {
    foreground = true
    sessions.forEach { it.onForeground() }
  }

  /** Nothing is showing media: give the decoders back. */
  private fun shutdownIdle() {
    if (sessions.isEmpty()) engineOrNull?.pool?.trim(all = true)
  }

  /** Module teardown (reload or app exit). The SimpleCache stays open, it may only exist once per folder. */
  fun onDestroy() {
    sessions.toList().forEach { it.release() }
    engineOrNull?.release()
    engineOrNull = null
    envOrNull?.stop()
    envOrNull = null
  }
}

/** Everything built from the one DefaultPreloadManager.Builder. */
@OptIn(UnstableApi::class)
internal class Engine(ctx: Context, cache: VideoCache) {
  val preload = PreloadController()
  val loadControl = FeedLoadControl()
  private val builder = DefaultPreloadManager.Builder(ctx, preload)
    .setMediaSourceFactorySupplier(ReadWriteSources(ctx, cache))
    .setCache(cache.cache)
    .setDataSourceFactory(cache.upstream)
    .setLoadControl(loadControl)

  init {
    preload.manager = builder.build()
  }

  val pool = PlayerPool(ctx, builder)

  fun release() {
    pool.trim(all = true)
    preload.manager.release()
  }
}

/**
 * Media3's default supplier builds a read-only CacheDataSource for players, so streamed bytes
 * never reach disk and every replay downloads again. Ours writes through.
 */
@OptIn(UnstableApi::class)
private class ReadWriteSources(private val ctx: Context, private val cache: VideoCache) : MediaSourceFactorySupplier {
  override fun setCache(cache: Cache?) = this
  override fun setDataSourceFactory(dataSourceFactory: DataSource.Factory?) = this
  override fun get(): MediaSource.Factory = DefaultMediaSourceFactory(ctx).setDataSourceFactory(cache.readWrite)
}

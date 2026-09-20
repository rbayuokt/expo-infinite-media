package expo.modules.infinitemedia

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.source.preload.DefaultPreloadManager.PreloadStatus
import coil3.asDrawable
import expo.modules.infinitemedia.core.Generations
import expo.modules.infinitemedia.core.ImageAction
import expo.modules.infinitemedia.core.MemoryLevel
import expo.modules.infinitemedia.core.NetworkKind
import expo.modules.infinitemedia.core.PlaybackState
import expo.modules.infinitemedia.core.PolicyInput
import expo.modules.infinitemedia.core.PreloadPlan
import expo.modules.infinitemedia.core.PreloadPolicy
import expo.modules.infinitemedia.core.VideoAction
import expo.modules.infinitemedia.core.matches
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.sharedobjects.SharedObject
import java.util.concurrent.Executors

/**
 * One mounted feed. Owns its ordered items, decides the current item from native scroll
 * visibility, and borrows players from the coordinator while it has focus. Main thread only.
 */
@OptIn(UnstableApi::class)
class FeedSession(appContext: AppContext) : SharedObject(appContext) {
  private data class Config(
    val active: Boolean = true,
    val autoplay: Boolean = true,
    val loop: Boolean = true,
    val muted: Boolean = false,
    val ahead: Int = 2,
    val behind: Int = 1,
    val resumeOnForeground: Boolean = true,
    val progressInterval: Long = 0,
    val diagnostics: Boolean = false
  )

  private val c = Coordinator
  // Own handler, so release() can drop every pending retry and timer at once.
  private val main = Handler(Looper.getMainLooper())

  private var items: List<FeedItem> = emptyList()
  private val indexById = HashMap<String, Int>()
  private var config = Config()
  private var configured = false

  private val slots = LinkedHashSet<MediaSlotView>()
  private val visibility = SlotVisibility { scheduleEvaluate() }

  private var currentId: String? = null
  private var landingId: String? = null
  private val playbacks = HashMap<String, ItemPlayback>()
  private val failedSpeculative = HashSet<String>()
  private var userPaused = false
  private var resumeItem: String? = null
  private var lastState: String? = null
  private var lastPlan: PreloadPlan? = null

  private var bufferHealthy = true
  private var healthySince = 0L
  private var bufferingSince = 0L
  private var released = false

  private val isFocused get() = c.focused === this

  // Built on the JS thread. Everything after this runs on main, in post order.
  init {
    main.post { if (!released) c.register(this) }
  }

  // region JS API

  internal fun setItems(records: List<NativeItemRecord>) {
    val old = items.associateBy { it.id }
    val seen = HashSet<String>()
    // Unchanged ids keep their FeedItem, so players and preloads for them survive a replace.
    items = records.map(FeedItem::from).filter { seen.add(it.id) }.map { n ->
      old[n.id]?.takeIf { it.sameContent(n) } ?: n
    }
    reindex()
    for (id in playbacks.keys.toList()) if (byId(id) !== playbacks[id]?.item) releasePlayback(id)
    if (currentId != null && byId(currentId!!) == null) {
      currentId = null
      c.activeKey = null
    }
    if (landingId != null && byId(landingId!!) == null) landingId = null
    slots.forEach(::bindSlot)
    replan()
    scheduleEvaluate()
  }

  internal fun appendItems(records: List<NativeItemRecord>) {
    val fresh = records.map(FeedItem::from).filter { it.id !in indexById }.distinctBy { it.id }
    if (fresh.isEmpty()) return
    items = items + fresh
    reindex()
    slots.filter { it.boundItem == null }.forEach(::bindSlot)
    replan()
  }

  internal fun setConfig(r: SessionConfigRecord) {
    val old = config
    config = Config(
      r.active, r.autoplay, r.loop, r.muted,
      r.preloadAhead.coerceIn(0, 5), r.preloadBehind.coerceIn(0, 2),
      r.resumeOnForeground, r.progressInterval.toLong(), r.diagnostics
    )
    val first = !configured
    configured = true
    if (config.active && (first || !old.active)) {
      c.focus(this)
    } else if (!config.active && old.active && !first) {
      c.blur(this)
    }
    current()?.let { if (it.active) it.setActive(true, config.muted, config.loop) }
    if (config.autoplay && !old.autoplay && shouldPlay()) current()?.play()
    restartTimers()
    replan()
  }

  internal fun play() {
    userPaused = false
    if (isFocused && c.foreground) current()?.play()
  }

  internal fun pause() {
    userPaused = true
    current()?.pause()
  }

  /**
   * Exact seeks decode from the previous keyframe, too much work to repeat while a finger is
   * dragging, so scrubbing asks for the nearest sync point instead.
   */
  internal fun seekTo(seconds: Double, precise: Boolean) {
    val player = current()?.player ?: return
    player.setSeekParameters(if (precise) SeekParameters.EXACT else SeekParameters.CLOSEST_SYNC)
    player.seekTo((seconds * 1000).toLong().coerceAtLeast(0))
  }

  internal fun setMuted(muted: Boolean) {
    config = config.copy(muted = muted)
    current()?.let { if (it.active) it.setActive(true, muted, config.loop) }
  }

  internal fun retry() {
    val id = currentId ?: return
    val item = byId(id) ?: return
    if (!item.isVideo) {
      slotFor(id)?.let {
        it.boundItem = null
        bindSlot(it)
      }
      return
    }
    failedSpeculative.remove(id)
    val pb = playbacks[id]
    if (pb == null) {
      activateCurrent()
    } else if (pb.state == PlaybackState.ERROR) {
      pb.attempts = 0
      pb.retry()
    }
  }

  // endregion

  // region slots

  internal fun attachSlot(slot: MediaSlotView) {
    if (released || !slots.add(slot)) return
    visibility.observe(slot)
    bindSlot(slot)
    scheduleEvaluate()
  }

  internal fun detachSlot(slot: MediaSlotView) {
    if (!slots.remove(slot)) return
    playbacks.values.forEach { it.detach(slot) }
    unbindSlot(slot)
    if (slots.isEmpty()) visibility.stop()
  }

  internal fun slotItemChanged(slot: MediaSlotView) {
    if (slot !in slots) return
    bindSlot(slot)
    scheduleEvaluate()
  }

  internal fun slotLaidOut() = scheduleEvaluate()

  private fun unbindSlot(slot: MediaSlotView) {
    slot.imageRequest?.dispose()
    slot.fullRequest?.dispose()
    slot.imageRequest = null
    slot.fullRequest = null
    slot.fullImageShown = false
    slot.binding = null
    slot.boundItem = null
    slot.imageView.setImageDrawable(null)
    slot.showCover(true)
  }

  private fun bindSlot(slot: MediaSlotView) {
    val item = slot.itemId?.let(::byId)
    if (item == null) {
      playbacks.values.forEach { it.detach(slot) }
      unbindSlot(slot)
      return
    }
    if (slot.boundItem !== item) {
      playbacks.values.forEach { if (it.item !== item) it.detach(slot) }
      unbindSlot(slot)
      val binding = Generations.next(item.id)
      slot.binding = binding
      slot.boundItem = item
      slot.imageFailed = false
      slot.videoAspect = 0f
      slot.fullImageShown = false

      // The poster is small and usually lands first, whether it stands in for a video or a
      // photo. On a post you are returning to, both are in the memory cache and the poster can
      // land second, so it only paints while the full photo is still missing.
      item.poster?.let { poster ->
        slot.imageRequest = c.images.displayDetached(
          slot.imageView,
          poster,
          posterKey(item),
          item.headers,
          0,
          0,
          onReady = { image ->
            if (!slot.binding.matches(binding) || slot.fullImageShown) return@displayDetached
            slot.imageView.setImageDrawable(image.asDrawable(slot.resources))
          },
          onError = { }
        )
      }
      if (!item.isVideo) {
        slot.fullRequest = c.images.displayDetached(
          slot.imageView,
          item.uri,
          item.key,
          item.headers,
          slot.width,
          slot.height,
          onReady = { image ->
            if (!slot.binding.matches(binding)) return@displayDetached
            slot.fullImageShown = true
            slot.imageView.setImageDrawable(image.asDrawable(slot.resources))
          },
          onError = { t -> if (slot.binding.matches(binding)) onImageFailed(slot, item, t) }
        )
      }
    }
    playbacks[item.id]?.attach(slot)
  }

  private fun onImageFailed(slot: MediaSlotView, item: FeedItem, t: Throwable) {
    if (item.isVideo) {
      Log.d("poster failed for ${item.id}: ${t.message}")
      return
    }
    slot.imageFailed = true
    if (item.id == currentId) emitError(item.id, Errors.image(t), recoverable = false, attempt = 1)
  }

  private fun slotFor(id: String) = slots.firstOrNull { it.itemId == id && it.boundItem?.id == id }

  // endregion

  // region visibility and current item

  private val evaluate = Runnable { evaluate() }

  private fun scheduleEvaluate() {
    if (released) return
    main.removeCallbacks(evaluate)
    main.post(evaluate)
  }

  private fun evaluate() {
    if (released) return
    var best: MediaSlotView? = null
    var bestF = 0.0
    for (s in slots) {
      val id = s.itemId ?: continue
      if (id !in indexById) continue
      val f = visibility.fraction(s)
      if (f > bestF) {
        best = s
        bestF = f
      }
    }
    val id = best?.itemId ?: return
    if (bestF >= SETTLED) {
      visibility.settle()
      if (id != currentId) {
        setCurrent(id)
      } else if (landingId != id) {
        landingId = id
        replan()
      }
    } else if (id != landingId) {
      landingId = id
      replan()
    }
  }

  private fun setCurrent(id: String) {
    val prev = currentId
    currentId = id
    landingId = id
    userPaused = false
    lastState = null
    resumeItem = null
    prev?.let { playbacks[it] }?.setActive(false, true, config.loop)
    val index = indexById[id] ?: return
    val item = items[index]
    emit("indexChange", mapOf("index" to index, "itemId" to id))
    failedSpeculative.remove(id)
    playbacks[id]?.attempts = 0
    c.activeKey = item.key
    c.metrics.played(item.key)
    setBufferHealthy(true, replan = false)
    replan()
    activateCurrent()
    if (!item.isVideo && slotFor(id)?.imageFailed == true) {
      emitError(id, MediaError("IMAGE_DECODE_FAILED", "image failed to load"), recoverable = false, attempt = 1)
    }
  }

  private fun activateCurrent() {
    if (!isFocused || released) return
    val id = currentId ?: return
    val item = byId(id) ?: return
    val loadControl = c.engine.loadControl
    if (!item.isVideo) {
      loadControl.activePlayer = null
      return
    }
    val pb = playbacks[id] ?: ensurePlayback(item, current = true) ?: return
    loadControl.activePlayer = c.engine.pool.name(pb.player)
    pb.setActive(true, config.muted, config.loop)
    pb.markActivated()
    pb.fromCache = c.videoCache.hasStart(item.key)
    if (pb.fromCache) c.metrics.cacheHits++ else c.metrics.cacheMisses++
    slotFor(id)?.let(pb::attach)
    emitState(pb)
    if (pb.firstFrameRendered) onFirstFrame(pb)
    if (pb.state == PlaybackState.ERROR) {
      pb.attempts = 0
      pb.retry()
    }
    if (shouldPlay()) pb.play()
    restartTimers()
  }

  private fun shouldPlay() = config.autoplay && config.active && !userPaused && isFocused && c.foreground

  private fun current(): ItemPlayback? = currentId?.let { playbacks[it] }

  // endregion

  // region plan

  private fun replan() {
    if (released || !isFocused || !config.active) return
    val centerId = landingId ?: currentId ?: return
    val center = indexById[centerId] ?: return
    val env = c.env
    val plan = PreloadPolicy.plan(
      PolicyInput(
        currentIndex = center,
        itemCount = items.size,
        direction = visibility.direction,
        velocity = visibility.velocity,
        bufferHealthy = bufferHealthy,
        // Backgrounded apps get nothing speculative.
        network = if (c.foreground) env.network else NetworkKind.OFFLINE,
        memory = env.memoryLevel,
        tier = env.tier,
        ahead = config.ahead,
        behind = config.behind
      )
    )
    lastPlan = plan
    val engine = c.engine

    val wanted = HashSet<String>()
    currentId?.let { id -> if (byId(id)?.isVideo == true) wanted.add(id) }
    for (e in plan.entries) {
      val item = items[e.index]
      if (item.isVideo && (e.video == VideoAction.PLAY || e.video == VideoAction.PREPARE)) wanted.add(item.id)
    }
    for (id in playbacks.keys.toList()) if (id !in wanted) releasePlayback(id)
    engine.pool.capacity = wanted.size

    // Disk-only startup ranges go through Media3's preload manager. Items that get a player keep
    // their preloaded source if they already had one.
    val targets = HashMap<Int, Pair<FeedItem, PreloadStatus>>()
    for (e in plan.entries) {
      val item = items[e.index]
      if (!item.isVideo) continue
      val status = when (e.video) {
        // Nothing to pre-cache if the startup range is already on disk from an earlier session.
        VideoAction.STARTUP ->
          if (item.isProgressive && !c.videoCache.hasStart(item.key)) {
            PreloadStatus.specifiedRangeCached(plan.startupMs.toLong())
          } else {
            null
          }
        VideoAction.PLAY, VideoAction.PREPARE ->
          if (engine.preload.sourceFor(item) != null) PreloadStatus.specifiedRangeLoaded(plan.startupMs.toLong()) else null
        else -> null
      } ?: continue
      targets[e.index] = item to status
    }
    c.metrics.preloadCancels += engine.preload.apply(targets, center)

    for (e in plan.entries) {
      val item = items[e.index]
      if (item.id == currentId || !item.isVideo) continue
      if (e.video == VideoAction.PREPARE || e.video == VideoAction.PLAY) ensurePlayback(item, current = false)
    }

    prefetchImages(plan)
  }

  private fun prefetchImages(plan: PreloadPlan) {
    val keep = HashSet<String>()
    val w = slots.firstOrNull()?.width ?: 0
    val h = slots.firstOrNull()?.height ?: 0
    for (e in plan.entries) {
      val item = items[e.index]
      if (slotFor(item.id) != null) continue
      if (!item.isVideo && (e.image == ImageAction.DECODE || e.image == ImageAction.FETCH)) {
        c.images.prefetch(item.id, item.uri, item.key, item.headers, e.image == ImageAction.DECODE, w, h)
        keep.add(item.id)
      } else if (item.isVideo && item.poster != null && e.video != VideoAction.NONE) {
        val id = posterKey(item)
        c.images.prefetch(id, item.poster, id, item.headers, true, w, h)
        keep.add(id)
      }
    }
    c.images.cancelAllExcept(keep)
  }

  private fun ensurePlayback(item: FeedItem, current: Boolean): ItemPlayback? {
    playbacks[item.id]?.let { return it }
    if (!current && item.id in failedSpeculative) return null
    val pool = c.engine.pool
    var player = pool.obtain()
    if (player == null && current) {
      // The current item always gets a player, take one from speculative work.
      playbacks.keys.firstOrNull { it != currentId }?.let { releasePlayback(it) }
      player = pool.obtain()
    }
    if (player == null) return null
    val pb = ItemPlayback(item, player, host)
    playbacks[item.id] = pb
    c.engine.preload.inUse.add(item.id)
    c.videoCache.register(item)
    pb.start(c.engine.preload.sourceFor(item))
    if (!current) pb.setActive(false, true, config.loop)
    slotFor(item.id)?.let(pb::attach)
    return pb
  }

  private fun releasePlayback(id: String) {
    val pb = playbacks.remove(id) ?: return
    c.engine.preload.inUse.remove(id)
    val slot = pb.slot
    pb.release { c.engine.pool.recycle(it) }
    // The surface goes black without a player, bring the poster back.
    slot?.showCover(true)
    if (id == currentId) c.engine.loadControl.activePlayer = null
  }

  // endregion

  // region PlaybackHost

  private val host = object : PlaybackHost {
    override fun onStateChanged(pb: ItemPlayback) = this@FeedSession.onStateChanged(pb)
    override fun onFirstFrame(pb: ItemPlayback) = this@FeedSession.onFirstFrame(pb)
    override fun onVideoSize(pb: ItemPlayback, aspect: Float) = this@FeedSession.onVideoSize(pb, aspect)
    override fun onFailed(pb: ItemPlayback, error: PlaybackException) = this@FeedSession.onFailed(pb, error)
    override fun onDroppedFrames(count: Int) = this@FeedSession.onDroppedFrames(count)
  }

  private fun onStateChanged(pb: ItemPlayback) {
    if (pb.item.id != currentId) return
    val now = SystemClock.elapsedRealtime()
    if (pb.state == PlaybackState.BUFFERING) {
      // Waiting before the first frame is startup, not a rebuffer.
      if (pb.firstFrameRendered) {
        c.metrics.rebufferCount++
        bufferingSince = now
      }
      // A stall is unhealthy right away, no need to wait for the sampler.
      setBufferHealthy(false)
    } else if (bufferingSince > 0) {
      c.metrics.rebufferMs += now - bufferingSince
      bufferingSince = 0
    }
    emitState(pb)
    if (pb.state == PlaybackState.PLAYING) restartTimers()
  }

  private fun onFirstFrame(pb: ItemPlayback) {
    val slot = pb.slot ?: return
    if (slot.binding?.itemId != pb.item.id) return
    slot.showCover(false)
    if (pb.item.id == currentId && pb.activatedAt > 0) {
      // A prepared-next item already showing its frame reports close to 0.
      val ms = SystemClock.elapsedRealtime() - pb.activatedAt
      pb.activatedAt = 0
      c.metrics.startup(ms)
      emit("firstFrame", mapOf("itemId" to pb.item.id, "startupMs" to ms, "fromCache" to pb.fromCache))
    }
  }

  private fun onVideoSize(pb: ItemPlayback, aspect: Float) {
    pb.slot?.videoAspect = aspect
  }

  private fun onFailed(pb: ItemPlayback, error: PlaybackException) {
    val id = pb.item.id
    val e = Errors.from(error)
    c.metrics.errors++
    Log.w("playback failed for $id: ${e.code} ${e.nativeCode}", error)
    if (id != currentId) {
      // Speculative items don't retry, they get another chance when they become current.
      failedSpeculative.add(id)
      releasePlayback(id)
      return
    }
    if (e.code == "CACHE_CORRUPT" && pb.attempts == 0) {
      // Not surfaced: drop the bad entry and go back to the network once.
      pb.attempts++
      val key = pb.item.key
      io.execute {
        runCatching { c.videoCache.remove(key) }
        main.post { if (playbacks[id] === pb) pb.retry() }
      }
      return
    }
    if (e.code == "DECODER_INIT_FAILED") {
      // Usually codec exhaustion on low-end devices: free the others first.
      playbacks.keys.filter { it != id }.forEach(::releasePlayback)
    }
    val offline = c.env.network == NetworkKind.OFFLINE
    val canRetry = e.retryable && pb.attempts < MAX_RETRIES
    emitError(id, e, recoverable = canRetry, attempt = pb.attempts + 1)
    if (!canRetry) {
      pb.slot?.showCover(true)
      return
    }
    // Offline waits for the reconnect callback instead of burning attempts.
    if (offline) return
    val delay = 500L shl pb.attempts
    pb.attempts++
    main.postDelayed({
      if (!released && playbacks[id] === pb && id == currentId) pb.retry()
    }, delay)
  }

  private fun onDroppedFrames(count: Int) {
    c.metrics.droppedFrames += count
  }

  // endregion

  // region lifecycle and environment

  internal fun onFocusGained() {
    if (released) return
    replan()
    activateCurrent()
  }

  internal fun onFocusLost() {
    playbacks.keys.toList().forEach(::releasePlayback)
    c.engine.preload.clear()
    c.images.cancelAllExcept(emptySet())
    stopAllTimers()
  }

  internal fun onBackground() {
    val pb = current()
    resumeItem = if (pb?.player?.playWhenReady == true) pb.item.id else null
    pb?.pause()
    stopAllTimers()
    replan()
  }

  internal fun onForeground() {
    replan()
    val id = resumeItem
    resumeItem = null
    // Only the same item, and only if nothing moved while we were away.
    if (config.resumeOnForeground && id != null && id == currentId && shouldPlay()) current()?.play()
    restartTimers()
  }

  internal fun onEnvironmentChanged(reconnected: Boolean) {
    if (released) return
    if (c.env.memoryLevel != MemoryLevel.NORMAL) c.images.trimMemory()
    replan()
    val pb = current()
    if (reconnected && pb != null && pb.state == PlaybackState.ERROR) {
      pb.attempts = 0
      pb.retry()
    }
  }

  private fun setBufferHealthy(ok: Boolean, replan: Boolean = true) {
    healthySince = 0
    if (ok == bufferHealthy) return
    bufferHealthy = ok
    if (isFocused) c.engine.loadControl.activeUnhealthy = !ok
    if (replan) replan()
  }

  // endregion

  // region timers

  private val bufferTick = object : Runnable {
    override fun run() {
      val pb = current() ?: return
      if (pb.state == PlaybackState.PLAYING || pb.state == PlaybackState.BUFFERING) {
        val p = pb.player
        val ahead = p.bufferedPosition - p.currentPosition
        val nearEnd = p.duration != C.TIME_UNSET && p.duration - p.currentPosition < HEALTHY_AHEAD_MS
        val ok = pb.state != PlaybackState.BUFFERING && (ahead >= HEALTHY_AHEAD_MS || nearEnd)
        val now = SystemClock.elapsedRealtime()
        when {
          !ok -> setBufferHealthy(false)
          bufferHealthy -> Unit
          healthySince == 0L -> healthySince = now
          now - healthySince >= RECOVER_MS -> setBufferHealthy(true)
        }
      }
      main.postDelayed(this, 1000)
    }
  }

  private val progressTick = object : Runnable {
    override fun run() {
      val pb = current()
      if (pb != null && pb.state == PlaybackState.PLAYING) {
        val p = pb.player
        emit(
          "progress",
          mapOf(
            "itemId" to pb.item.id,
            "position" to p.currentPosition / 1000.0,
            "duration" to if (p.duration == C.TIME_UNSET) 0.0 else p.duration / 1000.0,
            "buffered" to p.bufferedPosition / 1000.0
          )
        )
      }
      if (config.progressInterval > 0) main.postDelayed(this, config.progressInterval)
    }
  }

  private var metricsRunning = false

  private val metricsTick = object : Runnable {
    override fun run() {
      emitMetrics()
      metricsRunning = config.diagnostics
      if (metricsRunning) main.postDelayed(this, 2000)
    }
  }

  private fun restartTimers() {
    stopTimers()
    if (released || !isFocused || !c.foreground) return
    // Metrics run on their own clock, current-item changes must not keep resetting it.
    if (config.diagnostics && !metricsRunning) {
      metricsRunning = true
      main.postDelayed(metricsTick, 2000)
    }
    val pb = current() ?: return
    main.postDelayed(bufferTick, 1000)
    if (config.progressInterval > 0 && pb.state == PlaybackState.PLAYING) main.post(progressTick)
  }

  private fun stopTimers() {
    main.removeCallbacks(bufferTick)
    main.removeCallbacks(progressTick)
  }

  private fun stopAllTimers() {
    stopTimers()
    main.removeCallbacks(metricsTick)
    metricsRunning = false
  }

  private fun emitMetrics() {
    val pool = c.engine.pool
    val planned = lastPlan?.entries?.mapNotNull { items.getOrNull(it.index)?.key }?.toSet() ?: emptySet()
    val wasted = c.metrics.speculativeByKey.keys.filterTo(HashSet()) { it !in planned && it != c.activeKey }
    val extra = mapOf(
      "playersActive" to playbacks.values.count { it.active },
      "playersPrepared" to playbacks.values.count { !it.active },
      "playersTotal" to pool.live,
      // Player.Listener plus AnalyticsListener per playback, plus the scroll observer.
      "liveObservers" to playbacks.size * 2 + if (slots.isEmpty()) 0 else 1,
      "liveSurfaces" to slots.size,
      "memoryWarnings" to c.env.memoryWarnings,
      "videoCacheBytes" to c.videoCache.size(),
      "imageCacheBytes" to c.images.diskBytes
    )
    emit("metrics", c.metrics.snapshot(extra, wasted))
  }

  // endregion

  private fun emitState(pb: ItemPlayback) {
    val name = pb.state.publicName ?: return
    if (name == lastState) return
    lastState = name
    emit("playbackStateChange", mapOf("itemId" to pb.item.id, "state" to name))
  }

  private fun emitError(itemId: String, e: MediaError, recoverable: Boolean, attempt: Int) {
    emit("error", e.toMap(itemId, recoverable, attempt))
  }

  private fun byId(id: String) = indexById[id]?.let { items[it] }

  private fun reindex() {
    indexById.clear()
    items.forEachIndexed { i, it -> indexById[it.id] = i }
    items.forEach { if (it.isVideo) c.videoCache.register(it) }
  }

  private fun posterKey(item: FeedItem) = "${item.key}#poster"

  internal fun release() {
    if (released) return
    val wasFocused = isFocused
    playbacks.keys.toList().forEach(::releasePlayback)
    released = true
    main.removeCallbacksAndMessages(null)
    visibility.stop()
    slots.toList().forEach(::unbindSlot)
    slots.clear()
    if (wasFocused) {
      c.engine.preload.clear()
      c.images.cancelAllExcept(emptySet())
      c.activeKey = null
    }
    c.unregister(this)
  }

  // Can arrive off main, and players must only be touched on main.
  override fun sharedObjectDidRelease() {
    main.post { release() }
  }

  companion object {
    private const val SETTLED = 0.98
    private const val MAX_RETRIES = 3
    private const val HEALTHY_AHEAD_MS = 2000L
    private const val RECOVER_MS = 5000L
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "infinite-media-io").apply { isDaemon = true } }
  }
}

package expo.modules.infinitemedia

import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.MediaSource
import expo.modules.infinitemedia.core.PlaybackEvent
import expo.modules.infinitemedia.core.PlaybackState
import expo.modules.infinitemedia.core.PlaybackStateMachine

/** Callbacks into the owning session. Only ever called on main, and never after release(). */
internal interface PlaybackHost {
  fun onStateChanged(pb: ItemPlayback)
  fun onFirstFrame(pb: ItemPlayback)
  fun onVideoSize(pb: ItemPlayback, aspect: Float)
  fun onFailed(pb: ItemPlayback, error: PlaybackException)
  fun onDroppedFrames(count: Int)
}

/**
 * One lent player bound to one item. The listener dies with this object, so a recycled player
 * can never report into a newer item.
 */
@OptIn(UnstableApi::class)
internal class ItemPlayback(
  val item: FeedItem,
  val player: ExoPlayer,
  private val host: PlaybackHost
) : Player.Listener, AnalyticsListener {
  var state = PlaybackState.IDLE
    private set
  var released = false
    private set
  var slot: MediaSlotView? = null
    private set
  var active = false
    private set
  var firstFrameRendered = false
    private set
  var attempts = 0
  var fromCache = false

  /** When the item last became active, for time to first frame. */
  var activatedAt = 0L

  fun start(source: MediaSource?) {
    player.addListener(this)
    player.addAnalyticsListener(this)
    move(PlaybackEvent.BIND)
    move(PlaybackEvent.PREPARE)
    if (source != null) player.setMediaSource(source) else player.setMediaItem(item.mediaItem)
    player.prepare()
  }

  fun attach(target: MediaSlotView) {
    if (slot === target) return
    slot?.let { player.clearVideoTextureView(it.videoView) }
    slot = target
    firstFrameRendered = false
    player.setVideoTextureView(target.videoView)
    val size = player.videoSize
    if (size.width > 0 && size.height > 0) host.onVideoSize(this, aspect(size))
  }

  fun detach(target: MediaSlotView) {
    if (slot !== target) return
    player.clearVideoTextureView(target.videoView)
    slot = null
    firstFrameRendered = false
  }

  /** Only the active item gets volume and audio focus. A muted feed doesn't take focus. */
  fun setActive(value: Boolean, muted: Boolean, loop: Boolean) {
    active = value
    val audible = value && !muted
    player.volume = if (audible) 1f else 0f
    player.setAudioAttributes(PlayerPool.ATTRS, audible)
    player.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    if (!value) pause()
  }

  fun play() {
    if (state == PlaybackState.ENDED) player.seekTo(0)
    player.playWhenReady = true
    if (player.playbackState == Player.STATE_READY) move(PlaybackEvent.PLAY)
  }

  fun pause() {
    player.playWhenReady = false
    move(PlaybackEvent.PAUSE)
  }

  fun retry() {
    if (move(PlaybackEvent.RETRY)) player.prepare()
  }

  /** Stops callbacks, detaches the surface, hands the player back. Idempotent. */
  fun release(recycle: (ExoPlayer) -> Unit) {
    if (released) return
    move(PlaybackEvent.RELEASE)
    released = true
    player.removeListener(this)
    player.removeAnalyticsListener(this)
    slot?.let { player.clearVideoTextureView(it.videoView) }
    slot = null
    move(PlaybackEvent.RELEASED)
    recycle(player)
  }

  private fun move(event: PlaybackEvent): Boolean {
    val next = PlaybackStateMachine.next(state, event) ?: return false
    if (next == state) return true
    state = next
    if (!released) host.onStateChanged(this)
    return true
  }

  override fun onPlaybackStateChanged(playbackState: Int) {
    when (playbackState) {
      Player.STATE_READY -> {
        if (state == PlaybackState.PREPARING) move(PlaybackEvent.READY)
        if (state == PlaybackState.BUFFERING) move(PlaybackEvent.BUFFER_END)
        if (player.playWhenReady && state != PlaybackState.PLAYING) move(PlaybackEvent.PLAY)
      }
      Player.STATE_BUFFERING -> if (state == PlaybackState.PLAYING) move(PlaybackEvent.BUFFER_START)
      Player.STATE_ENDED -> move(PlaybackEvent.ENDED)
      else -> Unit
    }
  }

  override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
    // Audio focus loss and becoming-noisy pause the player behind our back.
    if (!playWhenReady) move(PlaybackEvent.PAUSE)
  }

  override fun onRenderedFirstFrame() {
    if (released || slot == null) return
    firstFrameRendered = true
    host.onFirstFrame(this)
  }

  override fun onVideoSizeChanged(videoSize: VideoSize) {
    if (!released && videoSize.width > 0 && videoSize.height > 0) host.onVideoSize(this, aspect(videoSize))
  }

  override fun onPlayerError(error: PlaybackException) {
    if (released) return
    move(PlaybackEvent.FAIL)
    host.onFailed(this, error)
  }

  override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
    if (!released && active) host.onDroppedFrames(droppedFrames)
  }

  fun markActivated() {
    activatedAt = SystemClock.elapsedRealtime()
  }

  private fun aspect(s: VideoSize) = s.width * s.pixelWidthHeightRatio / s.height
}

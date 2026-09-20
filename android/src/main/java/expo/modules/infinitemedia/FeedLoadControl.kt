package expo.modules.infinitemedia

import androidx.annotation.OptIn
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.Allocator

/**
 * Current playback wins. Media3 1.11 has no priority link between the player and the preload
 * manager, so pooled players that aren't active stop loading at a small buffer, and stop
 * entirely while the active one is starving.
 *
 * Every method is forwarded by hand: Kotlin's `by` delegation skips Java default methods, and
 * Media3's defaults for the old overloads throw.
 */
@OptIn(UnstableApi::class)
internal class FeedLoadControl : LoadControl {
  // Feed clips are short and swiped away, the 50 s default mostly wastes bytes.
  private val base = DefaultLoadControl.Builder().setBufferDurationsMs(15_000, 30_000, 1_000, 2_000).build()

  @Volatile var activePlayer: String? = null
  @Volatile var activeUnhealthy = false

  override fun shouldContinueLoading(parameters: LoadControl.Parameters): Boolean {
    val name = parameters.playerId.name
    if (name.startsWith(PlayerPool.NAME_PREFIX) && name != activePlayer) {
      if (activeUnhealthy || parameters.bufferedDurationUs >= SPECULATIVE_BUFFER_US) return false
    }
    return base.shouldContinueLoading(parameters)
  }

  override fun shouldContinuePreloading(
    playerId: PlayerId,
    timeline: Timeline,
    mediaPeriodId: MediaSource.MediaPeriodId,
    bufferedDurationUs: Long
  ): Boolean = !activeUnhealthy && base.shouldContinuePreloading(playerId, timeline, mediaPeriodId, bufferedDurationUs)

  override fun shouldStartPlayback(parameters: LoadControl.Parameters) = base.shouldStartPlayback(parameters)
  override fun onPrepared(playerId: PlayerId) = base.onPrepared(playerId)
  override fun onTracksSelected(
    parameters: LoadControl.Parameters,
    trackGroups: TrackGroupArray,
    trackSelections: Array<out ExoTrackSelection?>
  ) = base.onTracksSelected(parameters, trackGroups, trackSelections)
  override fun onStopped(playerId: PlayerId) = base.onStopped(playerId)
  override fun onReleased(playerId: PlayerId) = base.onReleased(playerId)
  override fun getAllocator(playerId: PlayerId): Allocator = base.getAllocator(playerId)
  override fun getBackBufferDurationUs(playerId: PlayerId) = base.getBackBufferDurationUs(playerId)
  override fun retainBackBufferFromKeyframe(playerId: PlayerId) = base.retainBackBufferFromKeyframe(playerId)

  companion object {
    const val SPECULATIVE_BUFFER_US = 2_000_000L
  }
}

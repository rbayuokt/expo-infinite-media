package expo.modules.infinitemedia

import android.content.Context
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.preload.DefaultPreloadManager

/** Players are expensive and hold decoders, so a few are reused across every item and session. */
@OptIn(UnstableApi::class)
internal class PlayerPool(private val ctx: Context, private val builder: DefaultPreloadManager.Builder) {
  private val idle = ArrayDeque<ExoPlayer>()
  private val names = HashMap<ExoPlayer, String>()
  private var created = 0
  var live = 0
    private set

  /** Players allowed to exist, lent plus idle. */
  var capacity = 2
    set(value) {
      field = value.coerceAtLeast(1)
      trim()
    }

  val lent: Int get() = live - idle.size

  fun obtain(): ExoPlayer? {
    idle.removeFirstOrNull()?.let { return it }
    if (live >= capacity) return null
    live++
    val name = "$NAME_PREFIX${created++}"
    return builder.buildExoPlayer(
      ExoPlayer.Builder(ctx)
        .setName(name)
        .setLooper(Looper.getMainLooper())
        .setHandleAudioBecomingNoisy(true)
    ).apply {
      volume = 0f
      setAudioAttributes(ATTRS, false)
      names[this] = name
    }
  }

  /** The PlayerId name Media3 hands to the LoadControl. */
  fun name(player: ExoPlayer): String? = names[player]

  fun recycle(player: ExoPlayer) {
    player.playWhenReady = false
    player.stop()
    player.clearMediaItems()
    player.clearVideoSurface()
    player.volume = 0f
    player.setAudioAttributes(ATTRS, false)
    idle.addLast(player)
    trim()
  }

  /** Releases idle players over capacity, or all idle ones. */
  fun trim(all: Boolean = false) {
    while (idle.isNotEmpty() && (all || live > capacity)) {
      val p = idle.removeFirst()
      names.remove(p)
      p.release()
      live--
    }
  }

  companion object {
    const val NAME_PREFIX = "infinite-media-"
    val ATTRS: AudioAttributes = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
      .build()
  }
}

package expo.modules.infinitemedia

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.preload.DefaultPreloadManager
import androidx.media3.exoplayer.source.preload.DefaultPreloadManager.PreloadStatus
import androidx.media3.exoplayer.source.preload.TargetPreloadStatusControl

/**
 * Feeds PreloadPolicy output to Media3's preload manager. Only the planned window of the focused
 * session is registered, ranked by index. Everything else is removed, which cancels its loading.
 */
@OptIn(UnstableApi::class)
internal class PreloadController : TargetPreloadStatusControl<Int, PreloadStatus> {
  lateinit var manager: DefaultPreloadManager

  // Read from the preload thread.
  @Volatile private var targets: Map<Int, PreloadStatus> = emptyMap()
  private val added = HashMap<String, Pair<FeedItem, Int>>()

  /** Items a player is using. Removing their source under the player isn't safe. */
  val inUse = HashSet<String>()

  override fun getTargetPreloadStatus(rankingData: Int): PreloadStatus =
    targets[rankingData] ?: PreloadStatus.PRELOAD_STATUS_NOT_PRELOADED

  /** [wanted] maps index to item and target status. Returns how many preloads were dropped. Main only. */
  fun apply(wanted: Map<Int, Pair<FeedItem, PreloadStatus>>, currentIndex: Int): Int {
    var removed = 0
    targets = wanted.mapValues { it.value.second }
    val wantedIds = wanted.values.associate { it.first.id to it.first }
    val it = added.entries.iterator()
    while (it.hasNext()) {
      val (id, entry) = it.next()
      val (item, index) = entry
      val stillWanted = wantedIds[id]?.let { w -> w === item && wanted[index]?.first === item } == true
      if (!stillWanted && id !in inUse) {
        if (manager.remove(item.mediaItem)) removed++
        it.remove()
      }
    }
    for ((index, pair) in wanted) {
      val item = pair.first
      if (item.id !in added) {
        manager.add(item.mediaItem, index)
        added[item.id] = item to index
      }
    }
    manager.setCurrentPlayingIndex(currentIndex)
    manager.invalidate()
    return removed
  }

  fun sourceFor(item: FeedItem): MediaSource? = if (added[item.id]?.first === item) manager.getMediaSource(item.mediaItem) else null

  /** Drops everything not held by a player. */
  fun clear() {
    apply(emptyMap(), 0)
  }
}

package expo.modules.infinitemedia

import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Watches the feed's scroll view natively, so picking the current item never waits on JS.
 * One observer per session, attached to the nearest scrolling ancestor of its slots.
 */
internal class SlotVisibility(private val onScroll: () -> Unit) : ViewTreeObserver.OnScrollChangedListener {
  private var scrollView: ViewGroup? = null
  private var observer: ViewTreeObserver? = null
  private var lastOffset = Int.MIN_VALUE
  private var lastTime = 0L

  /** Pages per second, smoothed. */
  var velocity = 0.0
    private set
  var direction = 1
    private set

  val horizontal: Boolean get() = scrollView is HorizontalScrollView

  fun observe(from: View) {
    val sv = scrollView
    if (sv != null && sv.isAttachedToWindow && observer?.isAlive == true) return
    stop()
    var p = from.parent
    while (p != null && p !is ScrollView && p !is HorizontalScrollView) p = p.parent
    val found = p as? ViewGroup ?: return
    scrollView = found
    observer = found.viewTreeObserver.also { it.addOnScrollChangedListener(this) }
    lastOffset = offset(found)
    lastTime = SystemClock.uptimeMillis()
  }

  fun stop() {
    observer?.takeIf { it.isAlive }?.removeOnScrollChangedListener(this)
    observer = null
    scrollView = null
    velocity = 0.0
  }

  /** Scrolling stopped on a page. */
  fun settle() {
    velocity = 0.0
  }

  override fun onScrollChanged() {
    val sv = scrollView ?: return
    val now = SystemClock.uptimeMillis()
    val off = offset(sv)
    // This fires for any scroll in the window. Ours didn't move, nothing to do.
    if (off == lastOffset) return
    val page = if (horizontal) sv.width else sv.height
    val dt = now - lastTime
    if (lastOffset != Int.MIN_VALUE && page > 0 && dt > 0) {
      val delta = off - lastOffset
      if (delta != 0) direction = if (delta > 0) 1 else -1
      val instant = abs(delta).toDouble() / page / (dt / 1000.0)
      velocity = ALPHA * instant + (1 - ALPHA) * velocity
    }
    lastOffset = off
    lastTime = now
    onScroll()
  }

  /** Share of the slot inside the scroll view's viewport along the scroll axis, 0..1. */
  fun fraction(slot: View): Double {
    val sv = scrollView ?: return 0.0
    if (!slot.isAttachedToWindow || slot.width == 0 || slot.height == 0) return 0.0
    slot.getLocationInWindow(slotLoc)
    sv.getLocationInWindow(svLoc)
    val (start, size, viewport) = if (horizontal) {
      Triple(slotLoc[0] - svLoc[0], slot.width, sv.width)
    } else {
      Triple(slotLoc[1] - svLoc[1], slot.height, sv.height)
    }
    val visible = min(start + size, viewport) - max(start, 0)
    return if (visible <= 0) 0.0 else visible.toDouble() / size
  }

  private val slotLoc = IntArray(2)
  private val svLoc = IntArray(2)

  private fun offset(sv: ViewGroup) = if (sv is HorizontalScrollView) sv.scrollX else sv.scrollY

  companion object {
    private const val ALPHA = 0.3
  }
}

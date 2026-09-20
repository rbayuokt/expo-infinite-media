package expo.modules.infinitemedia

import android.content.Context
import android.graphics.Color
import android.view.TextureView
import android.widget.ImageView
import coil3.request.Disposable
import expo.modules.infinitemedia.core.Binding
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * A surface and a poster/image layer. It never owns a player: the session lends one and
 * attaches it to [videoView]. One per mounted page, reused across items.
 */
class MediaSlotView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // React Native never lays out native children on its own.
  override val shouldUseAndroidLayout = true

  /**
   * A TextureView, not a SurfaceView. A SurfaceView gets its own compositor layer, which the
   * paging scroll view cannot clip or move in step, so neighbouring pages leak a strip of video
   * on screen. A texture is drawn in the view tree and follows the scroll exactly.
   */
  internal val videoView = TextureView(context)
  internal val imageView = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }

  /** Current item-to-slot binding. Async results check it before touching the view. */
  internal var binding: Binding? = null
  internal var boundItem: FeedItem? = null
  internal var imageRequest: Disposable? = null
  internal var fullRequest: Disposable? = null
  /** Set once the real photo is up, so a slow poster can't paint over it. */
  internal var fullImageShown = false
  internal var imageFailed = false

  var session: FeedSession? = null
    set(value) {
      if (field === value) return
      field?.detachSlot(this)
      field = value
      if (isAttachedToWindow) value?.attachSlot(this)
    }

  var itemId: String? = null
    set(value) {
      if (field == value) return
      field = value
      session?.slotItemChanged(this)
    }

  var resizeMode = "cover"
    set(value) {
      field = value
      imageView.scaleType = if (value == "contain") ImageView.ScaleType.FIT_CENTER else ImageView.ScaleType.CENTER_CROP
      requestLayout()
    }

  /** Width over height of the playing video, 0 while unknown. */
  internal var videoAspect = 0f
    set(value) {
      if (field == value) return
      field = value
      requestLayout()
    }

  init {
    setBackgroundColor(Color.BLACK)
    addView(videoView)
    addView(imageView)
  }

  internal fun showCover(show: Boolean) {
    imageView.visibility = if (show) VISIBLE else GONE
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    session?.attachSlot(this)
  }

  override fun onDetachedFromWindow() {
    session?.detachSlot(this)
    super.onDetachedFromWindow()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val w = MeasureSpec.getSize(widthMeasureSpec)
    val h = MeasureSpec.getSize(heightMeasureSpec)
    setMeasuredDimension(w, h)
    val (sw, sh) = surfaceSize(w, h)
    videoView.measure(MeasureSpec.makeMeasureSpec(sw, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(sh, MeasureSpec.EXACTLY))
    imageView.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val w = r - l
    val h = b - t
    val sw = videoView.measuredWidth
    val sh = videoView.measuredHeight
    val x = (w - sw) / 2
    val y = (h - sh) / 2
    videoView.layout(x, y, x + sw, y + sh)
    imageView.layout(0, 0, w, h)
    if (changed) session?.slotLaidOut()
  }

  // Cover overflows the slot and relies on the page clipping, same as PlayerView's zoom mode.
  private fun surfaceSize(w: Int, h: Int): Pair<Int, Int> {
    if (videoAspect <= 0f || w == 0 || h == 0) return w to h
    val viewAspect = w.toFloat() / h
    val fitWidth = if (resizeMode == "contain") videoAspect > viewAspect else videoAspect < viewAspect
    return if (fitWidth) w to (w / videoAspect).toInt() else (h * videoAspect).toInt() to h
  }
}

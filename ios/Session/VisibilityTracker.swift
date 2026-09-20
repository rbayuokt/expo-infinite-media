import UIKit

/** Watches one scroll view's offset. No per-frame work beyond a KVO callback and a division. */
final class VisibilityTracker {
  private(set) weak var scrollView: UIScrollView?
  private var observation: NSKeyValueObservation?
  private var lastOffset: CGFloat = 0
  private var lastTime: CFTimeInterval = 0
  private(set) var velocity: Double = 0
  private(set) var direction = 1
  var onScroll: (() -> Void)?

  func attach(_ scrollView: UIScrollView) {
    guard scrollView !== self.scrollView else { return }
    detach()
    self.scrollView = scrollView
    lastOffset = axisOffset(scrollView)
    lastTime = CACurrentMediaTime()
    observation = scrollView.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
      // Scroll views change offset on main, so this already runs there.
      self?.scrolled()
    }
  }

  func detach() {
    observation?.invalidate()
    observation = nil
    scrollView = nil
    velocity = 0
  }

  var isHorizontal: Bool {
    guard let sv = scrollView else { return false }
    return sv.contentSize.width > sv.bounds.width + 1
  }

  /** Visible share of `view` along the scroll axis, 0...1. */
  func fraction(of view: UIView) -> CGFloat {
    guard view.window != nil else { return 0 }
    let frame: CGRect
    let visible: CGRect
    if let sv = scrollView {
      frame = view.convert(view.bounds, to: sv)
      visible = sv.bounds
    } else {
      frame = view.convert(view.bounds, to: nil)
      visible = view.window?.bounds ?? .zero
    }
    let inter = frame.intersection(visible)
    guard !inter.isNull else { return 0 }
    if isHorizontal { return frame.width > 0 ? inter.width / frame.width : 0 }
    return frame.height > 0 ? inter.height / frame.height : 0
  }

  func settled() { velocity = 0 }

  private func axisOffset(_ sv: UIScrollView) -> CGFloat {
    isHorizontal ? sv.contentOffset.x : sv.contentOffset.y
  }

  private func scrolled() {
    guard let sv = scrollView else { return }
    let now = CACurrentMediaTime()
    let offset = axisOffset(sv)
    let delta = offset - lastOffset
    let dt = now - lastTime
    let page = isHorizontal ? sv.bounds.width : sv.bounds.height
    if delta != 0 { direction = delta > 0 ? 1 : -1 }
    if dt > 0.2 {
      // A new gesture after a pause, not a continuation.
      velocity = 0
    } else if dt > 0, page > 0 {
      let instant = Double(abs(delta) / page) / dt
      velocity = 0.3 * instant + 0.7 * velocity
    }
    lastOffset = offset
    lastTime = now
    onScroll?()
  }
}

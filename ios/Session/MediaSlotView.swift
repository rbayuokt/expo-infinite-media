import AVFoundation
import ExpoModulesCore
import UIKit

/** A surface. It never owns a player, the session lends one. */
final class MediaSlotView: ExpoView {
  let playerLayer = AVPlayerLayer()
  private let imageLayer = CALayer()
  private var readyObservation: NSKeyValueObservation?

  weak var session: FeedSession?
  var itemId: String?
  var cover = true {
    didSet { applyGravity() }
  }
  /** Bumped on every (session, item) binding. Async results compare against it. */
  var generation: UInt64 = 0
  var boundItem: NativeItem?
  var imageToken: Int?
  var posterToken: Int?
  /** Set once the real photo is up, so a slow poster can't paint over it. */
  var fullImageShown = false
  private weak var registeredSession: FeedSession?
  private var registeredItemId: String?

  static var live = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    playerLayer.backgroundColor = UIColor.clear.cgColor
    imageLayer.masksToBounds = true
    layer.addSublayer(playerLayer)
    layer.addSublayer(imageLayer)
    applyGravity()
    readyObservation = playerLayer.observe(\.isReadyForDisplay, options: [.new]) { [weak self] layer, _ in
      guard layer.isReadyForDisplay else { return }
      DispatchQueue.main.async {
        guard let self else { return }
        self.registeredSession?.slotReadyForDisplay(self)
      }
    }
    Self.live += 1
  }

  deinit {
    readyObservation?.invalidate()
    Self.live -= 1
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = bounds
    imageLayer.frame = bounds
    CATransaction.commit()
    registeredSession?.slotDidLayout(self)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    syncRegistration()
  }

  /** Called once after a batch of prop updates. */
  func propsDidUpdate() { syncRegistration() }

  private func syncRegistration() {
    let target = window != nil ? session : nil
    let targetId = window != nil ? itemId : nil
    guard target !== registeredSession || targetId != registeredItemId else { return }
    registeredSession?.unregister(self)
    registeredSession = target
    registeredItemId = targetId
    if let target, targetId != nil { target.register(self) }
  }

  // MARK: - Visuals, driven by the session

  var pixelSize: ImagePipeline.Target {
    let scale = window?.screen.scale ?? UIScreen.main.scale
    let size = bounds.size == .zero ? UIScreen.main.bounds.size : bounds.size
    return .init(width: Int(size.width * scale), height: Int(size.height * scale), cover: cover)
  }

  func attach(_ player: AVPlayer?) {
    guard playerLayer.player !== player else { return }
    if player == nil || playerLayer.player != nil { showImageLayer(true) }
    playerLayer.player = player
  }

  func setImage(_ image: UIImage?, animated: Bool) {
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    if animated {
      let fade = CABasicAnimation(keyPath: "contents")
      fade.duration = 0.15
      imageLayer.add(fade, forKey: "contents")
    }
    imageLayer.contents = image?.cgImage
    CATransaction.commit()
  }

  func showImageLayer(_ visible: Bool, animated: Bool = false) {
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    CATransaction.setAnimationDuration(0.12)
    imageLayer.opacity = visible ? 1 : 0
    CATransaction.commit()
  }

  func reset() {
    attach(nil)
    setImage(nil, animated: false)
    showImageLayer(true)
  }

  private func applyGravity() {
    playerLayer.videoGravity = cover ? .resizeAspectFill : .resizeAspect
    imageLayer.contentsGravity = cover ? .resizeAspectFill : .resizeAspect
  }
}

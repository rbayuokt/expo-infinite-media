import AVFoundation

/** Main thread only. Idle players hold no item, so no decoder. */
final class PlayerPool {
  static let maxPlayers = 3
  private var idle: [AVPlayer] = []
  private(set) var created = 0
  private(set) var lent = 0

  func acquire() -> AVPlayer? {
    dispatchPrecondition(condition: .onQueue(.main))
    if let player = idle.popLast() {
      lent += 1
      return player
    }
    guard created < Self.maxPlayers else { return nil }
    let player = AVPlayer()
    player.automaticallyWaitsToMinimizeStalling = true
    player.actionAtItemEnd = .pause
    player.isMuted = true
    player.preventsDisplaySleepDuringVideoPlayback = true
    created += 1
    lent += 1
    return player
  }

  func release(_ player: AVPlayer) {
    dispatchPrecondition(condition: .onQueue(.main))
    player.pause()
    player.isMuted = true
    player.replaceCurrentItem(with: nil)
    lent -= 1
    idle.append(player)
  }

  /** Frees idle players, used under memory pressure. */
  func drain() {
    created -= idle.count
    idle.removeAll()
  }
}

enum Generation {
  private static var counter: UInt64 = 0

  static func next() -> UInt64 {
    dispatchPrecondition(condition: .onQueue(.main))
    counter += 1
    return counter
  }
}

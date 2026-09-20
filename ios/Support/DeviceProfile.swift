import Foundation

enum DeviceProfile {
  static let tier: DeviceTier = {
    let gb = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
    if gb < 3.5 { return .low }
    if gb < 5.5 { return .mid }
    return .high
  }()
}

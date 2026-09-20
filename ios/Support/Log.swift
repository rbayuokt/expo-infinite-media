import os

enum LogLevel: Int {
  case none = 0, error, warn, debug

  init(name: String?) {
    switch name {
    case "none": self = .none
    case "error": self = .error
    case "debug": self = .debug
    default: self = .warn
    }
  }
}

enum Log {
  static var level: LogLevel = .warn
  private static let logger = Logger(subsystem: "expo.modules.infinitemedia", category: "InfiniteMedia")

  static func error(_ message: @autoclosure () -> String) {
    if level.rawValue >= LogLevel.error.rawValue { let m = message(); logger.error("\(m, privacy: .public)") }
  }

  static func warn(_ message: @autoclosure () -> String) {
    if level.rawValue >= LogLevel.warn.rawValue { let m = message(); logger.warning("\(m, privacy: .public)") }
  }

  static func debug(_ message: @autoclosure () -> String) {
    if level.rawValue >= LogLevel.debug.rawValue { let m = message(); logger.debug("\(m, privacy: .public)") }
  }
}

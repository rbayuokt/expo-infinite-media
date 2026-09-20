import AVFoundation

struct MediaError: Error {
  let code: String
  let message: String
  let retryable: Bool
  var httpStatus: Int?
  var nativeCode: String?

  func payload(itemId: String, attempt: Int, recoverable: Bool) -> [String: Any] {
    var out: [String: Any] = [
      "itemId": itemId, "code": code, "message": message, "recoverable": recoverable, "attempt": attempt,
    ]
    if let httpStatus { out["httpStatus"] = httpStatus }
    if let nativeCode { out["nativeCode"] = nativeCode }
    return out
  }

  static func from(_ error: Error?) -> MediaError {
    guard let ns = error as NSError? else {
      return MediaError(code: "UNKNOWN", message: "unknown", retryable: true)
    }
    // AVFoundation wraps transport errors, sometimes more than once. Walk the chain.
    var chain = [ns]
    while let next = chain.last?.userInfo[NSUnderlyingErrorKey] as? NSError, chain.count < 8 { chain.append(next) }
    let root = chain.first { $0.domain == NSURLErrorDomain } ?? ns
    let native = "\(root.domain):\(root.code)"

    if let status = chain.lazy.compactMap({ $0.userInfo[httpStatusKey] as? Int }).first {
      return http(status, native: native)
    }
    if root.domain == NSURLErrorDomain {
      switch root.code {
      case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorDataNotAllowed,
        NSURLErrorInternationalRoamingOff, NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost,
        NSURLErrorDNSLookupFailed:
        return MediaError(code: "NETWORK_UNAVAILABLE", message: root.localizedDescription, retryable: true, nativeCode: native)
      case NSURLErrorTimedOut:
        return MediaError(code: "TIMEOUT", message: root.localizedDescription, retryable: true, nativeCode: native)
      case NSURLErrorFileDoesNotExist, NSURLErrorResourceUnavailable, NSURLErrorBadURL, NSURLErrorUnsupportedURL:
        return MediaError(code: "SOURCE_NOT_FOUND", message: root.localizedDescription, retryable: false, nativeCode: native)
      default:
        return MediaError(code: "NETWORK_UNAVAILABLE", message: root.localizedDescription, retryable: true, nativeCode: native)
      }
    }
    if ns.domain == AVFoundationErrorDomain {
      switch AVError.Code(rawValue: ns.code) {
      case .decoderNotFound, .decoderTemporarilyUnavailable:
        return MediaError(code: "DECODER_INIT_FAILED", message: ns.localizedDescription, retryable: true, nativeCode: native)
      case .fileFormatNotRecognized, .failedToParse, .formatUnsupported, .contentIsUnavailable, .noLongerPlayable:
        return MediaError(code: "UNSUPPORTED_FORMAT", message: ns.localizedDescription, retryable: false, nativeCode: native)
      case .decodeFailed, .mediaDiscontinuity:
        return MediaError(code: "DECODE_FAILED", message: ns.localizedDescription, retryable: true, nativeCode: native)
      case .contentIsNotAuthorized, .contentIsProtected:
        return MediaError(code: "SOURCE_NOT_FOUND", message: ns.localizedDescription, retryable: false, nativeCode: native)
      default: break
      }
    }
    return MediaError(code: "PLAYER_FAILED", message: ns.localizedDescription, retryable: true, nativeCode: native)
  }

  static func http(_ status: Int, native: String? = nil) -> MediaError {
    let code = status == 404 || status == 410 ? "SOURCE_NOT_FOUND" : "HTTP_ERROR"
    // 408 and 429 are worth another try, other 4xx are not.
    let retryable = status >= 500 || status == 408 || status == 429
    return MediaError(code: code, message: "HTTP \(status)", retryable: retryable, httpStatus: status, nativeCode: native)
  }

  static let httpStatusKey = "InfiniteMediaHTTPStatus"
}

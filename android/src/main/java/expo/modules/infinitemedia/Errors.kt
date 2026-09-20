package expo.modules.infinitemedia

import androidx.media3.common.PlaybackException
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.cache.Cache
import java.net.SocketTimeoutException
import java.net.UnknownHostException

internal data class MediaError(
  val code: String,
  val message: String,
  val httpStatus: Int? = null,
  val nativeCode: String? = null,
  /** Worth an automatic retry at all. */
  val retryable: Boolean = true
) {
  fun toMap(itemId: String, recoverable: Boolean, attempt: Int): Map<String, Any?> = buildMap {
    put("itemId", itemId)
    put("code", code)
    put("message", message)
    put("recoverable", recoverable)
    put("attempt", attempt)
    httpStatus?.let { put("httpStatus", it) }
    nativeCode?.let { put("nativeCode", it) }
  }
}

internal object Errors {
  fun from(e: PlaybackException): MediaError {
    val native = e.errorCodeName
    val http = findCause<HttpDataSource.InvalidResponseCodeException>(e)
    if (http != null) {
      val s = http.responseCode
      // 408 and 429 are worth retrying, other 4xx aren't.
      val retry = s >= 500 || s == 408 || s == 429
      val code = if (s == 404 || s == 410) "SOURCE_NOT_FOUND" else "HTTP_ERROR"
      return MediaError(code, "HTTP $s", s, native, retry)
    }
    if (findCause<Cache.CacheException>(e) != null) return MediaError("CACHE_CORRUPT", e.message ?: native, nativeCode = native)
    return when (e.errorCode) {
      PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> MediaError("NETWORK_UNAVAILABLE", native, nativeCode = native)
      PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
      PlaybackException.ERROR_CODE_TIMEOUT -> MediaError("TIMEOUT", native, nativeCode = native)
      PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> MediaError("SOURCE_NOT_FOUND", native, nativeCode = native, retryable = false)
      PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> MediaError("HTTP_ERROR", native, nativeCode = native)
      PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
      PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
      PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
      PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED,
      PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
      PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES ->
        MediaError("UNSUPPORTED_FORMAT", native, nativeCode = native, retryable = false)
      PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
      PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED -> MediaError("DECODER_INIT_FAILED", native, nativeCode = native)
      PlaybackException.ERROR_CODE_DECODING_FAILED -> MediaError("DECODE_FAILED", native, nativeCode = native)
      else -> when {
        findCause<SocketTimeoutException>(e) != null -> MediaError("TIMEOUT", native, nativeCode = native)
        e.errorCode in 2000..2999 -> MediaError("NETWORK_UNAVAILABLE", native, nativeCode = native)
        else -> MediaError("PLAYER_FAILED", e.message ?: native, nativeCode = native)
      }
    }
  }

  fun image(t: Throwable?): MediaError {
    val msg = t?.message ?: "image load failed"
    val status = (t as? coil3.network.HttpException)?.response?.code
    return when {
      status != null -> MediaError(if (status == 404) "SOURCE_NOT_FOUND" else "HTTP_ERROR", msg, status, retryable = status >= 500)
      t is UnknownHostException -> MediaError("NETWORK_UNAVAILABLE", msg)
      t is SocketTimeoutException -> MediaError("TIMEOUT", msg)
      t is java.io.IOException -> MediaError("NETWORK_UNAVAILABLE", msg)
      else -> MediaError("IMAGE_DECODE_FAILED", msg, retryable = false)
    }
  }

  private inline fun <reified T : Throwable> findCause(e: Throwable): T? {
    var c: Throwable? = e
    while (c != null) {
      if (c is T) return c
      c = c.cause
    }
    return null
  }
}

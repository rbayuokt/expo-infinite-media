package expo.modules.infinitemedia

internal object Log {
  private const val TAG = "InfiniteMedia"

  /** 0 none, 1 error, 2 warn, 3 debug. */
  @Volatile var level = 2

  fun setLevel(name: String?) {
    level = when (name) {
      "none" -> 0
      "error" -> 1
      "debug" -> 3
      else -> 2
    }
  }

  fun d(msg: String) { if (level >= 3) android.util.Log.d(TAG, msg) }
  fun w(msg: String, t: Throwable? = null) { if (level >= 2) android.util.Log.w(TAG, msg, t) }
  fun e(msg: String, t: Throwable? = null) { if (level >= 1) android.util.Log.e(TAG, msg, t) }
}

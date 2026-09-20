package expo.modules.infinitemedia

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.media.MediaCodecList
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import expo.modules.infinitemedia.core.DeviceTier
import expo.modules.infinitemedia.core.MemoryLevel
import expo.modules.infinitemedia.core.NetworkKind

/** Network, memory, thermal and device class. Every change is reported on main. */
internal class Environment(private val ctx: Context, private val onChange: (reconnected: Boolean) -> Unit) :
  ComponentCallbacks2 {
  private val main = Handler(Looper.getMainLooper())
  private val cm = ctx.getSystemService(ConnectivityManager::class.java)
  private val pm = ctx.getSystemService(PowerManager::class.java)
  private var started = false

  var network = NetworkKind.WIFI
    private set
  private var memory = MemoryLevel.NORMAL
  private var thermalSevere = false
  var memoryWarnings = 0
    private set
  var tier = DeviceTier.MID
    private set

  /** Thermal throttling counts as memory pressure for the policy. */
  val memoryLevel: MemoryLevel
    get() = if (thermalSevere && memory == MemoryLevel.NORMAL) MemoryLevel.PRESSURE else memory

  private val recoverMemory = Runnable {
    memory = MemoryLevel.NORMAL
    onChange(false)
  }

  private val netCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onCapabilitiesChanged(n: Network, caps: NetworkCapabilities) {
      main.post { setNetwork(classify(caps)) }
    }

    override fun onLost(n: Network) {
      main.post { setNetwork(NetworkKind.OFFLINE) }
    }
  }

  // Typed Any so API 24-28 never load the listener interface.
  private var thermalListener: Any? = null

  fun start() {
    if (started) return
    started = true
    tier = baseTier()
    cm?.activeNetwork?.let { n -> cm.getNetworkCapabilities(n)?.let { network = classify(it) } }
      ?: run { network = NetworkKind.OFFLINE }
    runCatching { cm?.registerDefaultNetworkCallback(netCallback) }
    ctx.registerComponentCallbacks(this)
    if (Build.VERSION.SDK_INT >= 29 && pm != null) {
      val l = PowerManager.OnThermalStatusChangedListener { status ->
        val severe = status >= PowerManager.THERMAL_STATUS_SEVERE
        if (severe != thermalSevere) {
          thermalSevere = severe
          onChange(false)
        }
      }
      thermalListener = l
      pm.addThermalStatusListener(ctx.mainExecutor, l)
    }
    // MediaCodecList can take tens of ms, keep it off main.
    Thread {
      val lowDecoders = maxAvcInstances() in 1..3
      main.post {
        if (lowDecoders && tier != DeviceTier.LOW) {
          tier = DeviceTier.LOW
          onChange(false)
        }
      }
    }.start()
  }

  fun stop() {
    if (!started) return
    started = false
    runCatching { cm?.unregisterNetworkCallback(netCallback) }
    ctx.unregisterComponentCallbacks(this)
    if (Build.VERSION.SDK_INT >= 29) {
      (thermalListener as? PowerManager.OnThermalStatusChangedListener)?.let { pm?.removeThermalStatusListener(it) }
      thermalListener = null
    }
    main.removeCallbacks(recoverMemory)
  }

  private fun setNetwork(kind: NetworkKind) {
    if (kind == network) return
    val reconnected = network == NetworkKind.OFFLINE
    network = kind
    onChange(reconnected)
  }

  private fun classify(caps: NetworkCapabilities): NetworkKind {
    if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return NetworkKind.OFFLINE
    val saver = cm?.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
    val metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    return when {
      saver && metered -> NetworkKind.CONSTRAINED
      caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkKind.CELLULAR
      else -> NetworkKind.WIFI
    }
  }

  private fun baseTier(): DeviceTier {
    val am = ctx.getSystemService(ActivityManager::class.java) ?: return DeviceTier.MID
    if (am.isLowRamDevice || am.memoryClass <= 192) return DeviceTier.LOW
    val info = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
    return if (am.memoryClass >= 512 && info.totalMem >= 6L * 1024 * 1024 * 1024) DeviceTier.HIGH else DeviceTier.MID
  }

  private fun maxAvcInstances(): Int = runCatching {
    MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
      .filter { !it.isEncoder && it.supportedTypes.any { t -> t.equals("video/avc", true) } }
      .maxOfOrNull { it.getCapabilitiesForType("video/avc").maxSupportedInstances } ?: 0
  }.getOrDefault(0)

  @Suppress("DEPRECATION")
  override fun onTrimMemory(level: Int) {
    val next = when {
      level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> MemoryLevel.CRITICAL
      level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> return
      level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND -> MemoryLevel.PRESSURE
      level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> MemoryLevel.CRITICAL
      level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE -> MemoryLevel.PRESSURE
      else -> return
    }
    raise(next)
  }

  @Deprecated("Deprecated in Java")
  override fun onLowMemory() = raise(MemoryLevel.CRITICAL)

  override fun onConfigurationChanged(newConfig: Configuration) = Unit

  private fun raise(level: MemoryLevel) {
    main.post { applyMemory(level) }
  }

  private fun applyMemory(level: MemoryLevel) {
    memoryWarnings++
    main.removeCallbacks(recoverMemory)
    // Android never says memory is fine again, so step back down after a quiet period.
    main.postDelayed(recoverMemory, 30_000)
    if (level.ordinal > memory.ordinal) {
      memory = level
      onChange(false)
    }
  }
}

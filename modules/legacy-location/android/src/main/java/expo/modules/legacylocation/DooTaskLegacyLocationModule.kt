package expo.modules.legacylocation

import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 对齐旧 eeui LocationHelper：直接用系统 LocationManager 同时监听 GPS 与网络定位。
 * expo-location 走 Google Play 服务的 Fused 定位，国内机型没有 GMS 时一直等不到结果。
 * 权限申请与定位服务开关检查由 JS 侧（expo-location）完成，这里只负责取位置；结果为 WGS84。
 */
class DooTaskLegacyLocationModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val requests = mutableSetOf<Request>()

  override fun definition() = ModuleDefinition {
    Name("DooTaskLegacyLocation")

    AsyncFunction("getPosition") { timeoutMs: Int, minAccuracy: Double, maxAgeMs: Int, promise: Promise ->
      val context = appContext.reactContext
      val manager = context?.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
      if (manager == null) {
        promise.reject("UNEXPECTED_ERROR", "定位服务不可用", null)
        return@AsyncFunction
      }
      handler.post { start(manager, timeoutMs.toLong(), minAccuracy.toFloat(), maxAgeMs.toLong(), promise) }
    }

    OnDestroy {
      handler.post { requests.toList().forEach { it.finish(null, "UNEXPECTED_ERROR", "定位已取消") } }
    }
  }

  private fun start(manager: LocationManager, timeoutMs: Long, minAccuracy: Float, maxAgeMs: Long, promise: Promise) {
    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
      .filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
    if (providers.isEmpty()) {
      promise.reject("LOCATION_DISABLED", "定位服务未开启", null)
      return
    }
    val request = Request(manager, minAccuracy, promise)
    try {
      val cached = providers
        .mapNotNull { manager.getLastKnownLocation(it) }
        .filter { ageMs(it) <= maxAgeMs && it.hasAccuracy() && it.accuracy <= minAccuracy }
        .minByOrNull { it.accuracy }
      if (cached != null) {
        promise.resolve(toResult(cached))
        return
      }
      requests.add(request)
      providers.forEach { manager.requestLocationUpdates(it, 1000L, 0f, request, Looper.getMainLooper()) }
      handler.postDelayed(request.timeout, timeoutMs)
    } catch (error: SecurityException) {
      request.finish(null, "SECURITY_EXCEPTION", error.message ?: "没有定位权限")
    } catch (error: Exception) {
      request.finish(null, "UNEXPECTED_ERROR", error.message ?: "定位失败")
    }
  }

  private fun ageMs(location: Location) =
    (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000

  private fun toResult(location: Location) = mapOf(
    "latitude" to location.latitude,
    "longitude" to location.longitude,
    "accuracy" to if (location.hasAccuracy()) location.accuracy.toDouble() else null,
  )

  private inner class Request(
    private val manager: LocationManager,
    private val minAccuracy: Float,
    private val promise: Promise,
  ) : LocationListener {
    private var done = false
    val timeout = Runnable { finish(null, "TIMEOUT", "定位超时") }

    fun finish(location: Location?, code: String?, message: String?) {
      if (done) return
      done = true
      requests.remove(this)
      handler.removeCallbacks(timeout)
      runCatching { manager.removeUpdates(this) }
      if (location != null) promise.resolve(toResult(location))
      else promise.reject(code ?: "UNEXPECTED_ERROR", message ?: "定位失败", null)
    }

    override fun onLocationChanged(location: Location) {
      if (location.hasAccuracy() && location.accuracy <= minAccuracy) finish(location, null, null)
    }

    // 旧版 API 上为抽象方法，需显式实现
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
  }
}

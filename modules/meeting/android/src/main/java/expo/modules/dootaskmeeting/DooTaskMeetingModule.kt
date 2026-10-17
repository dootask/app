package expo.modules.dootaskmeeting

import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.agora.rtc.ng.react.AgoraRtcNgModule

class DooTaskMeetingModule : Module() {
  private val serviceLock = Any()
  private var serviceSession: String? = null

  override fun definition() = ModuleDefinition {
    Name("DooTaskMeeting")

    // 必须在前台完成服务提升，再允许 Agora 开始采集。后台收到请求时不尝试启动。
    AsyncFunction("start") { session: String, camera: Boolean, microphone: Boolean, title: String, text: String, promise: Promise ->
      val context = requireNotNull(appContext.reactContext) { "原生上下文尚未就绪" }
      val process = ActivityManager.RunningAppProcessInfo()
      ActivityManager.getMyMemoryState(process)
      if (appContext.currentActivity == null || process.importance > ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
        promise.reject("ERR_MEETING_BACKGROUND", "请回到前台后加入会议", null)
      } else {
        val receiver = object : ResultReceiver(Handler(Looper.getMainLooper())) {
          override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
            if (resultCode == 0) promise.resolve(null)
            else promise.reject("ERR_MEETING_SERVICE", resultData?.getString("error") ?: "会议保活启动失败", null)
          }
        }
        val intent = Intent(context, MeetingKeepAliveService::class.java)
          .putExtra("session", session)
          .putExtra("camera", camera)
          .putExtra("microphone", microphone)
          .putExtra("title", title)
          .putExtra("text", text)
          .putExtra("receiver", receiver)
        try {
          synchronized(serviceLock) {
            serviceSession = session
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
          }
        } catch (error: RuntimeException) {
          promise.reject("ERR_MEETING_SERVICE", "会议保活启动失败", error)
        }
      }
    }.runOnQueue(Queues.MAIN)

    Function("stop") { session: String ->
      synchronized(serviceLock) { if (serviceSession == session) stopService() }
    }
    OnDestroy {
      synchronized(serviceLock) {
        if (serviceSession != null) {
          try { (appContext.reactContext as? ReactContext)?.getNativeModule(AgoraRtcNgModule::class.java)?.destroyIrisApiEngine() }
          catch (_: RuntimeException) { /* React Runtime 可能已先销毁。 */ }
        }
        stopService()
      }
    }
  }

  private fun stopService() {
    synchronized(serviceLock) {
      serviceSession = null
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, MeetingKeepAliveService::class.java))
      }
    }
  }
}

package expo.modules.dootaskmeeting

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.ResultReceiver
import com.facebook.react.ReactApplication
import com.facebook.react.modules.core.DeviceEventManagerModule
import io.agora.rtc.ng.react.AgoraRtcNgModule

/** 服务只保留当前通话，不在进程被杀后重建没有 JS/Agora 会话的通知。 */
class MeetingKeepAliveService : Service() {
  private var foregroundStarted = false
  private var sessionId: String? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    @Suppress("DEPRECATION")
    val receiver = intent?.getParcelableExtra<ResultReceiver>("receiver")
    try {
      val manager = getSystemService(NotificationManager::class.java)
      val title = intent?.getStringExtra("title").orEmpty()
      val text = intent?.getStringExtra("text").orEmpty()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_LOW).apply {
          setSound(null, null)
          enableVibration(false)
        })
      }
      val launch = requireNotNull(packageManager.getLaunchIntentForPackage(packageName))
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val pending = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      @Suppress("DEPRECATION")
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL)
        else Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
      val notification = builder
        .setSmallIcon(R.drawable.meeting_notification)
        .setContentTitle(title)
        .setContentText(text)
        .setContentIntent(pending)
        .setCategory(Notification.CATEGORY_CALL)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .build()

      // 不声明尚未获准的 while-in-use 类型；仅收听时以 mediaPlayback 保活。
      var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      if (intent?.getBooleanExtra("camera", false) == true) {
        check(checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { "未获得相机权限" }
        types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      }
      if (intent?.getBooleanExtra("microphone", false) == true) {
        check(checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "未获得麦克风权限" }
        types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION, notification, types)
      else startForeground(NOTIFICATION, notification)
      foregroundStarted = true
      sessionId = intent?.getStringExtra("session")
      receiver?.send(0, Bundle.EMPTY)
    } catch (error: RuntimeException) {
      receiver?.send(1, Bundle().apply { putString("error", error.message) })
      // 已有通话升级服务类型失败时保留原先的保活。
      if (!foregroundStarted) stopSelf(startId)
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    val reactContext = (application as? ReactApplication)?.reactHost?.currentReactContext
    try {
      // 新架构 ReactHost 持有当前 Runtime；滑走任务时即使 JS 未卸载也要停止采集。
      reactContext?.getNativeModule(AgoraRtcNgModule::class.java)?.destroyIrisApiEngine()
    } catch (_: RuntimeException) {
      // Runtime 已失效时仍清除服务和通知。
    } finally {
      try {
        reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit("DooTaskMeetingTaskRemoved", sessionId)
      } catch (_: RuntimeException) { /* JS 已销毁时无需回传。 */ }
      stopSelf()
      super.onTaskRemoved(rootIntent)
    }
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "dootask.meeting"
    private const val NOTIFICATION = 22224
  }
}

package expo.modules.legacystore

import android.content.Context
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DooTaskLegacyStoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DooTaskLegacyStore")

    AsyncFunction("readCaches") {
      val context = requireNotNull(appContext.reactContext) { "原生上下文尚未就绪" }
      // eeuiCommon 将全部缓存序列化到此偏好文件的同名键，保留旧数据不作写入。
      context.getSharedPreferences("eeuiCaches", Context.MODE_PRIVATE).getString("eeuiCaches", "{}") ?: "{}"
    }

    AsyncFunction("moveTaskToBack") {
      requireNotNull(appContext.currentActivity) { "当前 Activity 不存在" }.moveTaskToBack(true)
      Unit
    }.runOnQueue(Queues.MAIN)
  }
}

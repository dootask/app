package expo.modules.legacystore

import android.content.Context
import android.view.inputmethod.InputMethodManager
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

    // 对齐 eeui keyboardHide（KeyboardUtils.hideSoftInput）：只收起输入法，不清除 WebView 内的焦点
    AsyncFunction("hideSoftInput") {
      val activity = requireNotNull(appContext.currentActivity) { "当前 Activity 不存在" }
      val view = activity.currentFocus ?: activity.window.decorView
      val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      imm.hideSoftInputFromWindow(view.windowToken, 0)
      Unit
    }.runOnQueue(Queues.MAIN)
  }
}

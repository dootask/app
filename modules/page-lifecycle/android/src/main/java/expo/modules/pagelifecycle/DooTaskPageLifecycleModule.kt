package expo.modules.pagelifecycle

import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val TAG = "DooTaskPageLifecycle"
private const val PAUSE_JS =
  "(function(){if(typeof window.__onPagePause!=='function')return 'none';window.__onPagePause();return 'ok';})()"

class DooTaskPageLifecycleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DooTaskPageLifecycle")

    // RN 新架构在 onHostPause 时暂停 Fabric 帧回调，injectJavaScript 要等回到前台才执行；
    // 对齐旧 eeui pagePause：进入后台当场对可见 WebView 直接执行 __onPagePause
    OnActivityEntersBackground {
      val root = appContext.currentActivity?.window?.decorView ?: return@OnActivityEntersBackground
      val webViews = mutableListOf<WebView>()
      collectShownWebViews(root, webViews)
      Log.d(TAG, "进入后台，通知 ${webViews.size} 个 WebView")
      webViews.forEach { webView ->
        webView.evaluateJavascript(PAUSE_JS) { result -> Log.d(TAG, "__onPagePause 执行结果: $result") }
      }
    }
  }

  private fun collectShownWebViews(view: View, out: MutableList<WebView>) {
    if (view is WebView) {
      if (view.isShown) out.add(view)
      return
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) collectShownWebViews(view.getChildAt(i), out)
    }
  }
}

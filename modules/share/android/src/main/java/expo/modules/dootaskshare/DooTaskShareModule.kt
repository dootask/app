package expo.modules.dootaskshare

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DooTaskShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DooTaskShare")

    Function("writeSettings") { settings: Map<String, String> ->
      val context = requireNotNull(appContext.reactContext) { "原生上下文尚未就绪" }
      ShareSettings.write(context, settings)
    }
  }
}

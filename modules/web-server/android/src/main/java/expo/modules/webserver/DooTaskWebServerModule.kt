package expo.modules.webserver

import android.content.res.AssetManager
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException

class DooTaskWebServerModule : Module() {
  private var server: LocalHttpServer? = null

  override fun definition() = ModuleDefinition {
    Name("DooTaskWebServer")

    AsyncFunction("start") { port: Int ->
      val assets = requireNotNull(appContext.reactContext) { "原生上下文尚未就绪" }.assets
      val instance = server ?: LocalHttpServer(
        openAsset = { path ->
          // 未压缩资源可直接取得长度；压缩资源用分块传输，不读入整个文件。
          val descriptor = try { assets.openFd("web/$path") } catch (_: IOException) { null }
          if (descriptor != null) {
            try {
              WebAsset(descriptor.createInputStream(), descriptor.length)
            } catch (error: Exception) {
              descriptor.close()
              throw error
            }
          } else {
            WebAsset(assets.open("web/$path", AssetManager.ACCESS_STREAMING), null)
          }
        },
        lookupMime = { extension -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) }
      ).also { server = it }
      instance.start(port)
      mapOf("port" to port)
    }

    AsyncFunction("stop") {
      server?.stop()
      Unit
    }
    AsyncFunction("isRunning") { server?.isRunning() ?: false }
    OnDestroy { server?.stop() }
  }
}

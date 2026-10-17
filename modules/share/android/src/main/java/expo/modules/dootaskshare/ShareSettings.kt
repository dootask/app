package expo.modules.dootaskshare

import android.content.Context
import org.json.JSONObject

/** 与旧 eeui 缓存格式一致，独立 Activity 可在 JS 未启动时直接读取。 */
internal object ShareSettings {
  private val keys = setOf("language", "chatList", "upLoadUrl", "fileUpLoadUrl")

  @Synchronized
  fun write(context: Context, settings: Map<String, String>) {
    val preferences = context.getSharedPreferences("eeuiCaches", Context.MODE_PRIVATE)
    val caches = runCatching { JSONObject(preferences.getString("eeuiCaches", "{}") ?: "{}") }
      .getOrDefault(JSONObject())
    settings.filterKeys { it in keys }.forEach { (key, value) ->
      caches.put(key, JSONObject().put(key, value).put("expired", 0))
    }
    check(preferences.edit().putString("eeuiCaches", caches.toString()).commit()) { "分享配置写入失败" }
  }

  fun read(context: Context, key: String): String = runCatching {
    val raw = context.getSharedPreferences("eeuiCaches", Context.MODE_PRIVATE).getString("eeuiCaches", "{}")
    val entry = JSONObject(raw ?: "{}").optJSONObject(key) ?: return@runCatching ""
    val expiry = entry.optLong("expired", 0)
    if (expiry > 0 && expiry < System.currentTimeMillis() / 1000) "" else entry.optString(key, "")
  }.getOrDefault("")
}

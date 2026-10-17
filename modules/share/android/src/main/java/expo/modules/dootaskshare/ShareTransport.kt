package expo.modules.dootaskshare

import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

internal class ShareException(val key: String = "netWorkErrorTitle", val serverMessage: String? = null) : Exception()

internal data class ShareDestination(val json: JSONObject) {
  val name: String get() = json.optString("name")
  val icon: String get() = json.optString("icon")
  val url: String get() = json.optString("url")
  val isFolder: Boolean get() = json.optString("type") == "children"
  val dialogID: String get() = json.optJSONObject("extend")?.optString("dialog_ids", "") ?: ""
  val folderID: String get() = json.optJSONObject("extend")?.optString("upload_file_id", "0") ?: "0"
}

internal class ShareTransport {
  private val connections = ConcurrentHashMap.newKeySet<HttpURLConnection>()
  @Volatile private var closed = false

  fun close() {
    closed = true
    connections.forEach { it.disconnect() }
  }

  private fun connection(value: String): HttpURLConnection {
    check(!closed && !Thread.currentThread().isInterrupted)
    val url = URL(value)
    require(url.protocol in setOf("http", "https"))
    val connection = url.openConnection() as HttpURLConnection
    connections.add(connection)
    if (closed) { connection.disconnect(); throw InterruptedException() }
    connection.connectTimeout = 15000
    connection.readTimeout = 60000
    connection.instanceFollowRedirects = false
    connection.setRequestProperty("Accept", "application/json")
    return connection
  }

  private fun release(connection: HttpURLConnection) {
    connections.remove(connection)
    connection.disconnect()
  }

  private fun response(connection: HttpURLConnection): JSONObject {
    if (connection.responseCode !in 200..299) throw ShareException()
    val json = connection.inputStream.bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
    if (json.optInt("ret") != 1) throw ShareException(serverMessage = json.optString("msg").takeIf { it.isNotEmpty() })
    return json
  }

  fun list(value: String): List<ShareDestination> {
    val connection = connection(value)
    return try {
      val rows = response(connection).getJSONArray("data")
      (0 until rows.length()).map { ShareDestination(rows.getJSONObject(it)) }
    } finally { release(connection) }
  }

  fun avatar(value: String): ByteArray? {
    val connection = connection(value)
    return try {
      if (connection.responseCode != 200) return null
      connection.inputStream.use { stream ->
        val bytes = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (bytes.size() <= 1024 * 1024) {
          val size = stream.read(buffer)
          if (size < 0) return bytes.toByteArray()
          bytes.write(buffer, 0, size)
        }
        null
      }
    } finally { release(connection) }
  }

  fun upload(value: String, payload: SharePayload, parameters: Map<String, String>, progress: (Int) -> Unit) {
    val boundary = "DooTask-${UUID.randomUUID()}"
    val prefix = buildString {
      parameters.forEach { (key, content) ->
        append("--$boundary\r\nContent-Disposition: form-data; name=\"$key\"\r\n\r\n$content\r\n")
      }
      val file = payload.file
      if (file != null) {
        val name = file.name.replace(Regex("[\\r\\n\"]"), "_")
        val mime = payload.mime.takeUnless { it.contains('\r') || it.contains('\n') } ?: "application/octet-stream"
        append("--$boundary\r\nContent-Disposition: form-data; name=\"files\"; filename=\"$name\"\r\nContent-Type: $mime\r\n\r\n")
      } else {
        append("--$boundary\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n")
        append(payload.text ?: "")
      }
    }.toByteArray(Charsets.UTF_8)
    val suffix = "\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8)
    val length = prefix.size.toLong() + (payload.file?.length() ?: 0) + suffix.size
    val connection = connection(value)
    try {
      connection.requestMethod = "POST"
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(length)
      connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
      connection.outputStream.buffered().use { output ->
        output.write(prefix)
        var sent = prefix.size.toLong()
        var lastProgress = -1
        payload.file?.inputStream()?.use { input ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            if (closed || Thread.currentThread().isInterrupted) throw InterruptedException()
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            sent += count
            val current = (sent * 100 / length).toInt().coerceAtMost(99)
            if (current != lastProgress) { progress(current); lastProgress = current }
          }
        }
        output.write(suffix)
      }
      response(connection)
      // 只有后端 ret=1 才计为成功，传完字节不代表成功。
      progress(100)
    } finally { release(connection) }
  }

  companion object {
    fun url(value: String, parameters: Map<String, String>): String {
      val base = Uri.parse(value)
      if (base.scheme !in setOf("http", "https") || base.host.isNullOrEmpty()) throw ShareException("unLoginTitle")
      val builder = base.buildUpon().clearQuery()
      base.queryParameterNames.filter { it !in parameters }.forEach { key ->
        base.getQueryParameters(key).forEach { builder.appendQueryParameter(key, it) }
      }
      parameters.forEach { (key, content) -> builder.appendQueryParameter(key, content) }
      return builder.build().toString()
    }

    fun destinations(json: String?): List<ShareDestination> {
      val values = JSONArray(json ?: "[]")
      return (0 until values.length()).map { ShareDestination(values.getJSONObject(it)) }
    }
  }
}

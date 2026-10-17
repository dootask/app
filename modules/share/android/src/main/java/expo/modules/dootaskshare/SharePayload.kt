package expo.modules.dootaskshare

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.OpenableColumns
import org.json.JSONObject
import java.io.File

internal data class SharePayload(val file: File? = null, val text: String? = null, val mime: String = "application/octet-stream") {
  fun json(): JSONObject = JSONObject().put("file", file?.absolutePath).put("text", text).put("mime", mime)

  companion object {
    fun restore(json: JSONObject, directory: File): SharePayload {
      val text = json.optString("text").takeIf { json.has("text") && !json.isNull("text") }
      if (text != null) return SharePayload(text = text)
      val file = File(json.getString("file")).canonicalFile
      require(file.path.startsWith(directory.canonicalPath + File.separator) && file.isFile)
      return SharePayload(file = file, mime = json.optString("mime", "application/octet-stream"))
    }

    @Suppress("DEPRECATION")
    fun load(context: Context, intent: Intent, directory: File): List<SharePayload> {
      require(intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE)
      val uris = linkedSetOf<Uri>()
      if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
        val streams = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
          else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
        streams?.let { uris.addAll(it) }
      } else {
        val stream = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
          else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        stream?.let { uris.add(it) }
      }
      val texts = linkedSetOf<String>()
      intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotEmpty() }?.let { texts.add(it) }
      intent.clipData?.let { clip ->
        for (index in 0 until clip.itemCount) {
          val item = clip.getItemAt(index)
          val uri = item.uri
          if (uri != null && uri.scheme in setOf("content", "file")) uris.add(uri)
          else if (uri != null && uri.scheme in setOf("http", "https")) texts.add(uri.toString())
          item.text?.toString()?.takeIf { it.isNotEmpty() }?.let { texts.add(it) }
        }
      }
      // 有文件时 EXTRA_TEXT 通常是标题或说明，旧壳也只发送文件。
      if (uris.isEmpty()) return texts.map { SharePayload(text = it) }.also { require(it.isNotEmpty()) }
      return uris.map { uri ->
        if (Thread.currentThread().isInterrupted) throw InterruptedException()
        require(uri.scheme in setOf("content", "file"))
        if (uri.scheme == "file") {
          // 外部应用不能借导出的 Activity 读取本应用私有文件。
          require(File(requireNotNull(uri.path)).canonicalPath.startsWith(Environment.getExternalStorageDirectory().canonicalPath + File.separator))
        }
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: intent.type ?: "application/octet-stream"
        if (mime == "vnd.android.document/directory") throw ShareException("folderUnsupportTitle")
        var name = uri.lastPathSegment ?: "shared-file"
        if (uri.scheme == "content") {
          resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && cursor.moveToFirst()) name = cursor.getString(column) ?: name
          }
        }
        name = name.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[\\r\\n\"]"), "_")
        if (name.isBlank() || name == "." || name == "..") name = "shared-file"
        val folder = File(directory, java.util.UUID.randomUUID().toString())
        check(folder.mkdir())
        val file = File(folder, name)
        requireNotNull(resolver.openInputStream(uri)).use { input ->
          file.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              if (Thread.currentThread().isInterrupted) throw InterruptedException()
              val count = input.read(buffer)
              if (count < 0) break
              output.write(buffer, 0, count)
            }
          }
        }
        SharePayload(file = file, mime = mime)
      }
    }
  }
}

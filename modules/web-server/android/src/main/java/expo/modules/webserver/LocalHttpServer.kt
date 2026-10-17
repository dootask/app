package expo.modules.webserver

import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.Locale
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal data class WebAsset(val stream: InputStream, val length: Long?)

/** 只依赖 JDK，方便在没有 Android 运行时的环境验证 HTTP 行为。 */
internal class LocalHttpServer(
  private val openAsset: (String) -> WebAsset,
  private val lookupMime: (String) -> String? = { null }
) {
  @Volatile private var listener: ServerSocket? = null
  @Volatile private var acceptThread: Thread? = null
  private var workers: ThreadPoolExecutor? = null
  private val clients = ConcurrentHashMap.newKeySet<Socket>()

  @Synchronized fun start(port: Int) {
    require(port in 1..65535) { "端口必须在 1 到 65535 之间" }
    if (isRunning() && listener?.localPort == port) return
    stop()
    openAsset("index.html").stream.close()
    val socket = ServerSocket()
    try {
      socket.reuseAddress = true
      socket.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 32)
    } catch (error: Exception) {
      socket.close()
      throw error
    }
    val pool = ThreadPoolExecutor(4, 8, 30, TimeUnit.SECONDS, ArrayBlockingQueue(32), { task ->
      Thread(task, "dootask-http-worker").apply { isDaemon = true }
    })
    listener = socket
    workers = pool
    acceptThread = Thread({ acceptConnections(socket, pool) }, "dootask-http-accept").apply {
      isDaemon = true
      start()
    }
  }

  fun isRunning(): Boolean = listener?.let {
    it.isBound && !it.isClosed && acceptThread?.isAlive == true
  } ?: false

  @Synchronized fun stop() {
    listener?.close()
    listener = null
    clients.forEach { runCatching { it.close() } }
    clients.clear()
    workers?.shutdownNow()
    workers = null
    acceptThread = null
  }

  private fun acceptConnections(socket: ServerSocket, pool: ThreadPoolExecutor) {
    try {
      while (!socket.isClosed) {
        val client = socket.accept()
        // 与 stop 互斥登记，避免停止时遗漏刚 accept 的连接或队列中的请求。
        synchronized(this) {
          if (socket.isClosed || pool.isShutdown) {
            client.close()
          } else {
            clients.add(client)
            try {
              pool.execute {
                try {
                  client.use {
                    it.soTimeout = 15_000
                    it.tcpNoDelay = true
                    serve(it)
                  }
                } catch (_: IOException) {
                  // WebView 取消请求、读取超时或服务停止时直接释放连接。
                } finally {
                  clients.remove(client)
                }
              }
            } catch (_: RejectedExecutionException) {
              clients.remove(client)
              client.close()
            }
          }
        }
      }
    } catch (_: IOException) {
      // 关闭监听 socket 会中断 accept。
    } finally {
      runCatching { socket.close() }
    }
  }

  private fun serve(socket: Socket) {
    val output = BufferedOutputStream(socket.getOutputStream())
    var head = false
    try {
      val input = socket.getInputStream().buffered()
      val header = StringBuilder()
      while (!header.endsWith("\r\n\r\n")) {
        val next = input.read()
        if (next < 0) return
        header.append(next.toChar())
        if (header.length > 32 * 1024) throw HttpFailure(431, "Request Header Fields Too Large")
      }
      val lines = header.toString().split("\r\n")
      val request = lines[0].split(' ')
      if (request.size != 3 || request[2] !in listOf("HTTP/1.0", "HTTP/1.1")) {
        throw HttpFailure(400, "Bad Request")
      }
      head = request[0] == "HEAD"
      if (request[0] != "GET" && !head) throw HttpFailure(405, "Method Not Allowed")
      val rawPath = request[1].substringBefore('?')
      val path = try {
        URLDecoder.decode(rawPath.replace("+", "%2B"), "UTF-8")
      } catch (_: IllegalArgumentException) {
        throw HttpFailure(400, "Bad Request")
      }
      if (!path.startsWith('/') || path.contains('\\') || path.contains('\u0000') || path.split('/').contains("..")) {
        throw HttpFailure(403, "Forbidden")
      }
      val headers = lines.drop(1).mapNotNull { line ->
        val separator = line.indexOf(':')
        if (separator < 1) null else line.substring(0, separator).lowercase(Locale.ROOT) to line.substring(separator + 1).trim()
      }.toMap()
      var assetPath = path.trimStart('/').let { if (it.isEmpty() || it.endsWith('/')) it + "index.html" else it }
      val asset = try {
        openAsset(assetPath)
      } catch (_: IOException) {
        // 业务路由回退到入口；缺失的脚本、图片等资源仍返回 404。
        if (path.substringAfterLast('/').contains('.')) throw HttpFailure(404, "Not Found")
        assetPath = "index.html"
        try { openAsset(assetPath) } catch (_: IOException) { throw HttpFailure(404, "Not Found") }
      }
      asset.stream.use { stream ->
        val length = asset.length
        val range = if (length != null && headers["range"] != null) parseRange(headers.getValue("range"), length) else null
        val count = if (range != null) range.last - range.first + 1 else length
        val responseHeaders = linkedMapOf(
          "Content-Type" to mime(assetPath),
          "Cache-Control" to "no-cache",
          "Accept-Ranges" to if (length != null) "bytes" else "none"
        )
        if (range != null) responseHeaders["Content-Range"] = "bytes ${range.first}-${range.last}/$length"
        val chunked = count == null && request[2] == "HTTP/1.1"
        if (count != null) responseHeaders["Content-Length"] = count.toString()
        else if (chunked) responseHeaders["Transfer-Encoding"] = "chunked"
        if (!head && range != null) skipFully(stream, range.first)
        writeHeaders(output, if (range == null) 200 else 206, if (range == null) "OK" else "Partial Content", responseHeaders)
        if (!head) {
          val buffer = ByteArray(64 * 1024)
          var remaining = count
          while (remaining == null || remaining > 0) {
            val read = stream.read(buffer, 0, if (remaining == null) buffer.size else minOf(buffer.size.toLong(), remaining).toInt())
            if (read < 0) break
            if (read == 0) continue
            if (chunked) output.write("${read.toString(16)}\r\n".toByteArray(Charsets.US_ASCII))
            output.write(buffer, 0, read)
            if (chunked) output.write("\r\n".toByteArray(Charsets.US_ASCII))
            remaining = remaining?.minus(read)
          }
          if (chunked) output.write("0\r\n\r\n".toByteArray(Charsets.US_ASCII))
        }
      }
    } catch (error: HttpFailure) {
      val body = "${error.status} ${error.message}\n".toByteArray(Charsets.UTF_8)
      val headers = mutableMapOf("Content-Type" to "text/plain; charset=utf-8", "Content-Length" to body.size.toString())
      if (error.status == 405) headers["Allow"] = "GET, HEAD"
      error.contentRange?.let { headers["Content-Range"] = it }
      writeHeaders(output, error.status, error.message.orEmpty(), headers)
      if (!head) output.write(body)
    }
    output.flush()
  }

  private fun parseRange(header: String, size: Long): LongRange {
    fun invalid(): Nothing = throw HttpFailure(416, "Range Not Satisfiable", "bytes */$size")
    val match = Regex("bytes=(\\d*)-(\\d*)").matchEntire(header) ?: invalid()
    if (size <= 0) invalid()
    val (first, last) = match.destructured
    val start: Long
    val end: Long
    if (first.isEmpty()) {
      val suffix = last.toLongOrNull()?.takeIf { it > 0 } ?: invalid()
      start = (size - suffix).coerceAtLeast(0)
      end = size - 1
    } else {
      start = first.toLongOrNull() ?: invalid()
      end = if (last.isEmpty()) size - 1 else (last.toLongOrNull() ?: invalid()).coerceAtMost(size - 1)
    }
    if (start >= size || start > end) invalid()
    return start..end
  }

  private fun skipFully(stream: InputStream, count: Long) {
    var remaining = count
    while (remaining > 0) {
      val skipped = stream.skip(remaining)
      if (skipped > 0) remaining -= skipped
      else if (stream.read() >= 0) remaining--
      else throw IOException("资源提前结束")
    }
  }

  private fun writeHeaders(output: OutputStream, status: Int, reason: String, headers: Map<String, String>) {
    output.write(buildString {
      append("HTTP/1.1 $status $reason\r\nConnection: close\r\n")
      headers.forEach { (name, value) -> append("$name: $value\r\n") }
      append("\r\n")
    }.toByteArray(Charsets.US_ASCII))
  }

  private fun mime(path: String): String {
    val extension = path.substringAfterLast('.', "").lowercase(Locale.ROOT)
    return when (extension) {
      "html", "htm" -> "text/html; charset=utf-8"
      "js", "mjs", "cjs" -> "application/javascript; charset=utf-8"
      "css" -> "text/css; charset=utf-8"
      "json", "map" -> "application/json; charset=utf-8"
      "svg" -> "image/svg+xml"
      "wasm" -> "application/wasm"
      "woff" -> "font/woff"
      "woff2" -> "font/woff2"
      "webmanifest" -> "application/manifest+json"
      else -> lookupMime(extension) ?: "application/octet-stream"
    }
  }

  private class HttpFailure(val status: Int, message: String, val contentRange: String? = null) : Exception(message)
}

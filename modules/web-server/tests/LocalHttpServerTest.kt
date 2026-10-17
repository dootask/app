package expo.modules.webserver

import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/** 用 kotlinc 与 JRE 运行，不依赖 Android SDK 或额外测试库。 */
fun main() {
  val large = ByteArray(4 * 1024 * 1024) { (it % 251).toByte() }
  val files = mapOf(
    "index.html" to "<title>DooTask local</title>".toByteArray(),
    "app.js" to "const app = true;".toByteArray(),
    "a+b.txt" to "plus".toByteArray(),
    "你好.txt" to "utf8".toByteArray(),
    "large.bin" to large,
    "compressed.bin" to large,
    "empty.bin" to byteArrayOf()
  )
  val server = LocalHttpServer({ path ->
    val data = files[path] ?: throw FileNotFoundException(path)
    WebAsset(ByteArrayInputStream(data), if (path == "compressed.bin") null else data.size.toLong())
  })
  val port = ServerSocket(0).use { it.localPort }
  fun request(path: String, method: String = "GET", extra: String = ""): Pair<String, ByteArray> {
    val response = Socket("127.0.0.1", port).use { socket ->
      socket.soTimeout = 5000
      socket.getOutputStream().write("$method $path HTTP/1.1\r\nHost: localhost\r\n$extra\r\n".toByteArray())
      socket.getInputStream().readBytes()
    }
    val text = response.toString(Charsets.ISO_8859_1)
    val end = text.indexOf("\r\n\r\n")
    check(end >= 0) { "HTTP 响应缺少头部: $text" }
    return text.substring(0, end) to response.copyOfRange(end + 4, response.size)
  }
  fun checkResponse(path: String, status: Int, method: String = "GET", extra: String = ""): Pair<String, ByteArray> {
    val response = request(path, method, extra)
    check(response.first.startsWith("HTTP/1.1 $status ")) { "$path: ${response.first}" }
    return response
  }
  try {
    server.start(port)
    check(server.isRunning())
    server.start(port)
    check(checkResponse("/", 200).second.contentEquals(files.getValue("index.html")))
    check(checkResponse("/tasks/123?filter=open", 200).first.contains("Content-Type: text/html"))
    check(checkResponse("/app.js", 200).first.contains("application/javascript"))
    checkResponse("/missing.js", 404)
    checkResponse("/%2e%2e/secret", 403)
    checkResponse("/%00", 403)
    checkResponse("/%zz", 400)
    checkResponse("/", 405, "POST")
    check(checkResponse("/a+b.txt", 200).second.toString(Charsets.UTF_8) == "plus")
    check(checkResponse("/%E4%BD%A0%E5%A5%BD.txt", 200).second.toString(Charsets.UTF_8) == "utf8")
    val head = checkResponse("/large.bin", 200, "HEAD")
    check(head.first.contains("Content-Length: ${large.size}"))
    check(head.second.isEmpty())
    check(checkResponse("/large.bin", 200).second.contentEquals(large))
    val range = checkResponse("/large.bin", 206, extra = "Range: bytes=10-29\r\n")
    check(range.first.contains("Content-Range: bytes 10-29/${large.size}"))
    check(range.second.contentEquals(large.copyOfRange(10, 30)))
    check(checkResponse("/large.bin", 206, extra = "Range: bytes=-17\r\n").second.contentEquals(large.takeLast(17).toByteArray()))
    check(checkResponse("/large.bin", 206, extra = "Range: bytes=${large.size - 10}-\r\n").second.size == 10)
    check(checkResponse("/large.bin", 416, extra = "Range: bytes=${large.size}-\r\n").first.contains("bytes */${large.size}"))
    checkResponse("/large.bin", 416, extra = "Range: bytes=8-2\r\n")
    checkResponse("/empty.bin", 416, extra = "Range: bytes=0-0\r\n")
    check(checkResponse("/empty.bin", 200).second.isEmpty())
    val compressed = checkResponse("/compressed.bin", 200, extra = "Range: bytes=0-9\r\n")
    check(compressed.first.contains("Transfer-Encoding: chunked"))
    val chunks = ByteArrayInputStream(compressed.second)
    val unchunked = java.io.ByteArrayOutputStream()
    fun line(): String {
      val result = StringBuilder()
      while (true) {
        val next = chunks.read()
        check(next >= 0)
        if (next == 13) { check(chunks.read() == 10); return result.toString() }
        result.append(next.toChar())
      }
    }
    while (true) {
      val size = line().toInt(16)
      if (size == 0) { check(line().isEmpty()); break }
      unchunked.write(chunks.readNBytes(size))
      check(line().isEmpty())
    }
    check(unchunked.toByteArray().contentEquals(large))
    val pool = Executors.newFixedThreadPool(16)
    try {
      pool.invokeAll((1..32).map { Callable { checkResponse("/app.js", 200) } }).forEach { it.get() }
    } finally { pool.shutdownNow() }
    server.stop()
    check(!server.isRunning())
    server.start(port)
    checkResponse("/", 200)
    println("HTTP 验证通过：入口回退、MIME、路径校验、HEAD、Range、4 MiB 分块流、32 个并发请求、停止及重启")
  } finally { server.stop() }
}

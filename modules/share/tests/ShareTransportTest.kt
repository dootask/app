package expo.modules.dootaskshare

import com.sun.net.httpserver.HttpServer
import org.json.JSONObject
import java.io.File
import java.net.InetSocketAddress
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicReference

private fun verifyCaches() {
  val values = mutableMapOf("eeuiCaches" to "{\"existing\":{\"existing\":\"keep\",\"expired\":0}}")
  val editor = java.lang.reflect.Proxy.newProxyInstance(
    android.content.SharedPreferences.Editor::class.java.classLoader,
    arrayOf(android.content.SharedPreferences.Editor::class.java)
  ) { instance, method, args ->
    when (method.name) {
      "putString" -> { values[args[0] as String] = args[1] as String; instance }
      "commit" -> true
      else -> error("测试中不应调用 ${method.name}")
    }
  } as android.content.SharedPreferences.Editor
  val preferences = java.lang.reflect.Proxy.newProxyInstance(
    android.content.SharedPreferences::class.java.classLoader,
    arrayOf(android.content.SharedPreferences::class.java)
  ) { _, method, args ->
    when (method.name) {
      "getString" -> values[args[0]] ?: args[1]
      "edit" -> editor
      else -> error("测试中不应调用 ${method.name}")
    }
  } as android.content.SharedPreferences
  val context = object : android.content.ContextWrapper(null) {
    override fun getSharedPreferences(name: String, mode: Int): android.content.SharedPreferences {
      check(name == "eeuiCaches" && mode == android.content.Context.MODE_PRIVATE)
      return preferences
    }
  }
  ShareSettings.write(context, mapOf("chatList" to "https://example.test?token=中文", "language" to "zh-Hans", "unknown" to "ignored"))
  val caches = JSONObject(values.getValue("eeuiCaches"))
  check(caches.getJSONObject("existing").getString("existing") == "keep")
  check(caches.getJSONObject("chatList").getString("chatList") == "https://example.test?token=中文")
  check(caches.getJSONObject("chatList").getInt("expired") == 0)
  check(!caches.has("unknown"))
  check(ShareSettings.read(context, "language") == "zh-Hans")
  ShareSettings.write(context, mapOf("chatList" to ""))
  check(ShareSettings.read(context, "chatList") == "")
  values["eeuiCaches"] = "{\"language\":{\"language\":\"ja\",\"expired\":1}}"
  check(ShareSettings.read(context, "language") == "")
  println("PASS eeuiCaches 旧键/条目结构、保留无关缓存、永久值、退出清空和过期读取")
}

/** 宿主网络回归：实际 HTTP 服务接收 multipart，验证字节、字段以及服务端失败判定。 */
fun main() {
  val captured = AtomicReference<ByteArray>()
  val contentType = AtomicReference<String>()
  val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
  for ((route, response) in mapOf("/ok" to "{\"ret\":1}", "/fail" to "{\"ret\":0,\"msg\":\"denied\"}")) {
    server.createContext(route) { request ->
      captured.set(request.requestBody.use { it.readBytes() })
      contentType.set(request.requestHeaders.getFirst("Content-Type"))
      val bytes = response.toByteArray()
      request.sendResponseHeaders(200, bytes.size.toLong())
      request.responseBody.use { it.write(bytes) }
    }
  }
  server.createContext("/error") { request -> request.sendResponseHeaders(500, -1); request.close() }
  server.start()
  val directory = Files.createTempDirectory("dootask-share-test").toFile()
  val client = ShareTransport()
  try {
    verifyCaches()
    val origin = "http://127.0.0.1:${server.address.port}"
    val payload = File(directory, "测试 file.txt")
    val bytes = ByteArray(4 * 1024 * 1024) { (it % 127).toByte() }
    payload.writeBytes(bytes)
    check(SharePayload.restore(SharePayload(file = payload).json(), directory).file == payload.canonicalFile)
    check(SharePayload.restore(SharePayload(text = "文本").json(), directory).text == "文本")
    val outside = File.createTempFile("outside-share-", ".txt")
    try { check(runCatching { SharePayload.restore(SharePayload(file = outside).json(), directory) }.isFailure) }
    finally { outside.delete() }
    println("PASS 分享附件恢复及缓存目录边界")
    val progress = mutableListOf<Int>()
    client.upload("$origin/ok", SharePayload(file = payload, mime = "text/plain"), mapOf("token" to "a+b&中", "dialog_ids" to "12,34")) { progress.add(it) }
    val body = captured.get()
    val wire = body.toString(Charsets.ISO_8859_1)
    val fileStart = wire.indexOf("Content-Type: text/plain\r\n\r\n") + "Content-Type: text/plain\r\n\r\n".length
    check(body.copyOfRange(fileStart, fileStart + bytes.size).contentEquals(bytes))
    check(wire.contains("name=\"files\""))
    check(body.toString(Charsets.UTF_8).contains("name=\"dialog_ids\"\r\n\r\n12,34"))
    check(body.toString(Charsets.UTF_8).contains("name=\"token\"\r\n\r\na+b&中"))
    check(contentType.get().startsWith("multipart/form-data; boundary=DooTask-"))
    check(progress.last() == 100 && progress == progress.sorted())
    println("PASS 文件流式 multipart：4 MiB 内容、中文文件名、token、会话多选字段和成功进度")

    client.upload("$origin/ok", SharePayload(text = "分享正文\nhttps://example.test"), mapOf("token" to "x", "upload_file_id" to "0")) {}
    val textWire = captured.get().toString(Charsets.UTF_8)
    check(textWire.contains("name=\"text\"\r\n\r\n分享正文\nhttps://example.test"))
    check(textWire.contains("name=\"upload_file_id\"\r\n\r\n0"))
    check(!textWire.contains("filename="))
    println("PASS 文本 multipart 与根目录 ID 0")

    progress.clear()
    val failure = runCatching { client.upload("$origin/fail", SharePayload(text = "failure"), emptyMap()) { progress.add(it) } }.exceptionOrNull()
    check(failure is ShareException && failure.serverMessage == "denied")
    check(100 !in progress)
    check(runCatching { client.upload("$origin/error", SharePayload(text = "failure"), emptyMap()) {} }.isFailure)
    println("PASS ret=0 和 HTTP 500 不计为上传成功")

    val url = ShareTransport.url("$origin/ok?pid=3&token=a%2Bb&tag=a&tag=b", mapOf("token" to "新+token", "key" to "a b&c"))
    val parsed = android.net.Uri.parse(url)
    check(parsed.getQueryParameter("pid") == "3")
    check(parsed.getQueryParameter("token") == "新+token")
    check(parsed.getQueryParameter("key") == "a b&c")
    check(parsed.getQueryParameters("tag") == listOf("a", "b"))
    check(runCatching { ShareTransport.url("file:///private", emptyMap()) }.isFailure)
    println("PASS 目录 pid、查询参数编码、token 替换和 URL 协议限制")

    server.createContext("/list") { request ->
      val result = "{\"ret\":1,\"data\":[{\"name\":\"会话\",\"type\":\"item\",\"url\":\"$origin/ok\",\"extend\":{\"dialog_ids\":42}}]}".toByteArray()
      request.sendResponseHeaders(200, result.size.toLong())
      request.responseBody.use { it.write(result) }
    }
    val rows = client.list("$origin/list")
    check(rows.single().dialogID == "42" && rows.single().name == "会话")
    val folder = ShareDestination(JSONObject("{\"type\":\"children\",\"extend\":{\"upload_file_id\":0}}"))
    check(folder.isFolder && folder.folderID == "0")
    println("PASS 列表响应、会话 ID 和目录类型解码")

    client.close()
    check(runCatching { client.upload("$origin/ok", SharePayload(text = "closed"), emptyMap()) {} }.isFailure)
    println("PASS 关闭后禁止启动请求")
  } finally {
    client.close()
    server.stop(0)
    directory.deleteRecursively()
  }
}

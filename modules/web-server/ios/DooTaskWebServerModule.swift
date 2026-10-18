import ExpoModulesCore
import Foundation
import Network
import UniformTypeIdentifiers

public class DooTaskWebServerModule: Module {
  private let server = LocalWebServer()

  public func definition() -> ModuleDefinition {
    Name("DooTaskWebServer")

    AsyncFunction("start") { (port: Int, promise: Promise) in
      self.server.start(port: port, promise: promise)
    }
    AsyncFunction("stop") { (promise: Promise) in
      self.server.stop(promise: promise)
    }
    AsyncFunction("isRunning") { (promise: Promise) in
      self.server.isRunning(promise: promise)
    }
    OnDestroy {
      self.server.stop()
    }
  }
}

/** 所有监听器及连接状态均在同一串行队列维护，网络发送异步交错执行。 */
private final class LocalWebServer {
  private let queue = DispatchQueue(label: "com.dootask.web-server", qos: .userInitiated)
  private var listener: NWListener?
  private var running = false
  private var port = 0
  private var pending: [Promise] = []
  private var startupTimeout: DispatchWorkItem?
  private var clients: [UUID: HTTPClient] = [:]

  func start(port: Int, promise: Promise) {
    queue.async {
      guard (1...65535).contains(port), let networkPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
        promise.reject("ERR_WEB_PORT", "端口必须在 1 到 65535 之间")
        return
      }
      if self.listener != nil && self.port == port {
        if self.running {
          promise.resolve(["port": port])
          return
        }
        if !self.pending.isEmpty {
          self.pending.append(promise)
          return
        }
      }
      self.stopOnQueue()
      guard let root = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true),
        FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
        promise.reject("ERR_WEB_ASSETS", "Bundle 中缺少 web/index.html，请检查资源插件")
        return
      }
      do {
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: networkPort)
        // 端口已由 requiredLocalEndpoint 指定；再传 on: 会报 "cannot override" 导致监听永远起不来
        let candidate = try NWListener(using: parameters)
        self.listener = candidate
        self.port = port
        self.pending = [promise]
        candidate.stateUpdateHandler = { [weak self, weak candidate] state in
          guard let self = self, let candidate = candidate, self.listener === candidate else { return }
          switch state {
          case .ready:
            self.running = true
            self.startupTimeout?.cancel()
            self.startupTimeout = nil
            let promises = self.pending
            self.pending.removeAll()
            promises.forEach { $0.resolve(["port": port]) }
          case .failed(let error):
            self.stopOnQueue(reason: error.localizedDescription)
          case .cancelled:
            self.stopOnQueue()
          case .waiting:
            self.running = false
          default:
            break
          }
        }
        candidate.newConnectionHandler = { [weak self, weak candidate] connection in
          guard let self = self, let candidate = candidate,
            self.listener === candidate, self.running, self.clients.count < 32 else {
            connection.cancel()
            return
          }
          let id = UUID()
          let client = HTTPClient(connection: connection, root: root, queue: self.queue) { [weak self] in
            self?.clients.removeValue(forKey: id)
          }
          self.clients[id] = client
          client.start()
        }
        let timeout = DispatchWorkItem { [weak self, weak candidate] in
          guard let self = self, let candidate = candidate, self.listener === candidate, !self.running else { return }
          self.stopOnQueue(reason: "本地 Web 服务启动超时")
        }
        self.startupTimeout = timeout
        self.queue.asyncAfter(deadline: .now() + 5, execute: timeout)
        candidate.start(queue: self.queue)
      } catch {
        promise.reject(error)
      }
    }
  }

  func stop(promise: Promise? = nil) {
    queue.async {
      self.stopOnQueue()
      promise?.resolve(nil)
    }
  }

  func isRunning(promise: Promise) {
    queue.async { promise.resolve(self.running) }
  }

  private func stopOnQueue(reason: String = "本地 Web 服务已停止") {
    running = false
    port = 0
    startupTimeout?.cancel()
    startupTimeout = nil
    listener?.stateUpdateHandler = nil
    listener?.newConnectionHandler = nil
    listener?.cancel()
    listener = nil
    let promises = pending
    pending.removeAll()
    promises.forEach { $0.reject("ERR_WEB_SERVER", reason) }
    Array(clients.values).forEach { $0.close() }
    clients.removeAll()
  }
}

private final class HTTPClient {
  private let connection: NWConnection
  private let root: URL
  private let queue: DispatchQueue
  private let onClose: () -> Void
  private var header = Data()
  private var file: FileHandle?
  private var remaining: Int64 = 0
  private var closed = false
  private var timeout: DispatchWorkItem?

  init(connection: NWConnection, root: URL, queue: DispatchQueue, onClose: @escaping () -> Void) {
    self.connection = connection
    self.root = root.resolvingSymlinksInPath().standardizedFileURL
    self.queue = queue
    self.onClose = onClose
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled: self?.close()
      default: break
      }
    }
    connection.start(queue: queue)
    receiveHeader()
  }

  func close() {
    guard !closed else { return }
    closed = true
    timeout?.cancel()
    timeout = nil
    try? file?.close()
    file = nil
    connection.stateUpdateHandler = nil
    connection.cancel()
    onClose()
  }

  private func refreshTimeout() {
    timeout?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.close() }
    timeout = work
    queue.asyncAfter(deadline: .now() + 30, execute: work)
  }

  private func receiveHeader() {
    refreshTimeout()
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
      guard let self = self, !self.closed else { return }
      if let data = data { self.header.append(data) }
      guard self.header.count <= 32 * 1024 else {
        self.respond(status: 431, reason: "Request Header Fields Too Large")
        return
      }
      if let end = self.header.range(of: Data("\r\n\r\n".utf8)),
        let text = String(data: self.header[..<end.lowerBound], encoding: .utf8) {
        self.serve(text)
      } else if complete || error != nil {
        self.close()
      } else {
        self.receiveHeader()
      }
    }
  }

  private func serve(_ text: String) {
    let lines = text.components(separatedBy: "\r\n")
    let request = (lines.first ?? "").split(separator: " ").map(String.init)
    guard request.count == 3, ["HTTP/1.0", "HTTP/1.1"].contains(request[2]) else {
      respond(status: 400, reason: "Bad Request")
      return
    }
    let head = request[0] == "HEAD"
    guard request[0] == "GET" || head else {
      respond(status: 405, reason: "Method Not Allowed", headers: ["Allow": "GET, HEAD"])
      return
    }
    let rawPath = String(request[1].split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
    guard let path = rawPath.removingPercentEncoding else {
      respond(status: 400, reason: "Bad Request", head: head)
      return
    }
    guard path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"), !path.split(separator: "/").contains("..") else {
      respond(status: 403, reason: "Forbidden", head: head)
      return
    }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      guard let separator = line.firstIndex(of: ":") else { continue }
      headers[String(line[..<separator]).lowercased()] = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
    }
    var url = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL.resolvingSymlinksInPath()
    guard url.path == root.path || url.path.hasPrefix(root.path + "/") else {
      respond(status: 403, reason: "Forbidden", head: head)
      return
    }
    var info = try? url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .fileSizeKey])
    if info?.isDirectory == true {
      url.appendPathComponent("index.html")
      info = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    }
    if info?.isRegularFile != true, (path as NSString).pathExtension.isEmpty {
      url = root.appendingPathComponent("index.html")
      info = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    }
    guard info?.isRegularFile == true, let fileSize = info?.fileSize else {
      respond(status: 404, reason: "Not Found", head: head)
      return
    }
    let size = Int64(fileSize)
    var start: Int64 = 0
    var end = size - 1
    var partial = false
    if let range = headers["range"] {
      guard let interval = parseRange(range, size: size) else {
        respond(status: 416, reason: "Range Not Satisfiable", headers: ["Content-Range": "bytes */\(size)"], head: head)
        return
      }
      start = interval.lowerBound
      end = interval.upperBound
      partial = true
    }
    remaining = size == 0 ? 0 : end - start + 1
    var responseHeaders = [
      "Content-Type": mime(url.pathExtension),
      "Content-Length": String(remaining),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache"
    ]
    if partial { responseHeaders["Content-Range"] = "bytes \(start)-\(end)/\(size)" }
    do {
      if !head {
        file = try FileHandle(forReadingFrom: url)
        try file?.seek(toOffset: UInt64(start))
      }
      send(makeHeaders(status: partial ? 206 : 200, reason: partial ? "Partial Content" : "OK", headers: responseHeaders)) {
        if head { self.close() } else { self.sendFileChunk() }
      }
    } catch {
      respond(status: 500, reason: "Internal Server Error", head: head)
    }
  }

  private func parseRange(_ header: String, size: Int64) -> ClosedRange<Int64>? {
    guard header.hasPrefix("bytes="), size > 0 else { return nil }
    let values = header.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
    guard values.count == 2, values.allSatisfy({ $0.allSatisfy({ $0.isASCII && $0.isNumber }) }) else { return nil }
    if values[0].isEmpty {
      guard let suffix = Int64(values[1]), suffix > 0 else { return nil }
      return max(0, size - suffix)...(size - 1)
    }
    guard let start = Int64(values[0]), start >= 0, start < size else { return nil }
    let end: Int64
    if values[1].isEmpty { end = size - 1 }
    else if let last = Int64(values[1]) { end = min(last, size - 1) }
    else { return nil }
    return end >= start ? start...end : nil
  }

  private func sendFileChunk() {
    guard !closed, remaining > 0, let file = file else { close(); return }
    do {
      guard let chunk = try file.read(upToCount: Int(min(remaining, 64 * 1024))), !chunk.isEmpty else { close(); return }
      remaining -= Int64(chunk.count)
      send(chunk) { self.sendFileChunk() }
    } catch { close() }
  }

  private func respond(status: Int, reason: String, headers: [String: String] = [:], head: Bool = false) {
    let body = Data("\(status) \(reason)\n".utf8)
    var fields = headers
    fields["Content-Type"] = "text/plain; charset=utf-8"
    fields["Content-Length"] = String(body.count)
    var data = makeHeaders(status: status, reason: reason, headers: fields)
    if !head { data.append(body) }
    send(data) { self.close() }
  }

  private func makeHeaders(status: Int, reason: String, headers: [String: String]) -> Data {
    let fields = headers.map { "\($0.key): \($0.value)\r\n" }.joined()
    return Data("HTTP/1.1 \(status) \(reason)\r\nConnection: close\r\n\(fields)\r\n".utf8)
  }

  private func send(_ data: Data, completion: @escaping () -> Void) {
    guard !closed else { return }
    refreshTimeout()
    connection.send(content: data, completion: .contentProcessed { [weak self] error in
      guard let self = self, !self.closed else { return }
      if error != nil { self.close() } else { completion() }
    })
  }

  private func mime(_ extensionName: String) -> String {
    switch extensionName.lowercased() {
    case "html", "htm": return "text/html; charset=utf-8"
    case "js", "mjs", "cjs": return "application/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "map": return "application/json; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "wasm": return "application/wasm"
    case "woff": return "font/woff"
    case "woff2": return "font/woff2"
    case "webmanifest": return "application/manifest+json"
    default: return UTType(filenameExtension: extensionName)?.preferredMIMEType ?? "application/octet-stream"
    }
  }
}

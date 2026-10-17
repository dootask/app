import Foundation
import UniformTypeIdentifiers

enum ShareFailure: Error {
  case localized(String)
  case server(String)
}

struct ShareDestination {
  let name: String
  let icon: String
  let type: String
  let url: String
  let dialogID: String
  let folderID: String

  init?(_ value: [String: Any]) {
    guard let name = value["name"] as? String, let url = value["url"] as? String else { return nil }
    let extra = value["extend"] as? [String: Any] ?? [:]
    self.name = name
    self.url = url
    self.icon = value["icon"] as? String ?? ""
    self.type = value["type"] as? String ?? "item"
    self.dialogID = extra["dialog_ids"].map { String(describing: $0) } ?? ""
    self.folderID = extra["upload_file_id"].map { String(describing: $0) } ?? "0"
  }
}

enum ShareAttachment {
  case text(String)
  case file(URL)

  var isFile: Bool {
    if case .file = self { return true }
    return false
  }
}

/// 使用独立 URLSession，不加载 React Native，也不依赖主 App 的启动状态。
final class ShareTransport: NSObject, URLSessionTaskDelegate {
  var onProgress: ((Double) -> Void)?
  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 60
    configuration.timeoutIntervalForResource = 3600
    return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
  }()

  func cancel() { session.invalidateAndCancel() }

  static func url(_ value: String, parameters: [String: String]) throws -> URL {
    guard var components = URLComponents(string: value),
          ["https", "http"].contains(components.scheme?.lowercased() ?? ""), components.host != nil else {
      throw ShareFailure.localized("unLoginTitle")
    }
    let names = Set(parameters.keys)
    components.queryItems = (components.queryItems ?? []).filter { !names.contains($0.name) }
      + parameters.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    guard let url = components.url else { throw ShareFailure.localized("unLoginTitle") }
    return url
  }

  private func response(_ data: Data, _ response: URLResponse) throws -> [String: Any] {
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw ShareFailure.localized("netWorkErrorTitle")
    }
    let code = (json["ret"] as? NSNumber)?.intValue ?? Int(json["ret"] as? String ?? "")
    guard code == 1 else {
      throw ShareFailure.server(json["msg"] as? String ?? "")
    }
    return json
  }

  func list(_ url: URL) async throws -> [ShareDestination] {
    let (data, result) = try await session.data(from: url)
    let json = try response(data, result)
    guard let rows = json["data"] as? [[String: Any]] else { throw ShareFailure.localized("netWorkErrorTitle") }
    return rows.compactMap(ShareDestination.init)
  }

  func upload(_ item: ShareAttachment, to url: URL, parameters: [String: String], directory: URL) async throws {
    let boundary = "DooTask-\(UUID().uuidString)"
    let bodyURL = directory.appendingPathComponent("\(UUID().uuidString).multipart")
    defer { try? FileManager.default.removeItem(at: bodyURL) }
    FileManager.default.createFile(atPath: bodyURL.path, contents: nil)
    let handle = try FileHandle(forWritingTo: bodyURL)
    do {
      func write(_ value: String) throws { try handle.write(contentsOf: Data(value.utf8)) }
      for (key, value) in parameters.sorted(by: { $0.key < $1.key }) {
        try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n")
      }
      switch item {
      case .text(let text):
        try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n\(text)\r\n")
      case .file(let file):
        let name = file.lastPathComponent.replacingOccurrences(of: "\"", with: "_")
          .replacingOccurrences(of: "\r", with: "_").replacingOccurrences(of: "\n", with: "_")
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"files\"; filename=\"\(name)\"\r\nContent-Type: \(mime)\r\n\r\n")
        let input = try FileHandle(forReadingFrom: file)
        defer { try? input.close() }
        while let chunk = try input.read(upToCount: 64 * 1024), !chunk.isEmpty {
          try Task.checkCancellation()
          try handle.write(contentsOf: chunk)
        }
        try write("\r\n")
      }
      try write("--\(boundary)--\r\n")
      try handle.close()
    } catch {
      try? handle.close()
      throw error
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    let (data, result) = try await session.upload(for: request, fromFile: bodyURL)
    _ = try response(data, result)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                  totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    if totalBytesExpectedToSend > 0 {
      onProgress?(Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }
  }
}

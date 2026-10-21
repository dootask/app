import Foundation

/// 主 App 和分享扩展共用；保留旧 MMWormhole 的 share/<键>.archive，支持覆盖升级。
enum ShareStorage {
  /// 由 with-share 插件写入 Info.plist（正式版与 dev 变体不同）
  static let appGroup = Bundle.main.object(forInfoDictionaryKey: "DooTaskAppGroup") as? String ?? "group.im.dootask"
  static let keys: Set<String> = ["language", "chatList", "upLoadUrl", "fileUpLoadUrl"]

  private static func sharedDirectory() throws -> URL {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
      throw NSError(domain: "DooTaskShare", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "无法打开分享 App Group，请检查签名和 entitlement"])
    }
    return container.appendingPathComponent("share", isDirectory: true)
  }

  static func read(_ key: String) -> String {
    guard keys.contains(key) else { return "" }
    let defaults = UserDefaults(suiteName: appGroup)
    defaults?.synchronize()
    if let value = defaults?.string(forKey: key) { return value }
    guard let directory = try? sharedDirectory(),
          let data = try? Data(contentsOf: directory.appendingPathComponent("\(key).archive")),
          let value = try? NSKeyedUnarchiver.unarchivedObject(ofClass: NSString.self, from: data) else { return "" }
    return value as String
  }

  static func write(_ settings: [String: String]) throws {
    let directory = try sharedDirectory()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    guard let defaults = UserDefaults(suiteName: appGroup) else { return }
    for (key, value) in settings where keys.contains(key) {
      defaults.set(value, forKey: key)
      let data = try NSKeyedArchiver.archivedData(withRootObject: value as NSString, requiringSecureCoding: false)
      try data.write(to: directory.appendingPathComponent("\(key).archive"), options: .atomic)
    }
    defaults.synchronize()
  }
}

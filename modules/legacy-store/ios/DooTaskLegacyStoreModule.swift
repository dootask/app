import ExpoModulesCore
import Foundation

public class DooTaskLegacyStoreModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DooTaskLegacyStore")

    AsyncFunction("readCaches") { () throws -> String in
      // eeuiStorageManager 使用标准偏好中的 storage_caches 字典，不能读取 App Group 替代。
      let caches = UserDefaults.standard.dictionary(forKey: "storage_caches") ?? [:]
      let data = try JSONSerialization.data(withJSONObject: caches)
      guard let json = String(data: data, encoding: .utf8) else {
        throw NSError(domain: "DooTaskLegacyStore", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "旧缓存无法转换为 UTF-8"])
      }
      return json
    }

    // iOS 不允许程序主动退到桌面，与旧壳的空实现保持一致。
    AsyncFunction("moveTaskToBack") { () -> Void in }
  }
}

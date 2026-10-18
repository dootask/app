import ExpoModulesCore
import Foundation
import UIKit

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

    AsyncFunction("setShakeToEditEnabled") { (enabled: Bool) -> Void in
      UIApplication.shared.applicationSupportsShakeToEdit = enabled
    }.runOnQueue(.main)

    AsyncFunction("isFullscreen") { () -> Bool in
      self.isCurrentWindowFullscreen()
    }.runOnQueue(.main)
  }

  private func isCurrentWindowFullscreen() -> Bool {
    let application = UIApplication.shared
    var window: UIWindow?
    // 与旧 DeviceUtil 一致：优先前台场景的 keyWindow，其次可见窗口。
    for case let scene as UIWindowScene in application.connectedScenes
    where scene.activationState == .foregroundActive {
      window = scene.windows.first { !$0.isHidden && $0.isKeyWindow }
        ?? scene.windows.first { !$0.isHidden }
      if window != nil { break }
    }
    window = window ?? application.keyWindow
      ?? application.windows.reversed().first { !$0.isHidden }
      ?? application.windows.last
    guard let window else { return true }

    let windowBounds: CGRect
    let screenBounds: CGRect
    if let scene = window.windowScene {
      windowBounds = scene.coordinateSpace.bounds.standardized
      screenBounds = scene.screen.coordinateSpace.bounds.standardized
    } else {
      windowBounds = window.convert(window.bounds, to: window.screen.coordinateSpace).standardized
      screenBounds = window.screen.coordinateSpace.bounds.standardized
    }
    // 旧壳比较原点和宽高，允许 0.5 point 误差，与状态栏是否隐藏无关。
    let tolerance: CGFloat = 0.5
    return abs(windowBounds.origin.x - screenBounds.origin.x) <= tolerance
      && abs(windowBounds.origin.y - screenBounds.origin.y) <= tolerance
      && abs(windowBounds.width - screenBounds.width) <= tolerance
      && abs(windowBounds.height - screenBounds.height) <= tolerance
  }
}

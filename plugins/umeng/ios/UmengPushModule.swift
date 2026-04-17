import Foundation
import React

/// Stub wrapper that mirrors the UMeng Push API the Vue layer expects.
///
/// Currently each method resolves with `nil` so the app compiles without the UMeng SDK.
/// To enable real push:
///   1. Add `pod 'UMCommon'`, `pod 'UMDevice'`, `pod 'UMPush'` via plugins/withUmengPush.js.
///   2. Import `UMCommon` + `UMPush` below.
///   3. Call `UMConfigure.initWithAppkey(...)` and `UMessage.start(...)`.
///   4. Register APNs via `UMessage.register(forRemoteNotifications:withAppKey:)`.
@objc(UmengPushModule)
class UmengPushModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func initPush(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // TODO(UMeng):
    // UMConfigure.initWithAppkey(appKey, channel: "expo")
    // UMConfigure.setLogEnabled(false)
    // let entity = UMessageRegisterEntity()
    // entity.types = Int(UMessageAuthorizationOptionBadge.rawValue
    //   | UMessageAuthorizationOptionSound.rawValue
    //   | UMessageAuthorizationOptionAlert.rawValue)
    // UNUserNotificationCenter.current().delegate = self
    // UMessage.register(forRemoteNotifications: entity, withAppKey: appKey) { ... }
    NSLog("[UmengPush] initPush stub — wire UMeng SDK to enable push")
    resolve(nil)
  }

  @objc func setAlias(
    _ alias: String,
    type: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // TODO(UMeng): UMessage.addAlias(alias, type: type) { ... }
    NSLog("[UmengPush] setAlias stub: %@=%@", type, alias)
    resolve(nil)
  }

  @objc func removeAlias(
    _ alias: String,
    type: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // TODO(UMeng): UMessage.removeAlias(alias, type: type) { ... }
    NSLog("[UmengPush] removeAlias stub: %@=%@", type, alias)
    resolve(nil)
  }

  @objc func getDeviceToken(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // TODO(UMeng): resolve(UMessage.deviceToken())
    resolve(nil)
  }
}

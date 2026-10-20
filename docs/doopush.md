# 二期：DooPush 推送接入

替换旧 eeui 壳的友盟推送。新壳（Expo）走 DooPush，旧 eeui 壳用户继续走友盟，两个通道在后端并存，直到旧版基本升级完。

## 凭证

| 凭证 | 放在哪 | 说明 |
|---|---|---|
| App ID / App Key（`dp_ak_`） | App 端 `src/config.ts` | 客户端凭证，只能注册设备，随安装包分发（等同旧版写在 eeui.config.js 的友盟 appkey） |
| App Secret（`dp_as_`，仅 `push:send`） | 各服务器「系统设置 → App 推送」 | 服务端发送用，**不进任何仓库/文件** |
| APNs .p8 | DooPush 控制台 | |
| Android 厂商客户端参数 | 仓库 `push/android/`（`vendors.json` + 华为/荣耀 services 文件） | 随 APK 分发，非机密；私有部署可用 `DOOPUSH_VENDORS_FILE` 换成自己的 |
| Android 厂商服务端密钥 | DooPush 控制台 | 不进任何仓库/文件 |
| Android 正式签名 | 构建机 iCloud 云盘 `DooTaskKeys/android/`（`dootask-release.jks` + `signing.env`） | **不进仓库**；`scripts/mac-build.sh` 在 RELEASE 时自动读取 |

## 消息与接口约定

前端不变：登录后约 6 秒发 `setUmengAlias`，退出登录发 `delUmengAlias`（另有 `initApp` 提供 `apiUrl`/`token`/`language`/`userid`/`userAgent`）。

新壳收到 `setUmengAlias`：
1. `DooPush.register()` → `{ token, deviceId, vendor }`（请求通知权限；被拒绝时不上报）
2. 调后端 `POST {apiUrl}push/device`，请求头 `token`、`language`，表单字段：

| 字段 | 说明 |
|---|---|
| `action` | `update`（默认）/ `remove` |
| `device_id` | DooPush 设备 ID（`devices.id` 主键，数字字符串） |
| `vendor` | `apns` / `fcm` / `hms` / `honor` / `xiaomi` / `oppo` / `vivo` / `meizu` |
| `unique_id` | 壳的 `appUniqueId`（旧 eeui 的友盟别名为 `${platform}-${userid}-${uniqueId}`），用于清理该设备的旧友盟别名，避免重复推送 |
| `device_model` / `app_version` / `app_version_name` / `user_agent` / `is_notified` | 同旧友盟上报 |

收到 `delUmengAlias`：调同一接口 `action=remove`，带 `device_id`。

推送载荷：DooPush 的 `payload` 只接受 `action`/`url`/`data` 和厂商参数，其他键会被丢弃，所以业务字段放在 `payload.data`（JSON 字符串，如 `{"dialog_id":"1","msg_id":"2"}`），设备端收到的是顶层的 `data` 键。iOS 点击从 expo-notifications 响应的 `trigger.payload`（完整 userInfo，冷启动也可取）读取；`content.data` 只含 Expo 格式的 `body`，取不到。DooPush 点击事件作为兜底，两路按 `dialog_id:msg_id` 去重。点击通知后壳调用网页 `window.__onNotificationClick({dialog_id, msg_id})`，前端打开对应会话。

## 后端

- 新表 `app_push_devices`：`userid`、`channel`（目前只有 `doopush`）、`device_id`、`vendor`、`platform`、`device_hash`（`UserDevice::check()`）、`device`、`version`、`ua`、`is_notified`、时间戳；`(channel, device_id)` 唯一
- 新控制器 `Api/PushController::device()` → `api/push/device`
- 发送编排 `app/Module/AppPush/`：按通道分发（友盟原逻辑 + DooPush `POST /apps/{appId}/push`，`target.type=devices`）
- 设置 `appPushSetting` 新增 `doopush`（open/close）、`doopush_app_id`、`doopush_app_secret`、`doopush_base_url`

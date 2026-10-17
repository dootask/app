# X2 通知与 Android WebView 加固

日期：2026-10-17。环境：Expo 58.0.14、RN 0.88.0、新架构、react-native-webview 14.0.1、expo-notifications 58.1.5。

本批完成四个通知 action 的自注册、Android 文档起始注入补丁，以及长按振动 / 长按禁选的原生接线。通知入口 import 和 App 配置由集成方应用，见下文。未新增或升级依赖，未操作暂存区、提交、推送或创建分支。

## 改动清单

| 文件 | 改动 |
|---|---|
| `src/features/notifications/index.ts` | 副作用注册 `getNotificationPermission`、`setBdageNotify`、`setBadgeNum`、`clearAllNotify`。只导入本地通知 API，避开包入口的推送自动注册副作用。 |
| `src/bridge/BridgeWebView.tsx` | 订阅当前 PageHandle 的已有 WebView 状态，将两个开关传给 Android 原生 prop；卸载时解除订阅。主页面、二级页和直接使用该组件的自测页均生效。 |
| `src/bridge/modules/webview/index.ts` | 删除原生转发尚未实现的过时注释；沿用已有方法名、布尔参数处理及 page.state。 |
| `patches/react-native-webview+14.0.1.patch` | 通过 `npx patch-package react-native-webview` 生成，包含下述 9 个依赖文件。 |
| `package.json` | scripts 仅新增 `"postinstall": "patch-package"`；依赖声明未变。 |
| `docs/bridge-inventory.md` | 仅更新本批通知、长按开关和注入方式的说明与状态。✅ 表示实现完成，设备验收仍待执行。 |
| `docs/progress.md` | 末尾追加本批进度。 |
| `docs/x2-notify-webview-report.md` | 本报告。 |

补丁涉及的依赖文件：

- `android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java`
- `android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.kt`
- `android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java`
- `android/src/oldarch/com/reactnativecommunity/webview/RNCWebViewManager.java`
- `src/RNCWebViewNativeComponent.ts`
- `src/WebView.android.tsx`
- `src/WebViewTypes.ts`
- `lib/RNCWebViewNativeComponent.d.ts`
- `lib/WebViewTypes.d.ts`

本批未修改 `app.config.ts`、`src/app/**`、`src/native/**`、`modules/**`、媒体目录或桥的其他核心文件。共享工作目录中这些位置的并行任务改动不属于本批。

## 旧源码与调用方依据

下表 `mobile/` 和 `assets/js/` 均相对于主仓库的 `resources/`；本批只读取这些目录。

| 契约 | 旧实现 / 调用方及行号 |
|---|---|
| 通知 action、两个角标别名及拼写 `bdage` | `mobile/src/pages/index.vue:266` 查询权限，`:270` / `:271` 两个角标别名，`:272` 为 `parseInt(message.bdage) || 0`，`:275` 清理通知。 |
| 权限回调为 boolean | `mobile/plugins/eeui/notifications/ios/eeuiNotifications/eeuiNotificationsAppModule.m:142`：未选择 / 拒绝为 false、完整授权为 true；Android `mobile/plugins/eeui/notifications/android/src/main/java/eeui/android/eeuiNotifications/module/eeuiNotificationsAppModule.java:45`：调用 `areNotificationsEnabled()`。 |
| 回传到页面全局函数 | `mobile/src/pages/index.vue:411`，调用 `window.__onNotificationPermissionStatus(ret)`；前端 `assets/js/App.vue:798` 将结果转为 `== 1` 的布尔状态。 |
| iOS 原有授权范围 | `mobile/plugins/eeui/umeng/ios/eeuiUmeng/eeuiUmengManager.m:33`：初始化友盟时请求 Badge、Alert、Sound。 |
| 角标的原生行为 | `mobile/plugins/eeui/umeng/ios/eeuiUmeng/eeuiUmengPushModule.m:99` 设置应用图标角标并同步友盟；Android `mobile/plugins/eeui/umeng/android/src/main/java/app/eeui/umeng/ui/module/eeuiUmengPushModule.java:156` 委托给厂商推送代理。 |
| 清除通知 | iOS `mobile/plugins/eeui/notifications/ios/eeuiNotifications/eeuiNotificationsAppModule.m:133` 取消 pending；Android 模块 `eeuiNotificationsAppModule.java:152` 调用 `utils/NotificationUtils.java:87` 的 `NotificationManager.cancelAll()`。 |
| 长按振动 / 原生禁选 | `mobile/plugins/eeui/framework/android/src/main/java/app/eeui/framework/extend/view/ExtendWebView.java:101` 定义返回禁选状态的长按监听器，`:109` 安装监听器，`:680` 调用 `setHapticFeedbackEnabled`，`:688` 保存禁选开关。 |
| 前端实际调用 | `assets/js/functions/eeui.js:185` / `:190` 两个长按开关，禁选支持定时恢复；`assets/js/components/Mobile/Tabbar.vue:203` 发送角标；`assets/js/pages/manage/messenger.vue:385` 查询权限。前端未检出 `clearAllNotify` / `setBadgeNum` 的其他直接调用，仍保留旧 action。 |

## 通知行为与限制

- `getNotificationPermission` 只调用 `getPermissionsAsync()`，向发起请求的页面回传 boolean，不申请权限。iOS 只有 `AUTHORIZED` 返回 true；未决定、拒绝、临时授权及查询失败均返回 false。旧 iOS 对 provisional / ephemeral 没有回调分支，本实现补齐 false，避免页面等待。Android 使用结果的 `status === 'granted'`，兼顾已安装 SDK 在系统总开关关闭时可能出现 `granted: true`、`status: 'denied'` 的响应。
- 两个角标 action 共用实现，沿用 `parseInt` 和非法值归零；负数归零，过大数字限制到 Android Int 上限。iOS 初次调用且状态为未决定时，请求 Badge / Alert / Sound；这是旧壳初始化时的授权范围，一期将申请时机延后到首次设置角标。已拒绝或已关闭角标时直接结束，不反复弹窗。只有 `allowsBadge` 为 true 才设置角标。
- 同一页面的角标请求按发送顺序执行，避免授权弹窗期间较早的数字覆盖较新的数字。任务只保存在 `page.state`，完成后删除；没有新增全局页面状态或共享缓存。
- Android 使用 Expo 自带的 ShortcutBadger 尽力设置角标，返回 false 时开发环境记录日志；不申请 Android 通知权限，不发布占位通知。Pixel / 部分第三方桌面主要按活动通知显示圆点，无法保证任意数字；厂商、桌面设置和系统版本也会影响结果。
- **expo-notifications 58.1.5 的 Android `setBadgeCountAsync(0)` 会执行 `NotificationManager.cancelAll()`**，因而同时清除通知栏；这来自已安装依赖 `android/src/main/java/expo/modules/notifications/badge/BadgeHelper.kt:15`，没有额外修改它。非零值委托 ShortcutBadger，不保证桌面支持。
- `clearAllNotify` 同时取消待发送的本地通知并清除已展示通知，保留旧 iOS 取消 pending 的行为，补齐通知中心清理；不申请权限、不显式重置角标。iOS 原有角标可由 `{bdage: 0}` 单独清零。
- 没有调用远程 token API、推送注册、通知 channel 创建或服务器同步。通知代码通过 `expo-notifications/build/...` 导入本地子模块，因为包入口会加载 `DevicePushTokenAutoRegistration.fx`，它在存在持久化注册信息时可能获取 token。升级 expo-notifications 时需复核这些已安装版本的子模块路径。

## WebView 补丁说明

### 文档起始脚本

`RNCWebViewManagerImpl.onAfterUpdateTransaction()` 在所有 props 设置完成后、`loadSource()` 前调用注册逻辑，覆盖 URL、HTML 和后续 props 更新，避免依赖 prop 下发顺序。

支持 `WebViewFeature.DOCUMENT_START_SCRIPT` 时，通过 `WebViewCompat.addDocumentStartJavaScript(this, script, Collections.singleton("*"))` 注册。每个 WebView 自己持有 `ScriptHandler` 和已注册脚本文本：脚本、`javaScriptEnabled` 或主框架开关变化时，先移除旧 handler 再按新配置注册；相同配置不重复注册；清空脚本、关闭 JS 或销毁视图时移除 handler。

脚本仍包在 IIFE 中。`injectedJavaScriptBeforeContentLoadedForMainFrameOnly=true` 时先检查 `window.top !== window` 并退出，因此同源 / 跨域 iframe 都不执行用户脚本；为 false 时允许所有匹配的框架执行。比较跨域 WindowProxy 的身份不需要读取其内部属性。

原 `RNCWebViewClient.onPageStarted` 调用保留，但支持文档起始脚本时跳过旧的用户脚本 evaluateJavascript 路径，只保留原有 injected object 的刷新。不支持该特性的 WebView 继续原来的 evaluateJavascript 回退，因此旧设备仍可能存在原注入时序限制，且回退仍仅覆盖主框架。

依赖已自带 AndroidX WebKit：`android/build.gradle:113` 声明依赖，`android/gradle.properties:2` 默认版本为 **1.14.0**，无需修改依赖。已核对 Google Maven 上该版本的源码：`WebViewCompat.java:809` 的 API 说明保证脚本在页面任何 JS 之前执行，消息监听器对象会先于脚本注入，并明确要求在 loadUrl / loadData 前注册；`ScriptHandler.remove()` 从下次页面加载起生效。

### 长按开关与 Fabric

新增 Android props：

| prop | 默认值 | 原生行为 |
|---|---|---|
| `hapticBackEnabled` | true | `WebView.setHapticFeedbackEnabled(enabled)`，与旧壳一致，仍受系统触觉设置影响。 |
| `disabledUserLongClickSelect` | false | 原生 `setOnLongClickListener` 返回此开关值，消费整个 WebView 的长按事件，覆盖跨域 iframe；false 恢复默认处理。 |

新旧架构 manager 均接线；新架构的 `RNCWebViewNativeComponent.ts` codegen spec 声明两个 `WithDefault` prop。Android JS 源码明确下传，公共 TS 类型和 lib 声明同步。已发布 `lib/WebView.android.js` 原有 `otherProps` 路径本来即可透传这些值，已测试源码和 lib 两种入口；没有改写其整行压缩 JS。

桥方法继续更新已有 `page.state`；`BridgeWebView` 直接订阅该状态，而非依赖页面包装 hook，所以直接使用组件的自测页也能生效。原主文档 CSS / 事件 / menuItems 禁选逻辑保持配合。原生开关归属于 WebView，重载不会丢失；页面之间独立，iOS 忽略这些方法。

## 验证记录

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 最终全仓通过，退出码 0。 |
| `npx expo lint` | 最终全仓通过，退出码 0，无 error / warning。 |
| 本批独立类型与 lint 检查 | 临时 tsconfig 检查本批入口及依赖通过；`npx eslint src/features/notifications src/bridge/BridgeWebView.tsx src/bridge/modules/webview` 通过。 |
| 无设备行为检查 | **15/15 通过**。覆盖四个 action、iOS 五种权限、Android 总开关、错误回传、角标解析、授权与请求顺序、失败恢复、通知清理、直接 BridgeWebView 订阅与释放、页面隔离、iOS 忽略、源码 / lib prop 透传、实际 Java 拼接表达式产生的主框架 / iframe 脚本。临时脚本位于 `/tmp/dootask-x2-notify-webview/verify.cjs`，通过 TypeScript 转译及原生 / React 替身运行，不代替设备测试。 |
| Fabric codegen | RN 0.88 的 schema 生成与 `generate-specs-cli.js` 双端均通过；Android 生成的 manager interface / delegate 含两个新 setter、默认值 true / false，签名与实现一致；双端 C++ Props 均含新字段。 |
| patch 生成 | `npx patch-package react-native-webview` 成功生成 261 行补丁。 |
| 干净依赖验证 | `npm pack react-native-webview@14.0.1` 到 `/tmp`，解包后 `patch -p1 --dry-run --batch` 通过；实际应用通过，9 个补丁文件与当前 node_modules 对应文件逐字节一致。未删除本仓 node_modules，未在本仓运行 npm install，未使用 git stash；patch-package 仅在自身临时目录获取上游副本。 |
| Expo prebuild | 在 `/tmp/dootask-x2-notify-webview/prebuild` 的隔离项目副本执行 `CI=1 npx expo prebuild --clean --no-install`，默认配置及下文建议配置均成功生成双端工程；工作目录未生成 ios/ / android/。 |
| 通知插件配置检查 | 默认配置生成 `aps-environment=development`；在隔离副本显式关闭远程通知并移除既有后台 remote-notification 后，生成的 entitlement 不含 aps-environment，UIBackgroundModes 仅保留 audio。未将该配置写入本仓 app.config.ts。 |
| 修改范围 / 格式 | `git diff --check` 通过；package.json 仅新增 postinstall 一行，未修改 package-lock.json。 |

干净补丁预检的核心命令（从 App 仓库根目录执行）：

```bash
app_dir="$PWD"
webview_check_dir="$(mktemp -d /tmp/dootask-webview-patch.XXXXXX)"
npm pack react-native-webview@14.0.1 --pack-destination "$webview_check_dir"
mkdir -p "$webview_check_dir/clean/node_modules"
tar -xzf "$webview_check_dir/react-native-webview-14.0.1.tgz" -C "$webview_check_dir/clean/node_modules"
mv "$webview_check_dir/clean/node_modules/package" "$webview_check_dir/clean/node_modules/react-native-webview"
cd "$webview_check_dir/clean"
patch -p1 --dry-run --batch --input "$app_dir/patches/react-native-webview+14.0.1.patch"
```

### 未验证项

- 本机的 `ANDROID_HOME` / `ANDROID_SDK_ROOT` 指向 `/home/coder/Android/Sdk`，目录不存在；`JAVA_HOME` 指向的系统 JDK 也不存在。未运行 Gradle assembleDebug，未完成 Java / Kotlin 的 Android API 编译。源码核对及 codegen 不能替代原生编译。
- Linux 无 Xcode，未进行 iOS 原生编译。未连接设备或模拟器，本批没有通知授权、桌面角标、长按振动、输入框禁选或文档起始注入的设备结果。
- 尚未在业务入口导入通知模块，实际桥路由接入与正式 App 配置需由集成方完成；不沿用此前其他批次的设备验证结论。

## 集成方需处理

### 1. 导入通知 action

在 `src/bridge/modules/index.ts` 增加副作用 import：

```ts
import '../../features/notifications';
```

### 2. 显式关闭通知插件的远程能力

已安装的 expo-notifications 58.1.5 提供 **`enableRemoteNotifications: false`**，无需额外编写删除 entitlement 的插件。在 `app.config.ts` 的 plugins 中增加：

```ts
[
  'expo-notifications',
  {
    enableRemoteNotifications: false,
    enableBackgroundRemoteNotifications: false,
  },
],
```

插件源码 `plugin/src/withNotificationsIOS.ts:21` 默认启用远程通知，`:37` 向 entitlement 写入 `aps-environment`，默认 mode 为 development。隔离 prebuild 已验证当前默认配置会生成它；仅省略显式插件配置不足以保证不生成。该 entitlement 会要求 App ID / provisioning profile 支持推送，可能影响一期只用本地能力的签名配置。

显式设为 false 后，插件不会添加 APNs entitlement；权限查询、用户授权和本地角标仍可使用。`enableBackgroundRemoteNotifications: false` 只停止追加后台模式，**不会删除配置中已有的值**。当前配置已有 `UIBackgroundModes: ['audio', 'remote-notification']`，一期请移除其中的 `'remote-notification'`，保留媒体任务所需的 audio。若其他配置或插件显式添加了 aps-environment，也需一并移除，再 clean prebuild 检查产物。

无需填写 Google 服务配置、FCM 默认 channel、推送 token 或远程通知后台选项。本批没有改 App 配置，由集成方与并行媒体任务合并。

### 3. 在构建机重新构建

确保生产 / CI 安装不会跳过 postinstall，且构建环境安装了提供 patch-package 的 devDependencies。补丁必须先于 prebuild / Fabric codegen 应用；只重启 Metro 不会更新 Android 原生行为。继续使用既有 `npm install` → `npx expo prebuild --clean --no-install` → 双端原生构建流程，在 Mac 上完成 Android / iOS 编译。

## 设备手测清单

### 通知

- [ ] 集成 import 后，通过 `requireModuleJs('webview').sendMessage({action: 'getNotificationPermission'})` 查询；确认回调是 boolean、发给原页面、首次查询不弹窗。iOS 未决定 / 拒绝为 false、完整授权为 true；Android 13+ 未授权为 false，较旧 Android 按系统总开关返回。
- [ ] iOS 首次发送 `{action: 'setBdageNotify', bdage: 3}` 时仅出现系统授权，允许后桌面显示 3；别名 `setBadgeNum` 与其一致。拒绝后重复调用不再弹窗；系统关闭角标但保留通知时不设置角标。
- [ ] 授权弹窗期间连续发送角标 3、4、0，允许后最终为 0；回到设置修改授权后再次查询得到最新状态。
- [ ] Android 在至少一种支持数字角标的厂商桌面和 Pixel / 不支持数字的桌面验证尽力设置；确认不支持时不崩溃、不产生占位通知，设置 0 的通知栏清除副作用符合预期。
- [ ] 使用本地通知调试入口准备已展示通知和一条将来的本地通知，发送 `clearAllNotify` 后两者均清空；iOS 已有角标不被该 action 直接重置。确认全过程未请求 APNs / Expo / FCM token。

### Android WebView

- [ ] 在页面最前面的内联脚本立即读取 `typeof window.requireModuleJs`，支持 DOCUMENT_START_SCRIPT 的设备应直接得到 `function`，无需等待 50ms；URL / HTML source、刷新、重定向、前进后退分别检查。
- [ ] 独立测试 WebView 用文档起始脚本累加计数，确认每个文档只执行一次，onPageStarted 不会再次执行。修改脚本、清空脚本、切换 javaScriptEnabled 后重载，确认只使用新配置；销毁重建后无残留 handler。
- [ ] 主框架开关为 true 时，同源和跨域 iframe 内均不执行用户注入；独立测试 WebView 将其设为 false 后，两种 iframe 的首个内联脚本均能读到注入结果。App 的 BridgeWebView 保持主框架为 true。
- [ ] 在不支持 DOCUMENT_START_SCRIPT 的测试环境确认旧路径仍可用，并记录其仍可能晚于内联脚本的限制。
- [ ] 调用 `requireModuleJs('webview').setHapticBackEnabled(false / true)`，长按网页内容验证振动随开关改变；同时考虑系统触觉总开关，iOS 调用保持忽略。
- [ ] 调用 `setDisabledUserLongClickSelect(true / false)`，分别长按主文档、跨域 iframe、输入框、contenteditable、图片和链接，检查禁选与恢复、点击输入和键盘不受意外影响；验证前端定时恢复调用。
- [ ] 主页面开启禁选后打开二级页，确认状态独立；重载本页后保持；`dootask://bridge-test` 直接使用 BridgeWebView 也可切换开关，并完成原桥自测回归。

# eeui 兼容桥接口清单

这份清单是前端 `resources/assets/js`（`$A.eeuiApp*`，见 `functions/eeui.js`）与 App 壳之间的全部契约，同时作为验收清单使用。
旧实现参考主仓库中的 `resources/mobile/src/pages/index.vue`、`web.vue` 和 `resources/mobile/plugins/`。

状态说明：✅ 已实现　🟡 部分实现　⬜ 待实现。负责人：C = Claude（核心），X = Codex（批次 1/2）。

## 1. 机制

- 注入方式：在页面内容加载前注入 `window.requireModuleJs(name)`，实现见 `src/bridge/injected.ts`。Android 已通过 WebView 14.0.1 补丁优先使用 `DOCUMENT_START_SCRIPT`；不支持时保留 onPageStarted 回退，设备时序待验收（见 `x2-notify-webview-report.md`）。
- 同步方法：直接读取页面内的快照。原生侧任何值变化都会向**所有** WebView 广播增量（`src/bridge/pages.ts`）。
- 异步方法：通过 `postMessage` 发送 `{channel:'__eeui__', module, method, args}`。函数参数会被替换成 `{__cb:id}`，原生侧调用 `page.callback(ref, data, keep)` 回传；需要多次触发的回调要传 `keep=true`。
- 返回值：异步方法的同步返回值一律是 `undefined`，前端没有依赖这些返回值。
- 未实现的方法：记录到 `dispatcher.unimplemented`，开发环境打印警告，不抛异常。
- 新增方法的步骤：
  1. 在对应模块目录中调用 `registerModule('eeui', { method(page, ...args) {...} })`。
  2. 如果是 sendMessage 的 action，改为调用 `registerMessage('action', (page, payload) => ...)`。
- UA 后缀（不能更改，后端依赖它判断客户端，见 `Base::isEEUIApp`、`UserDevice` 等）：
  - Android：`;system_theme/{light|dark};android_kuaifan_eeui/{versionName}`
  - iOS：`;system_theme/{light|dark};ios_kuaifan_eeui/{versionName};idiom/{iPhone|iPad}`

## 2. 同步方法（eeui 模块，页面内快照）

| 方法 | 返回 | 状态 |
|---|---|---|
| getVersion() | number 壳版本号 | ✅ C |
| getVersionName() | string | ✅ C |
| getLocalVersion() | number App versionCode | ✅ C |
| getLocalVersionName() | string App versionName | ✅ C |
| getThemeName() | 'light' \| 'dark'（系统主题） | ✅ C |
| isFullscreen() | boolean | ✅ C（值由原生 `bridgeStore.setFullscreen` 维护，平板窗口化判断待 X 补充） |
| keyboardStatus() | boolean | ✅ C |
| getPageInfo(pageName?) | `{pageName, pageType, url, params}`；不传参数时返回当前页面 | ✅ C |
| rewriteUrl(url) | 基于当前 location 补全为绝对地址 | ✅ C |
| getVariate(key, def) / setVariate(key, val) | 内存变量，跨 WebView 共享 | ✅ C |
| getCachesString(key, def) / setCachesString(key, val, expiredSec) | 持久化缓存，0 表示永不过期 | ✅ C |
| getCaches / setCaches | 同上，值做 JSON 序列化 | ✅ C |

## 3. 异步方法：eeui 模块

| 方法 | 参数 → 回调 | 说明 | 状态 |
|---|---|---|---|
| openPage(object, cb) | `{pageName?, pageType:'app', url:'web.js', params:{url, titleFixed, urlFixed, showProgress, allowAccess, hiddenDone}, softInputMode, pageTitle}` → `{pageName, status}` 多次回调 | 状态顺序：ready → create → start → resume → pause → stop → destroy | ✅ C（二级页 UI 见第 6 节） |
| closePage(pageName?) | — | 不传参数时关闭调用者所在页面 | ✅ C |
| setPageBackPressed({pageName}, cb) | 按下 Android 返回键时调用 cb（可多次触发） | Back.vue 用它拦截首页返回 | ✅ C |
| goDesktop() | — | Android 退到桌面（moveTaskToBack），iOS 忽略 | ✅ X1（`src/native/register.ts`，首页导入 native 后注册，待实机验证） |
| alert(object, cb) | `{title, message, button, cancelable?}` 或标题字符串 → cb(null) | 原生 Alert；取消只释放回调 | ✅ X1 |
| toast(object) | `{message, gravity?}` 或字符串 | Android 用 ToastAndroid，iOS 用轻量浮层 | 🟡 X1（ToastHost 已实现，待集成方挂到根布局，见 x1-bridge-report.md） |
| openWeb(url) | — | 用系统浏览器打开 | ✅ X1 |
| keepScreenOn() / keepScreenOff() | — | expo-keep-awake | ✅ X1 |
| keyboardHide() | — | Keyboard.dismiss + WebView blur | ✅ X1 |
| copyText(text) | — | expo-clipboard | ✅ X1 |
| openScaner({}, cb) | → `{pageName:'scanPage', status:'create'}` → `{status:'success', text, source, format, result}` → `{pageName:'scanPage', status:'destroy'}`；支持 title / desc / continuous | 扫码页（expo-camera），手电筒回调 openLight / offLight | ✅ X2（`src/features/media`；待集成 import 与设备验证） |
| checkUpdate() | — | 一期为空实现 | ✅ X1（按一期范围保留空实现） |
| shakeToEditOn() / shakeToEditOff() | — | iOS 摇一摇撤销；可空实现 | ✅ X1（按一期范围保留空实现） |
| getSafeAreaInsets(cb) | → `{status:'success', top, bottom, width, height}` | 旧 iOS 返回 UIKit point，Android 返回物理像素；详见旧 DeviceUtil.m:726 / eeuiScreenUtils.java:82 | ✅ X1 |
| getDeviceInfo(cb) | → `{status:'success', manufacturer, brand, model, modelName, deviceName, systemName, systemVersion}` | expo-device；Android 和 iOS 16+ 的 deviceName 与旧实现一致返回空串 | ✅ X1 |
| getLatestPhoto(cb) | → `{status, thumbnail:{width, base64}, original:{width, path}, created, error}` | 最近一张照片（“发送最近照片”），base64 含 data URI 前缀，created 为秒 | 🟡 X2（数据、权限、缩略图和路径已实现；Expo Android 按 DATE_TAKEN，旧壳按 DATE_ADDED，严格对齐需原生补充，见 x2-media-report.md） |
| uploadPhoto(params, cb) | `{url, data, headers, path, fieldName}` → `{status:'ready', id:url}`，然后 `{status:'success', statusCode, data}` 或 `{status:'error', error}` | 多次回调；保留旧 Android 字符串 / iOS JSON 响应差异 | ✅ X2（SDK 58 UploadTask；待集成 import 与设备验证） |
| cancelUploadPhoto(id, cb) | → `{status:'success', id}` 或 `{status:'error', error}` | Android 原上传回调随后 error，iOS 原回调只释放 | ✅ X2（支持 ready 内取消、跨页面取消及竞态保护） |

## 4. 异步方法：webview 模块

| 方法 | 说明 | 状态 |
|---|---|---|
| sendMessage(obj) | 按 `obj.action` 路由到第 5 节 | ✅ C（路由） |
| setUrl(url) | 当前 WebView 跳转；相同 URL 重新加载 | ✅ X1 |
| createSnapshot(cb) / showSnapshot() / hideSnapshot() | 按页面截取并覆盖显示；`createSnapshot` 按旧 iOS eeuiWKWebViewComponent.m:494/497 回调 boolean（不是 `{status}`） | ✅ X1（实际截图画面、后台切换待设备验收） |
| setHapticBackEnabled(bool) | 仅 Android | ✅ X2（page.state → 原生 prop → setHapticFeedbackEnabled；Fabric / Paper 均已接线，实际振动待设备验收） |
| setDisabledUserLongClickSelect(bool) | 仅 Android；原生消费长按事件，保留页面 CSS / contextmenu / selectstart 和 menuItems 联动 | ✅ X2（WebView 14.0.1 补丁覆盖跨域 iframe；开关和重载恢复已接线，输入框及实际长按待设备验收） |
| setScrollEnabled(bool) | WebView prop + 可恢复的网页滚动拦截 | ✅ X1 |

## 5. sendMessage action

| action | payload | 说明 | 状态 |
|---|---|---|---|
| initApp | `{apiUrl, userid, token, language, userAgent}` | 保存到 bridgeStore 变量 `appMessage`；一期不启动推送 | ✅ X1 |
| windowSize | `{width, height}` | 记录为 variate `windowWidth` / `windowHeight` | ✅ X1 |
| updateTheme | `{themeName, themeDefault:{theme:{dark,light}, nav:{dark,light}}}` | 状态栏样式、背景色；缓存 themeName / themeDefault，保留 getThemeName 的系统主题语义 | 🟡 X1（消息、WebView 和二级导航已实现；根布局需改用 useAppTheme，保证重启和系统主题变化时状态栏一致） |
| callTel | `{tel}` | `tel:` 链接 | ✅ X1 |
| setVibrate | `{time?}` | Vibration；Android 缺省 500ms，iOS 使用系统振动 | ✅ X1 |
| gotoSetting | — | Linking.openSettings | ✅ X1 |
| getNotificationPermission | → `window.__onNotificationPermissionStatus(ret)`，ret 为 boolean | 一期只查询权限，不弹窗 | ✅ X2（本地通知模块自注册；待集成 import，设备待验收） |
| setBdageNotify / setBadgeNum | `{bdage}` | iOS 首次设置时申请角标 / 提醒 / 声音权限；Android 尽力设置 | ✅ X2（不注册推送 token；Android 桌面支持有限，插件配置见报告） |
| clearAllNotify | — | 清除已展示和待发送的本地通知 | ✅ X2（不重置 iOS 角标、不触发授权；设备待验收） |
| picturePreview | `{language, position, paths}` | 原生图片预览 | ✅ X2（多图、初始索引、左右滑动、双指缩放、关闭；待集成 import 与设备验证） |
| videoPreview | `{language, path}` | 原生视频播放 | ✅ X2（expo-video、原生播放控件、失焦 / 后台暂停；待集成 import 与设备验证） |
| userChatList | `{language, url}` | 系统分享扩展所需的会话列表（iOS App Group / Android 缓存） | ✅ X2（`src/features/share`；App Group UserDefaults + 旧 archive / Android eeuiCaches；待集成 import 与设备验收） |
| userUploadUrl | `{dirUrl, chatUrl}` | 同上 | ✅ X2（保留 upLoadUrl / fileUpLoadUrl；双端原生分享页与上传、CNG 扩展 / Activity 已实现，见 x2-share-report.md） |
| startMeeting | `{meetingParams:{...}}` | Agora 会议（M3），事件通过 `__onMeetingEvent` 回传 | ⬜ X(M3) |
| updateMeetingInfo | `{infos:{uuid, avatar, username}}` | M3 | ⬜ X(M3) |
| setUmengAlias / delUmengAlias | `{url}` | 一期不接推送，只记录 action 日志；二期改为 DooPush | ✅ X1（日志占位） |
| setPageData | `{data}` | 合并当前页面展示数据，不触碰生命周期和控制器 | ✅ X1 |
| createTarget | `{url}` | 二级页专用：按白名单在当前 WebView 加载，mailto/tel/callto 交给系统（与旧 web.vue:273 一致） | ✅ X1 |
| openUrl | `{url}` | 二级页专用：用外部浏览器打开 | ✅ X1 |

## 6. 原生 → Web 回调（window 全局函数）

| 函数 | 触发时机 | 状态 |
|---|---|---|
| `__onAppActive()` / `__onAppDeactive()` | App 回到前台或进入后台；回到前台时还要检查本地 Web 服务是否存活 | ✅ C；✅ X1 服务检查已封装在 `useLocalWebReady`，待首页接入 |
| `__onPageResume(resumeNum)` / `__onPagePause()` | 页面聚焦且 App 在前台时视为 resume；首次也会触发；resumeNum 从 0 开始递增 | ✅ C |
| `__onKeyboardStatus({keyboardType:'show'\|'hide', keyboardHeight})` | 键盘弹出或收起 | ✅ C |
| `__onCreateTarget(url)` | target=_blank 或 window.open | ✅ C（主页面）；✅ X1（二级页按白名单在当前页加载，与旧 web.vue 一致） |
| `__onNotificationPermissionStatus(ret)` | getNotificationPermission 返回 boolean；iOS 完整授权才为 true | ✅ X2（原页面回调，查询失败返回 false；待集成 import） |
| `__onMeetingEvent(param)` | 会议事件 | ⬜ X(M3) |
| `__handleLink(link)` | 通过深链 `dootask://` 打开；移除 scheme 后传递路径，前端尚未就绪时延迟 2 秒 | ✅ X1（`useDeepLinkHandler` + `+native-intent.tsx`，保留 bridge-test；待首页接入及实机验证） |

## 7. 二级页面（web.js → `src/app/web.tsx`）

- ✅ C：打开、关闭、生命周期回调、返回键，以及按 params.url 加载。
- ✅ X1（UI 与参数已接入；设备手测项见 [X1 实现记录](x1-bridge-report.md)）：
  - 导航栏：返回、标题、更多菜单（后退、前进、浏览器打开（非 localhost）、刷新）。
    - 菜单文案取缓存 `languageWebBack`、`languageWebForward`、`languageWebBrowser`、`languageWebRefresh`。
    - 显式 `pageTitle` 保留给固定标题等调用；未指定时优先使用缓存 `updateDefaultTitle`。
  - 页面标题：取网页 title，但忽略 `HitoseaTask`、`DooTask`、`about:blank`、`App`。
  - 参数：titleFixed、urlFixed、showProgress（进度条）、allowAccess、hiddenDone。
  - createTarget 只允许 `/^(?:https?|mailto|tel|callto):/i`。

`urlFixed` 固定菜单的浏览器打开 / 刷新 URL，不阻止网页内导航；`titleFixed` 阻止网页 title 覆盖导航标题。快照、覆盖属性、菜单数据均保存在各自的 `PageHandle.state` 中。

## 8. 本地 Web 服务与资源

- ✅ X1：`modules/web-server`（Expo Modules API，Swift + Kotlin）在 `http://localhost:22223` 提供静态资源服务，根目录是 `assets/web/`，经 `plugins/with-web-assets.js` 注入原生资源（eeui 时代为 `public/`）。
  - 必须保持端口和主机名不变，否则 WebView 的 localStorage / IndexedDB 会丢失。
  - 启动失败时重试 3 次。
  - 回到前台时检查服务，必要时重启。
  - 端口写入缓存 `appWebServerPort`。
  - 仅监听 127.0.0.1；支持 GET/HEAD、业务路由 index.html 回退、MIME、并发请求。iOS 支持单段 Range；Android 对未压缩资源支持 Range，压缩资源采用分块流式传输。
  - prebuild、资源引用和双端 autolinking 已验证；原生 App 内运行尚未验证。
- ✅ X1：`useLocalWebReady` 在服务就绪后返回主页面地址；开发模式（设置了 `EXPO_PUBLIC_WEB_URL`）直接返回开发地址，不启动服务。首页接入由集成方按 `docs/native-integration.md` 的 diff 完成。
- ✅ X1：`modules/legacy-store` + `migrateLegacyCaches` 读取旧 eeui 缓存，导入 `bridgeStore.importCaches`。
  - Android：SharedPreferences 文件 `eeuiCaches`，键 `eeuiCaches`，值为 JSON 字符串，条目结构 `{[key]: value, expired: Unix秒}`。
  - iOS：标准 `NSUserDefaults` 的 `storage_caches` 字典，条目结构 `{[key]: value, storage_expired: Unix秒}`；`version: 2` 时 value 是 JSON 字符串 `{"value": 原值}`，v1 直接存原值。
  - 过期条目丢弃，0 保持永久，其余绝对时间从秒转换为 `CacheEntry.expiredAt` 的毫秒；不把绝对时间当作剩余秒数传入 `setCachesString`。
  - 只需迁移一次。
  - 新缓存优先，成功导入后才同步持久化 `__legacyCachesMigrated=1`；失败可重试，旧存储保持可读。
- ✅ X1：`ensureAppUniqueId` 在迁移后保留旧 `appUniqueId`，缺失或长度小于 5 时按旧字符表生成 6 位随机串，永久缓存。

## 9. 验收

- 桥接自测页：`dootask://bridge-test`，所有项通过。
- 登录 `EXPO_PUBLIC_WEB_URL` 指向的测试服务器后：
  - 消息、任务、文件三大模块可用。
  - 键盘弹出时布局正常。
  - Android 返回键行为正常。
  - 二级页面（定位签到、外链）可用。
- 后端识别：UserDevice 能正确解析 platform 和 app_version。

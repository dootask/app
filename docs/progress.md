# 进度

一期目标：换壳并补齐兼容桥，功能与旧壳对齐（不含推送），只做内测（TestFlight / Android 内测）。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 工程骨架与开发环境 | 进行中 |
| M1 | WebView 壳与兼容桥 | 核心完成，模块方法待实现 |
| M2 | 原生能力（扫码、图片、通知权限、分享等） | 未开始 |
| M3 | Agora 会议 | 未开始 |
| M4 | 构建与 CI | 未开始 |
| M5 | 测试与内测 | 未开始 |

## 记录

### 2026-10-17 M0 / M1 核心

已完成：
- Expo SDK 58 工程，启用 expo-router 和 CNG。
- `app.config.ts`：包名 `com.dootask.task`，版本号取自主仓库。
- 兼容桥核心：注入脚本与同步快照、广播、回调协议、openPage 生命周期、返回键拦截。
- 主页面、二级页面骨架、桥接自测页。
- `docs/bridge-inventory.md`、`AGENTS.md`。

验证结果（Mac mini 模拟器，dev client 连接本机 Metro 2221）：

- Android（emulator API 35，`dootask_api35`）：
  - ✅ 构建并安装成功（gradle 用时 5 分 39 秒）。
  - ✅ 主页面加载测试服务器（`EXPO_PUBLIC_WEB_URL`），出现隐私协议和服务器地址确认，用测试账号登录后进入仪表盘。
  - ✅ 桥接自测页 `dootask://bridge-test` 19/19 通过，包括 UA 后缀、同步快照、缓存过期、openPage 状态序列、子页面 pause 时同步读取子页变量。
- iOS（模拟器 iPhone 17 Pro Max）：
  - ✅ 构建并安装成功。
  - ✅ 主页面加载测试服务器，登录后进入仪表盘（这次是手动登录）。
  - ✅ 桥接自测页 19/19 通过，UA 后缀为 `ios_kuaifan_eeui/1.9.36;idiom/iPhone`。
  - 修复：iOS 的 RNCWebView 把没有 host 的 URL 交给 `loadFileURL` 加载，`data:` URL 会抛 NSInvalidArgumentException 导致闪退。现在 `BridgeWebView` 把 `data:text/html` 转成 html source 加载，Android 复测仍为 19/19。

发现的问题：

- Android 的 `injectedJavaScriptBeforeContentLoaded` 由 react-native-webview 在 onPageStarted 时用 evaluateJavascript 注入，可能晚于页面内联脚本执行（实测约晚 50ms）。
  - 前端 `app.js` 会等待 `requireModuleJs`（最长 15 秒），所以主应用不受影响；自测页已改为等待注入。
  - 后续加固：用 `WebViewCompat.addDocumentStartJavaScript` 在文档开始阶段注入（需要 patch react-native-webview 或自定义 WebView），列入 M2。
- 版本号读取主仓库的 `package.json`。Mac mini 上的主仓库较旧，所以显示 1.9.36 / 243；这符合预期，正式构建时以主仓库当前版本为准。

### 2026-10-17 X1 桥方法与二级页 UI

已实现本批 eeui / webview 方法、sendMessage、二级页导航菜单和参数，以及主 / 子页各自的覆盖属性和快照。页面状态放在 PageHandle.state，主题和共享变量仍由 bridgeStore 维护。未改动桥核心、根布局、原生任务目录或 X2 / M3 接口，未新增依赖。

对照旧原生源码修正两处契约描述：createSnapshot 回调为 boolean；getSafeAreaInsets 包含 width，且 iOS 使用 point、Android 使用物理像素。

验证：类型检查通过；7 组无设备回归通过，原 bridgeTestHtml 的脚本断言在 WebView / 路由替身中为 19/19。lint 最终结果及逐项旧源码依据见 [X1 实现记录](x1-bridge-report.md)。本批设备验证尚未进行，不能沿用上一批的模拟器结果。

待集成：根布局挂载 ToastHost 并改用应用主题；Android 原生长按振动开关及跨域 iframe 的长按选择拦截。设备手测清单在实现记录中，接口清单已据此标记 ✅ / 🟡。


### 2026-10-17 X1 本地资源、缓存迁移与原生启动封装

已实现 `modules/web-server`、`modules/legacy-store`、资源 config plugin、`src/native/` 启动/迁移/设备标识/退到桌面/深链封装，以及 `+native-intent.tsx`。App 插件段仅追加资源插件；未安装 npm 依赖。首页与桥核心的接入交给集成方，完整文件清单和可应用的首页 diff 见 [原生接入说明](native-integration.md)。

旧缓存依据：Android `eeuiCaches` 偏好文件中的同名 JSON；iOS 标准 UserDefaults 的 `storage_caches` 字典（兼容 v1 及 v2 JSON 包装）。旧绝对 Unix 秒转换为导入缓存的毫秒时间戳，0 为永久；迁移成功才同步持久化完成标记。设备标识生成规则与旧壳一致。深链同旧原生入口先移除 dootask scheme 再传前端。

验证：全仓 `npx tsc --noEmit`、`npx expo lint` 通过；8 项 JS 行为测试通过；Kotlin 2.2.20 + 临时 JRE 17 的 HTTP 宿主测试通过（含 4 MiB 流、Range、HEAD、32 并发和重启）。`expo prebuild --clean --no-install` 通过，双端静态资源、iOS folder reference / Resources 构建项、双端 autolinking 均已检查。插件缺资源、嵌套复制、清理过时文件和重复执行也通过。建议接入代码另经虚拟 TypeScript / ESLint 检查，没有写入首页。生成的 ios/、android/ 已删除。

未验证：本机 Android SDK/JDK 配置路径不存在，未进行 Android 原生构建；Linux 无 Xcode，Swift 未编译。Kotlin 宿主测试不能替代 Expo/Android API 编译。需要构建机完成双端编译，以及升级迁移、静态服务、后台恢复、goDesktop、深链的设备验收；包内目前只有占位 HTML，需由集成方同步真实前端产物。本批结果不沿用此前核心或其他并行批次的设备测试结论。

### 2026-10-17 X1 集成与双端验证

集成方已应用首页接入 diff（`useLocalWebReady`、缓存迁移、设备标识、深链）和根布局 ToastHost / 应用主题，并在 `+native-intent.tsx` 的保留路由中加入开发工具 `dev-eval`。

验证结果（Mac mini 模拟器，重新 prebuild 并构建双端，dev client 连接 Metro 2221）：

- ✅ 双端原生编译通过：Swift 与 Kotlin 的 `DooTaskWebServer`、`DooTaskLegacyStore` 都已被 autolinking 发现并编译。
- ✅ 覆盖安装后保留登录状态，主页面直接进入仪表盘；缓存迁移和设备标识初始化没有报错。
- ✅ 桥接自测页双端都是 19/19。
- ✅ 业务深链 `dootask:///manage/messenger` 在应用运行时，双端都能跳到消息页。
  - 修复：Android 上，前端 pushState 触发的 `doUpdateVisitedHistory` 也会派发 loadStart，但之后不会再派发 onLoad，导致深链一直在等页面就绪。现在只在 `nativeEvent.loading` 为 true 时才把页面重置为未加载。
- ✅ `dootask://dev-eval?js=...` 双端都能注入主页面。

未验证：

- 本地 Web 服务的运行时验证。开发构建设置了 `EXPO_PUBLIC_WEB_URL`，不会启动本地 Web 服务；要等 M4 把真实前端产物放进 `assets/web/` 后验证。
- 从旧版升级时的缓存迁移，需要先装旧版 eeui 包再覆盖安装。
- 冷启动深链、goDesktop、快照（`react-native-view-shot` 已安装，本次构建已链接，设备上尚未手测）。

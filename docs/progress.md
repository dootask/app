# 进度

一期目标：换壳并补齐兼容桥，功能与旧壳对齐（不含推送），只做内测（TestFlight / Android 内测）。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 工程骨架与开发环境 | 完成 |
| M1 | WebView 壳与兼容桥 | 完成 |
| M2 | 原生能力（扫码、图片、通知权限、分享等） | 完成，部分待手测 |
| M3 | Agora 会议 | 完成，待真实通话验收 |
| M4 | 构建与 CI | 链路完成，待配置 secrets 出包 |
| M5 | 测试与内测 | 进行中：页面级兼容（键盘等） |

## 用户验收清单（汇总，验收后勾选）

AI 无法自动完成的验证集中在这里，详细步骤见 `docs/page-compat-audit.md` 的 V01–V12。

**iOS 模拟器（手动点击）**
- [ ] 子页从左边缘右滑能关闭；从屏幕中部右滑不关闭（swipeFullBack 默认关）
- [ ] 手机横置时页面保持竖屏
- [ ] 聊天页、搜索框等弹出确认框/搜索后取消：键盘收起，行为与旧版一致（K08）

**Android 真机**
- [ ] 手势导航下子页左缘返回走系统返回；三键导航下自绘滑动返回的转场是否跳动（N02/N03）
- [ ] 平板可旋转、分屏正常，手机锁竖屏（S07）
- [ ] HTTPS 外站/微应用里的 HTTP 图片和接口能加载（N06，V07）
- [ ] 录音权限：首次拒绝、永久拒绝、去设置授权后返回再录（B02，V12）
- [ ] 语音连播、内联视频、切后台再回来，无异常自动播放（B03，V12）

**双端真机**
- [ ] 系统大字体：H5 文字随系统缩放的效果与旧版一致、聊天输入框高度正常；子页导航栏字号固定（T06/T07，V08）
- [ ] 用户详情点电话 → 确认后调起系统拨号（B09）
- [ ] iOS 输入框打字后摇动设备出现「撤销」（K09）
- [ ] 分屏/画中画（Android）、iPad Split View/Slide Over 下前端判定为非全屏；退出后恢复全屏（S08，V06）
- [ ] Android 先拍一张新照片、再导入一张旧照片，「最近照片」推荐仍是刚拍的（按入库时间，B05，V12）
- [ ] 地图页（百度/高德/腾讯）定位：允许、拒绝、关闭定位、超时；签到选点后立即关闭能取到位置，快速重复 5 次（B01/N08，V09）
- [ ] 安全区与状态栏/导航栏（S02–S06）：刘海屏、横屏平板、深浅色切换（V06/V11）
- [ ] 冷/热深链、主题切换、包内 Release 首启（L05/L07/A05，V01/V11）
- [ ] 以及下方「需真机 / 手动触发」「包内 Release 模式」各项

## 待办清单（集中跟踪）

新发现的待办先追加到这里，完成后改为 `[x]` 并注明日期 / 提交；各节「未验证」为当时的原始记录。

**页面级兼容**
- [x] 聊天页弹出键盘时输入框被遮挡（Android 已修复并验证，见「键盘避让」；iOS 待手动确认）
- [ ] iOS 聊天页键盘手动确认（模拟器无法自动点击）
- [x] 梳理前端其他针对 eeui 原生的页面优化：见 `docs/page-compat-audit.md`（58 项，P0/P1/P2 清单与设备验证步骤 V01–V12）
- [x] P0 K02–K04 键盘事件对齐旧壳：iOS 按 750 宽换算、Android 物理 px；Android 只在显隐切换时上报；只投递首页（Android 已验证 819px@2.625）
- [x] P0 T01 setScrollEnabled 不再拦截全 document touchmove/wheel，只锁外层；T03 禁选时保留输入控件选区
- [x] P1 L06 首页恢复时刷新通知权限并清通知栏
- [x] P1 B01 getGeolocation（expo-location，仅前台权限，≤50m 精度，20s 超时必回调）：双端模拟器授权后均返回 success + 坐标
- [x] P1 B02 Android 录音权限结果回调 `__onPermissionRequest('recordAudio', bool)`（react-native-webview 补丁；普通拒绝也回 false，旧壳不回调）：双端编译通过
- [ ] 真机验证：地图页三种地图定位、拒绝/关闭定位/超时分支、签到选点（V09）；首次/永久拒绝录音后重试（V12）
- [x] P0 K06 iOS 聊天弹窗键盘遮挡输入框：react-native-webview 在 scrollEnabled=false 时把 scrollView.bounds 钉回原位、且注入了 html/body overflow:hidden，挡住 WebKit 弹键盘时的上推；补丁去掉钉位、iOS 不再注入 overflow（对齐 eeui 只关 scrollEnabled）。用户 iOS 模拟器手动验证通过
- [x] N06 Android `mixedContentMode="always"`（对齐 MIXED_CONTENT_ALWAYS_ALLOW）
- [x] B03 免手势播放按旧壳：Android 允许、iOS 需用户手势（WK 默认）
- [x] K08 keyboardHide：Android 原生 hideSoftInput 不移除焦点；iOS 保持 blur + dismiss
- [x] N08 核对：setVariate 处理器同步写 store 并经同一注入通道先于 pause 回调送达首页，顺序有保证，无需改动（待 V09 实测）
- [ ] K08/B03 真机对照（V11 弹框取消后光标/选区、V12 媒体播放）
- [x] S07 方向：手机锁竖屏（iPhone 仅正向竖屏）、平板全方向（Android 按 DeviceType.TABLET 判断，与旧壳 ≥7 英寸略有差异）
- [x] N02/N03 子页边缘返回：iOS 原生 Stack 手势（swipeBack/swipeFullBack），Android 左缘 24dp 自绘手势（30% 宽度或快速右甩关闭）；模拟器三键导航下已验证回弹/关闭，手势导航下由系统返回接管
- [x] K08 模拟器验证：Android 键盘收起且壳不 blur；聊天框失焦来自前端 ChatInput 监听 keyboardShow 主动 blur，与旧壳一致
- [ ] S07/N02 真机：Android 平板旋转与分屏、iOS 边缘/全屏返回手感、Android 滑动关闭时的转场衔接
- [ ] P1 其余项（S 安全区等需真机）见审计清单
- [x] P2 K05 键盘事件补 safeAreaTop/safeAreaBottom（单位同 keyboardHeight：iOS 750 换算截断、Android 物理 px）
- [x] P2 N07 openPage softInputMode：nothing 不避让；resize/pan/auto 按 resize（前端无非默认调用）
- [x] P2 T06 不再强制 textZoom=100，对齐旧 ExtendWebView 未设置 textZoom（待 V08 大字体对照）
- [x] P2 T07 子页导航栏/菜单文字不随系统字体放大，对齐旧原生 header 固定字号（尺寸待 V07/V08 对照）
- [x] P2 B09 前端 UserDetail.vue 拨号分支 `$A.isEEUIApp()` 改为布尔读取（主仓库前端）
- [x] P2 K09 iOS shakeToEditOn/Off 切换 applicationSupportsShakeToEdit（Android 无此能力，空实现同旧壳）
- [x] P2 S08 原生 isFullscreen（Android 分屏/PiP 为 false；iOS 比较窗口与屏幕），尺寸/前后台变化时刷新桥状态；模拟器双端返回 true
- [x] P2 B05 Android 最新照片按 MediaStore DATE_ADDED 取（对齐旧壳），created 为秒；模拟器验证通过
- [ ] P2 仅记录、待真机对照决定：T05 回弹/overscroll（新壳显式关闭，比旧壳更严）、L03 后台快照、L08 Web 进程崩溃后直接 reload（旧 iOS 先提示）、B08 检查更新空实现（有意差异，二期商店上架时再定）

**需真机 / 手动触发**
- [ ] 真实会议通话（前端会议入口取 token）：多人视频网格、最小化悬浮条、后台语音、Android 保活通知、划掉任务后释放引擎
- [x] Android 分享实际发送：SEND text/plain → ShareActivity 列出会话 → 勾选发送「发送成功」，会话内可见（2026-10-18 模拟器）
- [ ] iOS 分享扩展（从其他 App 分享面板触发，模拟器需手动点选）
- [ ] 扫码识别结果回调、getLatestPhoto / uploadPhoto、videoPreview
- [ ] 长按振动与禁用长按选择、clearAllNotify、快照、goDesktop
- [x] 热深链：双端从首页/日历子路由跳转 /manage/calendar、/manage/messenger 正常（2026-10-18 模拟器）；Android goDesktop 回桌面正常，iOS 空实现同旧壳
- [ ] 冷启动深链（dev client 冷启动停在开发启动器，需包内 Release 验证）

**包内 Release 模式（依赖 M4 出包）**
- [ ] 在 GitHub 配置 app-internal Environment 与签名 secrets，手动运行 Expo App Internal workflow
- [ ] 本地 Web 服务（localhost:22223）、首次服务器设置、hash 路由、离线资源、后台恢复
- [ ] 从旧版 eeui 包覆盖升级的缓存迁移（保留登录、设置）

**已知差异 / 二期前复核**
- [x] Android getLatestPhoto 使用 DATE_TAKEN，旧壳为 DATE_ADDED，需补原生查询（🟡）— 2026-10-18 P2 B05 已改为原生 DATE_ADDED（e3b7eb8）
- [ ] iOS `voip` 后台模式：二期接 DooPush 时结合 PushKit 复核，否则上架可能被拒
- [x] Android 会议错误弹窗按钮为系统默认 “OK”，需本地化 — 2026-10-18 会议/扫码提示框显式传按钮（会议按语言 确定/確定/OK）
- [ ] 二期：DooPush 接入、开启 expo-notifications 远程推送与 aps-environment

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

### 2026-10-17 X2 扫码、照片上传与媒体预览

新增 `src/features/media/` 自注册入口、扫码及媒体预览路由，实现 openScaner、getLatestPhoto、uploadPhoto / cancelUploadPhoto、picturePreview / videoPreview。保留扫码生命周期、连续扫码、手电筒事件、上传 ready → 完成顺序，以及旧双端在上传响应和取消回调上的差异。请求与任务登记放在 PageHandle.state；app.config.ts 仅追加官方媒体插件和中文权限文案；没有安装依赖。

验证：`npx tsc --noEmit`、`npx expo lint`、24 项 Node 无设备测试通过；`CI=1 npx expo prebuild --clean --no-install` 成功，Info.plist 中文用途说明、Android 图片 / 相机权限、包名和条码功能配置已检查，生成的 ios/、android/ 已删除。本机 Android SDK / JDK 路径不存在，未执行 assembleDebug；Linux 无 Xcode，未编译 iOS，未进行本批设备验收。

待集成：在 `src/bridge/modules/index.ts` 加 `import '../../features/media';`。getLatestPhoto 的返回结构和秒值已兼容，但 Expo Android 只提供 DATE_TAKEN，旧壳使用 DATE_ADDED；导入旧照片场景仍需集成方补原生查询，因此接口清单保留 🟡。SDK 58 的时间类型注释与原生实现也不一致，已按实际毫秒值转换。文件清单、旧源码行号、平台差异、验收步骤见 [X2 媒体实现报告](x2-media-report.md)。

### 2026-10-17 X2 通知与 Android WebView 加固

已实现本地通知权限查询（boolean 原页面回调）、两个角标 action 和通知清理；通知目录通过副作用自注册，待集成方在模块入口导入。没有注册远程推送 token，未新增或升级依赖。iOS 首次设置角标沿用旧壳 Badge / Alert / Sound 的授权范围；Android 角标受桌面支持限制，且当前 Expo SDK 的角标归零会清除通知栏。

通过 patch-package 生成 `patches/react-native-webview+14.0.1.patch`：支持时在加载 source 前注册 DOCUMENT_START_SCRIPT，脚本 / 开关变化时移除并替换 handler，不与 onPageStarted 重复执行；不支持时保留原路径。补齐 Fabric / Paper 的长按振动和原生禁选 props，BridgeWebView 直接订阅各自 page.state，覆盖跨域 iframe 和独立自测页。package.json 仅新增 postinstall 一行。

验证：最终全仓 `npx tsc --noEmit`、`npx expo lint` 通过；15 组无设备行为检查通过；双端 Fabric codegen 通过。补丁在 npm pack 得到的干净 14.0.1 副本上 dry-run 和实际应用均成功，9 个文件逐字节一致。隔离副本中的双端 clean prebuild 成功；建议配置下确认不生成 aps-environment，且后台模式不含 remote-notification。

待集成：添加通知目录 import；显式配置 expo-notifications 的 enableRemoteNotifications / enableBackgroundRemoteNotifications 为 false，并移除已有后台 remote-notification。默认配置仍会生成 APNs entitlement，已在隔离 prebuild 复现。当前机器没有可用 Android SDK / 系统 JDK，Linux 无 Xcode，未做双端原生编译或设备手测。改动清单、旧源码行号、配置片段及设备验收清单见 [X2 通知与 WebView 报告](x2-notify-webview-report.md)。

### 2026-10-17 X2 系统分享

新增 `modules/share` 本地 Expo 模块、`plugins/with-share.js` 和 `src/features/share` 自注册入口，实现 userChatList / userUploadUrl 及双端原生分享页。iOS 生成 `com.dootask.task.shareExtension` target，主 App / 扩展共用 `group.im.dootask`，同时兼容旧 MMWormhole `share/*.archive`；Android 保留 eeuiCaches JSON 契约，独立 Activity 接收 SEND / SEND_MULTIPLE 和 ClipData。两端均直接选择会话或文件目录后上传，支持搜索、多语言、进度、取消和失败统计，不依赖主 App 的 JS 启动，不改已有深链入口。

验证：类型检查、lint、6 项桥接契约测试和 clean prebuild 通过；真实生成工程的扩展 target、显式构建依赖、签名嵌入、本地化资源、双方 App Group、Android intent-filter 均通过检查；插件重复执行不产生重复项，并验证构建 team 传递和双端模块 autolinking。四个 Android 原生业务类另经 Kotlin 2.2.20 / API 36 类库宿主编译，临时 JRE 21 下 8 组缓存/实际 HTTP multipart 回归通过；该检查使用临时 R ID，不含 Expo binding、aapt 或 Gradle。未新增依赖，生成目录已删除。Linux 无 Xcode，本机 Android SDK / 系统 JDK 路径不存在，双端完整编译与设备冷/热分享验收仍需构建机完成。

待集成：在 `src/bridge/modules/index.ts` 加 `import '../../features/share';`，并配置两个 Apple App ID 的签名与 App Group 关联。完整方案、旧源码行号、验证边界与设备清单见 [X2 分享报告](x2-share-report.md)。

### 2026-10-17 X2 集成与双端验证

集成方已在 `src/bridge/modules/index.ts` 导入 media / notifications / share；`app.config.ts` 加入 expo-notifications（`enableRemoteNotifications: false`、`enableBackgroundRemoteNotifications: false`），并从 `UIBackgroundModes` 移除 `remote-notification`。Mac 构建时 postinstall 成功应用 webview 补丁，iOS 包内已嵌入 `PlugIns/shareExtension.appex`。

双端模拟器结果：

- ✅ 原生构建双端通过（新增 DooTaskShare 模块、分享扩展 target、patch 后的 RNCWebView）。
- ✅ 桥接自测 19/19；Android「requireModuleJs 已注入」不再出现 waitedMs，文档起始注入生效。
- ✅ getNotificationPermission 经 `window.__onNotificationPermissionStatus` 回传 boolean：未授权为 false，Android `pm grant POST_NOTIFICATIONS` 后为 true；iOS 首次 setBadgeNum 时弹出系统通知授权框。Android 模拟器桌面不支持数字角标，只打印警告。
- ✅ openScaner：双端弹出相机授权（iOS 显示中文用途说明），Android 授权后虚拟摄像头取景正常，关闭 / 手电筒 / 从图片识别按钮齐全；iOS 模拟器无摄像头，页面正常渲染。
- ✅ picturePreview：多图、初始 position、页码（2/3、3/3）双端正常。
- ✅ Android 系统分享：`ACTION_SEND text/plain` 打开独立 ShareActivity，用缓存配置拉到会话列表。
- 🔧 修复：首页 / 子页 WebView 的返回键监听原先在被扫码、预览等原生页覆盖时仍生效，导致 Android 返回键关不掉扫码页。改为 `useFocusEffect` 仅在获得焦点时监听，复测返回键可正常关闭扫码与预览。

未验证（需手测或真机）：分享实际发送（会在测试服务器真实发消息）、iOS 分享扩展（需从其他 App 的分享面板触发）、扫码识别结果回调、getLatestPhoto / uploadPhoto、videoPreview、长按振动与禁选、clearAllNotify。Android getLatestPhoto 的 DATE_ADDED 语义仍为 🟡。

### 2026-10-17 X4 Expo 内测构建与 CI

新增主仓库 `node electron/build.js app-expo [build]` / `./cmd appexpo [build]`，复用既有前端编译并同步至 `assets/web/`，写入 version / codeVerson；`./cmd appexpo npm ...` 使用本机 Node 在新壳目录执行。保留 public API 占位、相对资源 base 与 localhost hash 路由。新增仅 workflow_dispatch 的 `app-internal.yml`：Android Release 可用 keystore 或退化 debug 签名，iOS 支持 ad-hoc / development、双 profile / App Group 校验，无签名材料时跳过；仅上传 artifact。独立 app-internal Environment 沿用 iOS secrets 名称，避免覆盖旧 build 环境的 App Store profiles。旧 eeui 入口、构建与正式发布 workflow 均未改动。

验证：实际前端构建成功，1,630 个文件、133 个 manifest 条目及 2,791 处相对 JS import 的资源映射通过；隔离副本双端 clean prebuild 通过，包内资源逐字节一致。iOS 签名 config mod 的双 target / 重复执行检查及 9 组合成 profile 校验通过。actionlint 1.7.12、JS / Bash / Python 语法、PHPStan、语言检查、子模块类型检查 / lint 通过；主前端 lint 为 0 error、103 条存量 warning。工作区已恢复原占位 HTML 和已追踪 version.json，未保留本批编译产物。

待办：在 GitHub 配置 app-internal Environment 及 secrets 后手动运行 workflow（子模块已在主仓库 dev 分支登记）。本机无可用原生构建环境，未执行真实 APK / IPA 编译签名或包内模式设备验收。完整命令、secrets、文件清单与验证边界见 [X4 构建报告](x4-build-report.md)。

### 2026-10-17 X3 / M3 原生 Agora 会议

新增 `src/features/meeting`、会议路由、可拖动悬浮条、Android 本地 Expo 保活模块及 CNG 插件，使用精确锁定的 `react-native-agora@4.6.4`。保留 startMeeting / updateMeetingInfo 参数和六种事件字段，实现音视频网格、媒体控制、邀请、最小化恢复、退出确认、后台语音和资源清理；未加入推送或来电功能。

验证：类型检查、lint、20 项 Node 行为测试、隔离副本双端 clean prebuild 和 RN 0.88 双端 codegen 通过；已检查权限、iOS audio/voip、Android 前台服务及插件幂等。仓库内未生成 ios/、android/。本机无可用 Android SDK / 系统 JDK，Linux 无 Xcode，尚未完整编译或进行真实通话/后台验收。

旧源码/act 对照、依赖依据、可应用 diff 和设备验收清单见 [X3 会议报告](x3-meeting-report.md)。

### 2026-10-17 X3 / X4 集成与双端验证

- 接入：`src/bridge/modules/index.ts` 注册 meeting，`_layout.tsx` 在 Stack 外挂载 `MeetingOverlay`。tsc、lint、会议 20 项测试通过。
- 🔧 iOS：`react-native-agora@4.6.4` 以 `#import "RCTBridge.h"` / `"RCTFabricComponentsPlugins.h"` 引用 React 头文件，RN 0.88 预编译 Core 下找不到；新增 `patches/react-native-agora+4.6.4.patch` 改为 `<React/...>`。
- 🔧 Android：`dootask-meeting` 模块缺少 `react-android` 依赖（ReactApplication / DeviceEventManagerModule 无法解析），且 `appContext.reactContext` 是普通 Context，需转 `ReactContext` 才能 `getNativeModule`；已修复。
- ✅ 双端 Mac mini 模拟器 debug 构建通过。以假 appid 调用 `startMeeting`：iOS 会议页（网格、控制栏、相机权限申请）正常显示；Android 依次申请附近设备权限、提示“无法加入会议”，并回传失败事件，前端弹出“加入会议失败”。
- M4 构建链路复核：主仓库 `cmd` / `electron/build.js` 的新增分支仅作用于 `app-expo`，旧 eeui 流程不变。

未验证：真实通话（需前端会议入口获取的 token）、多人视频网格、最小化悬浮条、后台语音与 Android 保活通知、划掉任务后释放引擎；iOS `voip` 后台模式在二期上架前需结合 PushKit 复核；Android 会议错误弹窗按钮为系统默认 “OK”。包内 Release 模式（本地 Web 服务、旧缓存迁移、冷启动深链）仍待 workflow 出包后真机验证。

## 键盘避让（页面级兼容）

- 原因：eeui Android 用 `adjustResize` 让窗口随键盘缩小；SDK 58 强制 edge-to-edge 后 `adjustResize` 不再生效，WebView 不缩小，聊天输入框被键盘盖住。
- 修复：新增 `src/native/KeyboardInset.tsx`（react-native-keyboard-controller 的 `KeyboardAvoidingView`，padding 模式 + `automaticOffset`），根布局挂 `KeyboardProvider`；主页面与子页 WebView 外层包裹。主页面传 `edgeToEdge`，少抬一个底部安全区，让前端 `--navigation-bar-height` 占位藏在键盘后面（与 eeui 上报 `keyboardHeight = IME - safeAreaBottom` 一致），消除输入框与键盘间的空隙。
- iOS 保持 WKWebView 原生行为（eeui 同样不改尺寸），主页面补 `hideKeyboardAccessoryView` 对齐 eeui `hiddenDone`。
- ✅ Android 模拟器验证：聊天页点输入框后输入框紧贴键盘上方、可正常输入，收起键盘后布局恢复。

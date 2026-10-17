# X1 桥方法与二级页面实现记录

本记录只覆盖 eeui / webview 模块、sendMessage 和二级页面导航。原生 Web 服务、缓存迁移、appUniqueId、深链、goDesktop、X2 和 M3 由其他任务负责。本批未安装依赖、未修改原生工程、未操作 Git 暂存区或提交。

## 文件清单

| 文件 | 作用 |
|---|---|
| `src/bridge/modules/eeui/index.ts` | 注册 alert、toast、openWeb、常亮、键盘、剪贴板、空实现、安全区及设备信息 |
| `src/bridge/modules/eeui/device.ts` | 对齐两平台安全区单位和设备信息字段 |
| `src/bridge/modules/eeui/openWeb.ts` | 系统浏览器 / 系统协议打开 |
| `src/bridge/modules/eeui/ToastHost.tsx` | iOS 浮层宿主和 Android ToastAndroid |
| `src/bridge/modules/webview/index.ts` | 注册本批 webview 方法 |
| `src/bridge/modules/webview/state.ts` | `PageHandle.state` 内的页面状态、控制器、URL、快照和清理 |
| `src/bridge/modules/webview/overrides.tsx` | 按 pageName 绑定的 Hook、WebView props、截图容器和快照覆盖层 |
| `src/bridge/modules/webview/scripts.ts` | 可恢复的滚动 / 选择拦截，页面加载后重放 |
| `src/bridge/modules/webview/pageOptions.ts` | 语言缓存、标题过滤、localhost 判断 |
| `src/bridge/messages/index.ts` | 注册本批 sendMessage action |
| `src/bridge/messages/theme.ts` | 应用主题缓存、状态栏和背景色；保留系统主题的同步语义 |
| `src/app/web.tsx` | 返回、标题、更多菜单、进度条、参数及目标 URL 白名单 |
| `src/app/index.tsx` | 最小接入覆盖 props、onPage、截图容器和覆盖层 |
| `src/devtools/x1BridgeChecks.cjs` | 使用已安装 TypeScript 和 Node 内置工具运行的无设备回归 |
| `docs/bridge-inventory.md`、`docs/progress.md`、本文件 | 契约修正、实现状态、验证及集成事项 |

`BridgeWebView`、桥协议 / 分发 / 存储、`modules/core.ts`、`_layout.tsx`、`bridgeTestHtml.ts` 均未被本批修改。`web.tsx` 原有生命周期 effect、usePageActive、返回键监听、setPageCloser 和关闭清理保持原样。

## 对照旧实现的依据

下表路径相对于 `resources/app`。为缩短路径，`I` 代表 `../mobile/plugins/eeui/framework/ios/eeui`，`A` 代表 `../mobile/plugins/eeui/framework/android/src/main/java/app/eeui/framework`。

| 方法 / action | 旧实现（文件:行） | 本批行为 |
|---|---|---|
| alert | `I/Module/eeuiAlertManager.m:44`；`A/extend/module/eeuiAlertDialog.java:33` | 对象或标题字符串；默认按钮“确定”、cancelable=true；确认回传 null，取消只释放桥回调 |
| toast | `I/Module/eeuiToastManager.m:24`；`A/extend/module/utilcode/utilcodeModule.java:55` | 字符串 / 对象、top/middle/bottom、long；iOS 保留颜色及 point 偏移；Android 偏移按 750 设计宽度转物理像素 |
| openWeb | `I/Module/eeuiNewPageManager.m:669`；`A/ui/eeui.java:943` | Linking.openURL，交给系统打开 |
| keepScreenOn | `I/Module/eeuiModule.m:929` | expo-keep-awake，应用级专用 tag |
| keepScreenOff | `I/Module/eeuiModule.m:935` | 释放同一 tag |
| keyboardHide | `I/Module/eeuiModule.m:840` | 调用者 WebView 的 activeElement.blur + Keyboard.dismiss |
| copyText | `I/Module/eeuiModule.m:436` | expo-clipboard 写文本 |
| checkUpdate | `I/Module/eeuiModule.m:375`；`../assets/js/functions/eeui.js:151` | 按一期约定注册空实现 |
| shakeToEditOn | `I/Module/eeuiModule.m:959` | 按一期约定注册空实现 |
| shakeToEditOff | `I/Module/eeuiModule.m:965` | 按一期约定注册空实现 |
| getSafeAreaInsets | `I/Module/eeuiModule.m:729`；`I/Utility/DeviceUtil.m:726`；`A/extend/module/eeuiScreenUtils.java:82` | `{status:'success', top, bottom, width, height}`；iOS 是 point，Android 是物理像素 |
| getDeviceInfo | `I/Module/eeuiModule.m:746`；`A/ui/eeui.java:1236` | status/manufacturer/brand/model/modelName/deviceName/systemName/systemVersion；Android 与 iOS 16+ 的 deviceName 为空 |
| webview.setUrl | `I/Component/eeuiWKWebViewComponent.m:617` | 当前页面加载；同 source 或当前文档的 URL 仍可重新加载；非 Web 协议交给系统 |
| createSnapshot | `I/Component/eeuiWKWebViewComponent.m:482` | captureRef 截取 WebView 容器；回调是 boolean，一次回调即释放 |
| showSnapshot | `I/Component/eeuiWKWebViewComponent.m:505` | 有截图时才显示当前页覆盖层，不会显示其他页面截图 |
| hideSnapshot | `I/Component/eeuiWKWebViewComponent.m:515`；`../assets/js/App.vue:657`、`:680` | 隐藏当前页快照，并使正在生成的旧快照失效；新截图替换、页面销毁时释放临时文件 |
| setHapticBackEnabled | `A/extend/view/ExtendWebView.java:680` | 仅 Android 记录页面开关；待原生转发，见下节 |
| setDisabledUserLongClickSelect | `A/extend/view/ExtendWebView.java:101`、`:688` | 仅 Android 主文档的选择 / contextmenu 拦截，可恢复；完整原生长按拦截待补 |
| setScrollEnabled | `I/Component/eeuiWKWebViewComponent.m:732`；`A/ui/module/WebviewModule.java:86` | WebView prop + 网页滚动事件 / overflow 控制；恢复时清除自有样式 |
| initApp | `../mobile/src/pages/index.vue:238` | 完整消息保存到 bridgeStore 变量 appMessage；不初始化推送，不打印登录态 |
| windowSize | `../mobile/src/pages/index.vue:336`；`../mobile/src/pages/web.vue:284` | width / height 按整数写入 windowWidth / windowHeight |
| updateTheme | `../mobile/src/pages/index.vue:209`、`:328`；`../mobile/src/pages/web.vue:169` | 缓存 themeDefault / themeName；状态栏、WebView 与导航配色使用应用主题；getThemeName 继续返回系统主题 |
| callTel | `../mobile/src/pages/index.vue:283` | 系统 tel: 链接 |
| setVibrate | `../mobile/src/pages/index.vue:257`；`../mobile/plugins/eeui/deviceInfo/android/src/main/java/eeui/android/deviceInfo/module/device_vibration/VibrationModule.java:27`；`../mobile/plugins/eeui/deviceInfo/ios/eeuiDeviceInfo/Classes/AppVibration.m:34` | Android 指定毫秒或默认 500ms，iOS 系统振动 |
| gotoSetting | `../mobile/src/pages/index.vue:279` | Linking.openSettings |
| setUmengAlias | `../mobile/src/pages/index.vue:246` | 按一期范围只打印 action 日志，不发网络请求 |
| delUmengAlias | `../mobile/src/pages/index.vue:252` | 按一期范围只打印 action 日志，不发网络请求 |
| setPageData | `../mobile/src/pages/web.vue:267` | 合并调用页面的 pageData，参数 / URL / 菜单数据参与展示；修改 url 不会自动触发导航，与旧 this.url 一致 |
| createTarget | `../mobile/src/pages/web.vue:273`、`:311` | 只允许 http/https/mailto/tel/callto；在当前页加载，非 Web 协议交给系统 |
| openUrl | `../mobile/src/pages/web.vue:280` | 系统打开 URL |
| 二级页导航 / 更多菜单 | `../mobile/src/pages/web.vue:198`、`:226`、`:81` | 左侧关闭页面；按历史状态显示后退 / 前进；非 localhost 显示浏览器打开；刷新使用当前记录的 URL；菜单文案来自 languageWeb* 缓存 |
| titleFixed / 标题过滤 | `../mobile/src/pages/web.vue:70`、`:293`；`../assets/js/store/actions.js:1384` | titleFixed 时保留调用者 pageTitle；否则忽略 HitoseaTask/DooTask/about:blank/App 并采用有效网页 title；未提供 pageTitle 时使用缓存 updateDefaultTitle |
| urlFixed | `../mobile/src/pages/web.vue:71`、`:305` | 不跟随网页 URL 更新菜单 URL，网页内部导航仍然允许 |
| showProgress | `../mobile/src/pages/web.vue:72`；`I/Component/eeuiWKWebViewComponent.m:635` | 按加载进度显示顶部进度条 |
| allowAccess | `../mobile/src/pages/web.vue:73`；`I/Component/eeuiWKWebViewComponent.m:132`；`A/extend/view/ExtendWebView.java:729` | 文件访问 props；Android 同时启用旧实现使用的 universal file access，iOS 不额外启用 universal access |
| hiddenDone | `../mobile/src/pages/web.vue:74`；`I/Component/eeuiWKWebViewComponent.m:658` | 对应 hideKeyboardAccessoryView，Android 按旧约定无效果 |

旧 Android 的快照接口原本是空实现（`A/ui/module/WebviewModule.java:143`），本批按新清单也为 Android 接入 captureRef。BOOL 回调依据旧 iOS 的实际行为，修正了清单原先的 `{status}` 描述。安全区单位也按源码修正，未使用统一乘倍率的猜测。

## 集成方需要处理的事项

Toast 宿主已写好，受任务归属限制未修改 `_layout.tsx`。根布局还需使用应用主题，避免缓存主题在重启或系统主题切换后被系统主题样式覆盖。diff 如下（已由集成方应用）：

```diff
--- a/src/app/_layout.tsx
+++ b/src/app/_layout.tsx
@@ -1,11 +1,13 @@
 import { Stack } from 'expo-router';
 import { StatusBar } from 'expo-status-bar';
 
-import { useBridgeRuntime, useThemeName } from '../bridge/hooks';
+import { useBridgeRuntime } from '../bridge/hooks';
+import { useAppTheme } from '../bridge/messages/theme';
+import { ToastHost } from '../bridge/modules/eeui/ToastHost';
 
 export default function RootLayout() {
   useBridgeRuntime();
-  const themeName = useThemeName();
+  const { themeName, backgroundColor } = useAppTheme();
 
   return (
     <>
@@ -13,9 +15,10 @@
       <Stack
         screenOptions={{
           headerShown: false,
-          contentStyle: { backgroundColor: themeName === 'dark' ? '#131313' : '#ffffff' },
+          contentStyle: { backgroundColor },
         }}
       />
+      <ToastHost />
     </>
   );
 }
```

末尾新增 ToastHost 的位置是 Stack 之后；StatusBar 原有的 `style={themeName === 'dark' ? 'light' : 'dark'}` 可以继续使用。此 diff 只涉及根布局，可与原生任务的初始化 Hook 合并。

Android 长按有两项原生缺口，清单均标为 🟡：

1. 旧 `setHapticBackEnabled` 直接调用 Android `View.setHapticFeedbackEnabled`。已检查已安装 WebView 14 的 WebViewTypes、RNCWebViewNativeComponent、Android manager 及 JS imperative handle，均没有对应 prop 或 command。目前开关保存在当前页 `webview.overrides.values.hapticBackEnabled` 中，尚未改变系统振动。需要由原生负责人通过 Expo 本地模块 / config plugin 提供按具体 WebView 设置的适配器，再由本 Hook 转发该开关；不能传一个不存在的 RN prop 假装成功。
2. `setDisabledUserLongClickSelect` 已实现主文档样式、事件和原生 menuItems 空菜单，但主文档脚本无法控制跨域 iframe 内的文本选择。若要求与旧 `setOnLongClickListener` 完全一致，需要同一适配器在 Android WebView 层消费长按事件。恢复时应还原原监听器，不能阻断网页已有的 JS 长按处理。

## 验证

运行：

```bash
npx tsc --noEmit
npx expo lint
node src/devtools/x1BridgeChecks.cjs
```

- 类型检查通过。
- `npx expo lint` 全仓通过（0 error、0 warning）。
- 7 组无设备回归通过：注册、Alert / 释放、系统 API 调用参数、两平台单位与设备字段、主题 / 登录态 / 尺寸快照、URL 与 pageData 隔离、白名单、快照异步竞争 / 清理，以及滚动 / 选择恢复。
- 原 `bridgeTestHtml.ts` 的全部脚本断言在 VM 中为 **19/19**；WebView、路由、时钟和原生 API 使用替身。原自测文件未改动。这不能替代模拟器上的 Router 生命周期和 WebView 注入时序验证。
- 根布局补丁已通过 `git apply --check`，随后由集成方应用。
- 本批没有新增 / 修改 native 代码，未运行 prebuild 或原生编译。没有运行本批代码的模拟器或真机，不把其他批次的设备结果当作本批验收。

## 模拟器 / 真机手测清单

1. 接入根布局 diff 后，在 iOS / Android 打开 `dootask://bridge-test`，确认 19/19；重复打开子页，检查 ready/create/start/resume/pause/stop/destroy 顺序及 pause 时跨页变量读取。确认原 Android 返回键拦截、首页返回、子页关闭流程。
2. Alert：对象 / 字符串、默认按钮、自定义按钮、cancelable；确认按钮只回调 null 一次。Toast：iOS 所有路由均可显示、不阻断触摸；top/middle/bottom、短 / 长提示、连续消息、键盘打开时的位置；Android 不同系统版本的 gravity 表现。
3. 真实设备验证剪贴板、常亮开关及软键盘关闭；iOS 在不同系统版本、Android 在静音 / 非静音模式验证系统振动；测试电话、邮件、callto、系统浏览器和应用设置。模拟器通常不能验证实际呼叫和振动。
4. iOS 带刘海 / iPad 横竖屏与分屏、Android 不同像素密度 / 导航方式，检查安全区回调的 top/bottom/width/height；验证设备信息字段和 iOS 16+ / Android 空设备名。
5. 同时打开两个二级页面：分别调用 setUrl、滚动 / 选择开关、快照和 setPageData，确认互不串页；关闭后重新打开不残留截图或页面状态。
6. 按 App.vue 的 500ms 后台时机反复切换前后台；确认快照回调 typeof 为 boolean，show 只在 true 后有效；前台 hide 后旧截图不会再次覆盖；检查截图实际内容、缩放、键盘 / 视频 / WebGL 画面以及 Android / iOS 后台截图失败分支。
7. 普通文本、输入框、富文本编辑器、网页自己的长按菜单验证禁用选择及恢复，刷新后状态仍有效；跨域 iframe 和系统长按振动按上面的原生缺口验收，不能直接判定通过。滚动开关应测试根文档和嵌套滚动区域。
8. 二级页验证返回关闭、更多菜单显隐、历史后退 / 前进、点空白收起、localhost 不显示浏览器打开、刷新；修改 languageWeb* 后重新打开菜单，检查文案。
9. 分别切换 titleFixed / urlFixed / showProgress / allowAccess / hiddenDone；固定标题用调用方 pageTitle，非固定标题忽略保留词；重定向后 urlFixed 的浏览器打开 / 刷新仍使用固定 URL。用定位签到、文件预览和外链覆盖真实调用。
10. 二级页 target=_blank、window.open 与 sendMessage.createTarget 均需留在当前页；允许 http/https/mailto/tel/callto，拒绝 javascript/data/file/自定义 scheme。首次打开的 params.url 仍允许自测页的 data URL，白名单只针对 createTarget。
11. 在应用主题与系统主题不同的情况下切换亮 / 暗、重启、开关子页，验证状态栏、导航文字、背景及缓存；getThemeName 应继续返回系统主题。initApp / windowSize 应可在其他 WebView 的同步快照中读取相同值。

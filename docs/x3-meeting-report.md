# X3 / M3 App 内原生会议

实现 Agora 原生会议路由、WebView 消息注册、会话控制和可拖动的会议悬浮条。前端参数与六类 `__onMeetingEvent` 事件保持旧契约。接口实现已完成，**注册入口和根布局接入尚待集成方应用**；双端完整原生构建、音视频通话及后台保活尚未进行设备验收。

本批没有修改 `src/bridge/**`、首页、根布局、二级 WebView、其它 features 或 patches；旧 eeui 和 Vue 前端只读参考。没有执行暂存、提交、推送、建分支或 stash。工作区其它批次的改动保持原样。

## 依赖与新架构依据

新增并锁定 `react-native-agora@4.6.4`，执行 `npx expo install react-native-agora@4.6.4`。查询日期为 2026-10-17：npm 的 latest 为 4.6.4；该版本 changelog 标注发布日期 2026-09-03。它同时提供 RTC 引擎和 Fabric 视频视图，Expo 官方目前没有对应会议模块，因此使用 Agora 官方维护的 React Native SDK。

依据：

- [npm 4.6.4](https://www.npmjs.com/package/react-native-agora/v/4.6.4) 与 [官方版本 changelog](https://github.com/AgoraIO-Extensions/react-native-agora/blob/v4.6.4/CHANGELOG.md)。官方 changelog 的 4.2.0 已列出 `support new arch`；4.6.4 延续 TurboModule/Fabric 实现。
- [官方新架构运行说明](https://github.com/AgoraIO-Extensions/react-native-agora/blob/v4.6.4/CONTRIBUTING.md)；[包配置](https://github.com/AgoraIO-Extensions/react-native-agora/blob/v4.6.4/package.json) 的 `codegenConfig` 为 `AgoraRtcNgSpec`，iOS 注册 `AgoraRtcSurfaceView`，Android Java 包名为 `io.agora.rtc.ng.react`。
- 安装包源码包含 iOS 的 `RCT_NEW_ARCH_ENABLED` / `RCTComponentViewProtocol` / TurboModule，以及 Android 新架构 spec 和 Fabric view manager。已用本仓 RN 0.88 的 codegen 成功生成双端代码，另按 Android Gradle 的实际 Java 包名单独生成并确认 `NativeAgoraRtcNgSpec`。
- RN 0.88 本地类型和原生源码已核对：Expo Router 的 `usePreventRemove` 返回禁用函数，RN 的 ReactHost / getNativeModule / ReactModuleInfo 兼容入口均仍存在。没有发现需要关闭新架构或 patch 的已确认不兼容，因此没有改成直接封装 RTC SDK 的 Expo 模块。

**这些依据支持选用该 SDK，不代表已经证明 RN 0.88 上双端原生编译和运行通过。官方资料未提供针对 0.88 的逐版本验收保证；最终以构建机和真机结果为准。**

| 层 | 本批版本 | 旧壳依据 |
|---|---|---|
| React Native SDK | 4.6.4，package.json 精确锁定 | 旧壳直接使用原生 SDK |
| Android RTC / Iris | `full-sdk:4.6.4`、`iris-rtc:4.6.4-build.6`，由 RN 包引入 | `plugins/eeui/agoro/android/build.gradle:46` 使用 lite-sdk 4.5.2 |
| iOS RTC / Iris | `AgoraRtcEngine_iOS:4.6.4`、`AgoraIrisRTC_iOS:4.6.4-build.6`，由 RN 包引入 | `plugins/eeui/agoro/ios/eeuiAgoro.podspec:26` 为 `~> 4.6` |
| Android 保活 | 本地 Expo 模块 `dootask-meeting`，无新增 npm 依赖 | KeepLiveService |

保活模块用 `create-expo-module@latest --local` 脚手架创建，仅保留 Android。其 Gradle 依赖现有 `:react-native-agora` 项目，用于 Runtime 销毁或任务移除时释放同一个 Iris 引擎，没有再引入另一套 Agora SDK。RN 包本身包含屏幕共享原生依赖；本批没有开放屏幕共享或 mediaProjection 服务。

## 旧源码对照与行为

以下旧路径均相对于主仓库 `resources/mobile/`；前端路径相对于主仓库 `resources/assets/js/`。

| 功能 | 旧源码行号 | 本批实现 |
|---|---|---|
| startMeeting 的所有参数 | 前端 `pages/manage/components/MeetingManager/index.vue:350–385` | `params.ts` 保留 name/token/channel/uuid/appid/avatar/username/video/audio/meetingid/sharelink/alert；支持对象或 JSON，严格识别 boolean/0/1 字符串，uid 按 uint32 处理 |
| 消息分发 | `src/pages/index.vue:319–325` | `index.ts` 副作用注册 startMeeting / updateMeetingInfo；不向 Router 参数传 token |
| 事件回传 | `src/pages/index.vue:418–421`；前端 `App.vue:734–789` | `PageHandle.invokeWindow('__onMeetingEvent', event)` 回到调用来源 WebView；字段见下一节 |
| 入会及本地初始开关 | `src/pages/compoment/meetings.vue:525–555`；Android `client/AgoraRtcPresenter.java:110–127`；iOS `eeuiAgoroAppModule.m:97–110` | 通信模式、自动订阅远端音视频，初始不发布关闭的轨道；uid=0 时后续事件使用 SDK 分配的真实 uid |
| iOS 视频编码 | iOS `eeuiAgoroAppModule.m:69–79` | 960×720、30fps、标准码率、自适应方向、自动镜像，与旧 iOS 一致 |
| 本地/远端网格与绑定 | `meetings.vue:9–26、424–492、638–650`；Android `client/Event.java` 及 presenter 的 local/remote 绑定事件 | 可滚动多用户网格，Android 使用 Fabric RtcTextureView 支持裁切/覆盖，iOS 使用 RtcSurfaceView；头像、姓名、音视频与异常状态 |
| 用户加入/离开、媒体状态 | Android `AgoraRtcPresenter.java:295–370`；iOS `eeuiAgoroAppModule.m:223–295` | SDK 回调驱动；重复 join 去重；早于 join 的媒体回调也请求信息；offline 后迟到的媒体回调不恢复幽灵用户 |
| 用户信息补全 | `meetings.vue:589–594、668–694`；前端 `App.vue:741–762` | getInfo 的 uuid 为字符串，前端游客/普通用户查询逻辑不变；updateMeetingInfo 按规范化 uid 合并，缺失字段不覆盖，信息可先于用户入会到达 |
| 摄像头、静音、翻转 | `meetings.vue:571–579、620–622`；Android presenter `171–205`；iOS `eeuiAgoroAppModule.m:168–183` | enableLocalAudio / enableLocalVideo 同步停止采集，updateChannelMediaOptions 同步发布轨道；失败尝试回滚；摄像头翻转 |
| 扬声器 | Android presenter `227–235`、app module `155–160`；iOS module `110` 为旧默认路由注释 | 默认扬声器，提供扬声器/听筒切换；SDK 路由事件反映耳机状态，蓝牙权限拒绝不阻止参会 |
| 最小化、拖拽恢复、邀请 | `meetings.vue:52–64、558–569、581–586、627–629、697–749` | 会议归属 PageHandle，不随路由缩小而结束；悬浮条拖拽吸边、点按恢复；邀请先缩小再发 invent，让 WebView 显示原邀请窗口 |
| 离开确认与结束 | `meetings.vue:503–519、634–635`；Android presenter `133–166`；iOS `eeuiAgoroAppModule.m:130–165、306–313` | 完整使用参数 alert；取消继续会议；确认后解除监听、离开/释放引擎、关闭保活和常亮，发送 status/endMeeting |
| 常亮和状态 | `meetings.vue:402–408` | 入会后在 App 前台保持常亮，最小化也保留；后台释放常亮，回前台重新申请；最小化和后台均不发 status=false |
| Android 后台 | `module/eeuiAgoroAppModule.java:191–226`；`entry/ActivityLifecycleListener.java:56–72`；`service/KeepLiveService.java` | 入会前在前台启动并等待服务提升完成，整个通话期间保留；避免复制旧版进入后台后再启动服务的方式，以满足 Android 14+ 限制 |
| 返回键 | 旧会议为首页上的覆盖组件 `src/pages/index.vue:13–19`，没有独立 RN 路由 | 新页 `useFocusEffect` 监听 hardwareBackPress，弹离开确认；禁用关闭手势，用 SDK 58 的 usePreventRemove 阻止导航误关 |

会话、SDK 引擎、回调、参与者资料和计时器均保存在 `PageHandle.state` 的 session 内。仅通过 bridgeStore 的修订变量通知根布局查找活动会议；token、channel 和参与者信息不进入全局快照。源 WebView 被移除时清理会议；Strict Mode 重挂不会重复入会。

页面内新增文字按 `initApp.appMessage.language` → bridgeStore 的 language 缓存（兼容分享模块 JSON 包装）→ 系统语言取值，采用与 media/strings 相同的简中/繁中/英文回退。离开弹窗优先完整采用前端已翻译的 alert，其它语言的这四段文案不会被原生翻译替换。会议页采用深色网格布局，图标按钮以无障碍标签补充说明。

## 全部 act 及字段对齐

下表是旧 Weex 会议页发给前端的全部 act；原生 SDK 的 joint/leave、`{uuid:'me',type,status}` 和 localStatus 属于插件内部事件，不直接传给 `__onMeetingEvent`。

| act | 精确数据结构 | 旧 meetings.vue | 本批触发时机与前端用途 |
|---|---|---|---|
| getInfo | `{act:'getInfo', uuid:string}` | 589–594（453–455 调用） | 新远端用户加入时一次；前端根据 uuid 查询 tourist 或 users/basic，回发 updateMeetingInfo |
| success | `{act:'success', uuid:string}` | 597–602（548 调用） | SDK 真正入会成功；前端关闭添加会议窗口；SDK 重连不重复发 success，同会议的显式重复 start 可重发以结束前端加载 |
| invent | `{act:'invent', meetingid:string}` | 581–586 | 点邀请后；必须保留旧拼写 invent；前端打开 invitation 窗口 |
| endMeeting | `{act:'endMeeting', uuid:string}` | 503–513 | 离开或失败清理完成时一次；使用本地实际 uid |
| error | `{act:'error', uuid:string}` | 605–610（497–498 调用） | 无效参数、授权/服务/加入失败、连接失败或 token 失效；前端 closeMeetingWindow('error') |
| status | `{act:'status', status:boolean}` | 402–408 | 加入成功 true；原来已可见的会议结束 false；缩小、邀请、进后台仍为 true；前端设置 appMeetingShow |

正常顺序：status(true) → success → 若干 getInfo / invent → status(false) → endMeeting。已经建立 JS 会话但尚未加入的失败发送 error → endMeeting，不产生虚假的 status(true)；参数校验或并发拒绝只发送 error，不改变现有会议状态。同一场会议重复开始复用会话；另一场开始被拒绝并发送 error，保留正在进行的会议。Agora 连接失败的内部状态在两端统一归一，修正旧 Android 把 state 包在对象中、Weex 却按数字判断的问题。

本期没有 token 更新契约，因此只在即将过期时提示，实际过期后 error 并清理，让用户重新入会；没有私自增加前端 action 或后台请求。没有实现推送、PushKit/CallKit 来电、DooPush 或呼叫唤醒。

## 原生配置和生命周期

`app.config.ts` 仅追加 `./plugins/with-meeting`。

- iOS：通过 config plugin 确保相机/麦克风用途说明，以及 `UIBackgroundModes` 的 audio、voip。后台保留语音，暂停本地摄像头采集，回到前台按用户开关恢复。没有添加 APNs entitlement 或 remote-notification 模式。
- Android：CAMERA、RECORD_AUDIO、MODIFY_AUDIO_SETTINGS、ACCESS_WIFI_STATE、BLUETOOTH_CONNECT、FOREGROUND_SERVICE 及 CAMERA/MICROPHONE/MEDIA_PLAYBACK 三个子权限；旧 BLUETOOTH 限制到 API 30。按需要请求相机/麦克风，Android 12+ 蓝牙授权可拒绝。
- 服务声明为 `camera|microphone|mediaPlayback`、exported=false。仅收听使用 mediaPlayback，只有已获授权且实际需要的类型才加入 startForeground 参数；打开新轨道前先升级类型。服务提升成功后才启动 Agora。
- Android 服务通知使用独立低重要性 channel，点击回到现有 App；不触发通知授权请求。退出即撤销，START_NOT_STICKY 不自动复活已结束的通话。`stopWithTask=false` 让 onTaskRemoved 执行：先释放 Iris，再通知对应 JS 会话结束，随后停止服务；Runtime 销毁也有原生清理兜底。
- 项目最低 Android API 24：API 24/25 使用 startService 和旧版 Notification.Builder；API 26+ 使用 startForegroundService 和通知 channel；API 29+ 才传入前台服务类型。
- 原生 start/stop 和任务事件携带会话标识，旧请求的迟到结果不会停止新会话。权限框关闭与 AppState active 乱序时先等前台（最多 30 秒），不会在后台开始新的相机/麦克风服务。加入 SDK 后 45 秒仍无成功回调会失败清理。

Android 启动时机依据：[Android 官方后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)及[前台服务类型要求](https://developer.android.com/develop/background-work/services/fgs/service-types)。实际后台音视频仍须按下方设备矩阵验收。

## 文件清单

| 文件 | 内容 |
|---|---|
| `src/features/meeting/index.ts`、`registry.ts`、`runtime.ts` | 两个 action 注册、会话查找/互斥、路由、bridgeStore 通知 |
| `src/features/meeting/session.ts`、`permissions.ts` | RTC 状态、媒体控制、权限、生命周期和资源释放 |
| `src/features/meeting/params.ts`、`events.ts`、`participants.ts`、`strings.ts` | 参数/语言解析、精确事件、用户信息合并和文案 |
| `src/features/meeting/MeetingScreen.tsx`、`MeetingOverlay.tsx` | 全屏会议页和可拖动悬浮条 |
| `src/features/meeting/__tests__/meeting.test.cjs` | 20 项 Node 行为测试 |
| `src/app/meeting.tsx` | Expo Router 路由导出 |
| `modules/meeting/index.ts`、`package.json`、`expo-module.config.json`、`LICENSE` | 本地 Android Expo 模块入口和元数据 |
| `modules/meeting/android/build.gradle`、`android/src/main/AndroidManifest.xml` | Expo 模块构建，依赖同一 RN Agora 项目；权限/服务由 config plugin 写入 App |
| `modules/meeting/android/src/main/java/expo/modules/dootaskmeeting/{DooTaskMeetingModule,MeetingKeepAliveService}.kt` | 服务启动确认、前台检查、会话隔离、保活和原生释放兜底 |
| `modules/meeting/android/src/main/res/drawable/meeting_notification.xml` | 单色会议通知图标 |
| `modules/meeting/tests/check-prebuild.cjs` | 检查实际生成配置及插件重复执行 |
| `plugins/with-meeting.js`、`app.config.ts` | CNG 原生配置与插件入口 |
| `package.json`、`package-lock.json` | 精确版本的 Agora 及其传递依赖 |
| `docs/bridge-inventory.md`、`docs/progress.md`、本报告 | 接口清单、进度和交付依据 |

## 集成方需要应用的改动

以下文件由集成方维护，本批按任务边界没有修改。两处都需要接入后才能完整使用会议和邀请。

在 `src/bridge/modules/index.ts` 增加注册入口：

```diff
 import '../../features/share';
+import '../../features/meeting';
```

在 `src/app/_layout.tsx` 导入并挂载悬浮条：

```diff
 import { ToastHost } from '../bridge/modules/eeui/ToastHost';
+import MeetingOverlay from '../features/meeting/MeetingOverlay';
@@
       <ToastHost />
+      <MeetingOverlay />
```

它必须挂在 Stack 外，才能在会议路由弹出后覆盖 WebView，并让其它区域继续接收触摸。不应在最小化时结束或卸载会话；引擎由 PageHandle.state 中的 session 管理。无需修改首页/二级页的返回键监听、UA、本地服务地址、Bundle ID 或深链保留清单。

安装依赖并重新生成、构建 development client；旧 dev client 和 Expo Go 都不能直接加载新增的 Agora/本地模块。Mac 上完成双端构建，重点检查 `:dootask-meeting` 到 `:react-native-agora` 的依赖和 Fabric 视图。Android SDK 可用后执行 `cd android && ./gradlew assembleDebug`；iOS 执行正常 CocoaPods/Xcode 或现有 mac-build 流程。

## 已执行验证与边界

- `npx tsc --noEmit`：通过。
- `npx expo lint`：通过，无 error / warning。
- `node --test src/features/meeting/__tests__/meeting.test.cjs`：20 项通过。覆盖真实参数、uint32、六种事件、语言包装、用户信息早到/晚到、重复用户、离线尾部事件、初始禁用轨道、Strict Mode、最小化恢复、离开确认、授权/服务等待中退出、断网重连、失败/过期/超时、开关失败回滚、AppState 乱序和任务移除。
- 在 `/tmp/dootask-x3-meeting-QnZxT5` 隔离副本执行 `CI=1 npx expo prebuild --clean --no-install`：双端生成成功，package.json 无变化。仓库内没有生成 ios/、android/。
- `node modules/meeting/tests/check-prebuild.cjs /tmp/dootask-x3-meeting-QnZxT5`：相机/麦克风说明、audio/voip、Android 子权限、服务类型/非导出/任务移除策略、包名和 Bundle ID、无 aps-environment、重复应用插件不改变生成物，全部通过。
- Expo autolinking 发现本地 `dootask-meeting` 及 `expo.modules.dootaskmeeting.DooTaskMeetingModule`，React Native autolinking 发现 Agora 包。RN 0.88 双端 codegen 通过，Android 再按库配置的 Java 包名生成成功，iOS provider 注册 AgoraRtcSurfaceView。

本机 Android SDK/JDK 环境变量所指目录不存在，未执行 Gradle assembleDebug；Linux 无 Xcode/iOS SDK，未安装 Pods 或编译 iOS。**最终 Kotlin 的 Expo/RN/Agora 生命周期 binding、图标资源打包、SDK 原生链接和真实采集均仍需构建机验证；JS 测试、prebuild 和 codegen 不能替代这一步。** 没有连接真实频道、调用真实会议接口或使用两个客户端实测，不沿用之前批次的模拟器验收结论。

## 设备验收清单

至少两台真实设备（iOS + Android）互相入会；Android 至少覆盖 API 34+，建议再覆盖当前 API 36，并补 API 24/25 的低版本分支。使用测试会议及有效服务端 token。

1. 首次授权：audio/video 四种组合均能入会；未启用的轨道不采集、不发布，仍能收听/观看远端。分别拒绝相机、麦克风、永久拒绝、拒绝蓝牙，核对错误事件与设置入口；授权弹窗期间切后台/返回不会误开采集或产生残留服务。
2. 参加者：双端互看/互听，本地与远端均可关闭/打开音视频；头像和姓名经 getInfo/updateMeetingInfo 补全。普通用户和游客 uid 都正确；重复 join、离开重入、用户超过一屏、横竖屏切换后网格和状态正确。
3. 控制：摄像头前后翻转、静音后远端不可听、关视频后远端显示头像；扬声器/听筒、有线耳机、蓝牙连接/断开及路由恢复。对照系统相机/麦克风指示灯，确认关闭轨道停止对应采集。
4. 邀请：点邀请后会议缩小，前端 invitation 窗口可见且可操作，meetingid 为字符串；音视频持续。悬浮条可拖拽吸边、点按恢复；缩小/恢复不重建引擎，也不发送 status=false。
5. 返回与离开：Android 硬件返回弹参数中的 alert 文案，连续按返回不叠弹窗；点继续不离会，点退出按约定发送 status(false)/endMeeting。iOS 手势不能误关；加入中退出、超时和错误提示后无残留摄像头、麦克风、常亮或通知。
6. 后台：Android Home/锁屏数分钟仍可通话，三类 FGS 运行权限无 SecurityException，通知点击返回原 App；回前台保持会话和开关。iOS 后台/锁屏保留语音，回前台恢复所需视频。另检查系统电话/其它音频占用后的恢复，由 Agora/系统管理音频中断，不引入呼叫功能。
7. 清理：后台退出、源 WebView 被关闭/替换、Android 滑走任务、Runtime 重载/进程被杀后，远端最终看到用户离开、采集指示和通知消失；重新启动不会自动恢复过期会议，下一场正常入会。
8. 故障：断网/切换 Wi-Fi 与蜂窝网络可重连且不重复 success；无效 appid/token、token 实际到期、入会超时、同会议重复 start / 不同会议并发 start 均符合报告行为；旧服务迟到结果不停止新会话。
9. 文案/回归：简中、繁中、英文及另一前端语言的退出 alert；原桥接自测维持 19/19，扫码、预览、分享和 WebView 返回不受影响。确认仍无推送注册或来电唤醒逻辑。

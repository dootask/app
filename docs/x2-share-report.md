# X2 系统分享实现报告

实现日期：2026-10-17。范围为系统“分享到 DooTask”，包含配置缓存、iOS Share Extension、Android 独立分享 Activity、列表/搜索/会话多选/目录导航与上传。尚需集成入口及双端设备验收。

## 方案与依赖

- 使用 `npx create-expo-module@latest --local share` 生成本地 Expo 模块，再实现原生代码；工程修改全部由 `plugins/with-share.js` 在 prebuild 时生成。
- iOS 扩展使用 UIKit、Foundation/URLSession、UniformTypeIdentifiers 和 ImageIO；Android 使用平台 Activity、ContentResolver 与 HttpURLConnection。两端在原生分享页完成上传，主 App 冷启动、运行中或 JS 未加载时均使用同一路径，分享内容不经过 Expo Router。
- 未新增 npm、CocoaPods 或 Maven 直接依赖；根 package.json / package-lock.json 没有本任务改动。保留了工作区原有媒体、通知、WebView 等改动。
- 选择自写 config plugin：这里只需要一个不依赖 RN 的 iOS target，以及一个 Android Activity；现有 Expo config-plugins/node-xcode 足以完成，`@bacons/apple-targets` 对本任务增加依赖而未减少分享业务实现。
- 已检查 SDK 58 的 [expo-sharing 文档](https://docs.expo.dev/versions/v58.0.0/sdk/sharing/)。该版本已支持接收分享，但文档将接收标记为实验功能，iOS 通过扩展打开主 App，且提示这种方式未获 Apple 官方支持。本任务需要延续旧壳在扩展内选目标、上传的流程，因此采用独立原生实现。
- 旧 ObjC 控制器依赖修改版 AFNetworking、MMWormhole、Masonry、SVProgressHUD、SDWebImage、MJExtension，并引用旧工程头文件；直接搬入会引入整套旧依赖。新控制器按原协议重写，复用全部 11 套 iOS `Localizable.strings` 和旧 Android 翻译，并将缺少的翻译从旧 iOS 资源补入 Android；英文等资源中 `sendingSuccessTitle` / `sendingFailTitle` 的旧拼写也兼容处理。

Expo API 依据为当前 `package.json` 的 `expo ~58.0.14`，以及已安装的 `expo-modules-core/src/requireNativeModule.ts`、iOS `Api/Factories/SyncFunctionFactories.swift` 和 Android 的 ModuleDefinition / Function 定义。没有凭旧版 Expo API 实现接收功能。

## 兼容契约

| 前端 action / 字段 | 旧键 | 原生保存方式 |
|---|---|---|
| userChatList.language | language | 非空时覆盖，空值保持原设置 |
| userChatList.url | chatList | 原始 URL 字符串，包含 token |
| userUploadUrl.chatUrl | upLoadUrl | 原始 URL 字符串 |
| userUploadUrl.dirUrl | fileUpLoadUrl | 原始 URL 字符串 |

JS 先通过 `bridgeStore.setCachesString(key, JSON.stringify(value), 0)` 维护 `setCaches` 对应的同步快照，再同步调用本地模块写入原生镜像；没有另建 JS 存储。URL 为空时覆盖旧值，不能因空值而保留旧登录凭据。action 不新增参数、回调或前端函数。

iOS App Group 固定为 `group.im.dootask`，主 App 与扩展 entitlement 一致，扩展 Bundle ID 固定为 `com.dootask.task.shareExtension`。需要纠正参考描述中的一点：旧壳实际使用 MMWormhole 文件传递，而非 UserDefaults。新实现将相同键的字符串写入 App Group UserDefaults，同时保留 `share/<键>.archive` 的 NSKeyedArchiver 根字符串格式；读取优先 UserDefaults，缺失时回退旧 archive。因此覆盖升级后，扩展可以读取旧配置，无需先启动新主 App。未引入 MMWormhole 依赖。

Android 写入旧 SharedPreferences 文件 `eeuiCaches` 的同名键，值为 JSON：`{"chatList":{"chatList":"URL","expired":0}, ...}`。保留不属于分享的条目，读取遵守旧 Unix 秒过期时间。独立 Activity 直接读取此镜像，无需 React 上下文。

两端沿用以下网络协议：

- GET `chatList`，携带 `type=file|text`、`key`；进入目录后 GET 该行 `url`，补 `token`，保留 `pid` 等已有查询参数。
- 会话多选 POST 目标行的 `url`，字段 `token`、逗号分隔的 `dialog_ids`；目录 POST 当前目录行的 `url`，字段 `token`、`upload_file_id`，根目录 ID 0 有效。
- 每个附件一个 multipart 请求，文件字段 `files`，文本/网页 URL 字段 `text`。文本沿用列表返回的 sendtext 地址；混合附件中将 sendfiles 的文本项送到 sendtext。
- 服务端 `ret=1` 才算成功，显示全部成功/失败/部分成功。不会因字节传完而把后端错误算成功；不会自动重发上传。
- iOS 激活规则保留旧限制：文件最多 5 个、图片最多 5 个、视频最多 1 个、网页 URL 最多 1 个，支持文本。Android SEND / SEND_MULTIPLE 接受 application、image、video、audio、text 五类 MIME。
- 目录内容以面包屑导航，文本列表不提供目录。搜索时保留已选会话，丢弃过时的网络响应。原生页面实例持有选中项、任务与临时文件状态。

附件从 item provider / content URI 复制到单次分享的私有缓存，原始提供者回调有效期间即完成必要复制；上传使用流/磁盘文件，不一次性把整份附件放进内存。支持取消并清理缓存，Android 对进程被回收的遗留缓存进行过期清理。Android 不依赖 `_data` 列，也不为接收分享添加广泛存储权限。目录附件按旧行为提示不支持。

## 文件清单

| 文件/目录 | 用途 |
|---|---|
| `modules/share/expo-module.config.json`、`package.json`、`index.ts` | 本地模块注册与同步 TS 接口 |
| `modules/share/ios/DooTaskShareModule.swift`、`ShareStorage.swift` | 主 App 共享配置、UserDefaults 与旧 archive 兼容 |
| `modules/share/ios/DooTaskShare.podspec`、`PrivacyInfo.xcprivacy` | Expo 链接与 App Group UserDefaults 的隐私声明 |
| `modules/share/extension/ShareViewController.swift` | iOS 原生分享 UI、搜索、选择、目录、进度、结束/取消 |
| `modules/share/extension/ShareAttachmentLoader.swift` | NSItemProvider 文件、图片、URL、文本读取与临时复制 |
| `modules/share/extension/ShareTransport.swift` | 列表协议、multipart 流式上传、响应判定 |
| `modules/share/extension/*.lproj/Localizable.strings` | 旧 iOS 的 11 套多语言资源 |
| `modules/share/android/.../DooTaskShareModule.kt`、`ShareSettings.kt` | Expo 方法与旧 eeui 缓存镜像 |
| `modules/share/android/.../ShareActivity.kt` | 独立分享 UI、搜索、目录、状态恢复、生命周期取消 |
| `modules/share/android/.../SharePayload.kt`、`ShareTransport.kt` | Intent/ClipData/URI 处理、缓存复制、HTTP 列表及上传 |
| `modules/share/android/build.gradle`、`src/main/AndroidManifest.xml`、`res/` | Expo Android 模块、独立主题和 12 套语言资源 |
| `modules/share/tests/` | 桥接契约、生成工程检查/插件重复执行、Kotlin HTTP 回归 |
| `plugins/with-share.js` | 生成 iOS target/构建依赖/签名嵌入/资源/App Group/EAS 元数据，追加 Android Activity/filter |
| `src/features/share/index.ts` | 两个 action 副作用自注册 |
| `app.config.ts` | 仅追加 `./plugins/with-share` |
| `docs/bridge-inventory.md`、`docs/progress.md`、本报告 | 状态和验收记录 |

没有修改桥核心、模块总入口、媒体/通知目录、patches、深链文件、主仓库前端或旧壳，也没有手动编辑生成的 ios/、android/。本任务没有 commit、push、建分支或修改暂存区。

## 旧源码依据

以下路径相对于 `/home/coder/workspaces/dootask/resources/mobile`：

| 依据 | 文件与行号 |
|---|---|
| Group 与 share 子目录、主 App 初始化 | `src/pages/index.vue:71`、`:140` |
| 两个 action、双端的四个缓存键、空语言处理 | `src/pages/index.vue:298`、`:309` |
| MMWormhole 根对象写入/读取 | `plugins/eeui/shareFiles/ios/eeuiShareFiles/eeuiShareFilesAppModule.m:25`、`:30`、`:35` |
| 扩展读取 Group/share、language、chatList | `platforms/ios/eeuiApp/shareExtension/share/ShareListViewController.m:87` |
| iOS 附件文件/图片/URL/文本分类 | 同文件 `:293` |
| iOS 列表、token、目录子列表 | 同文件 `:363`、`:415` |
| iOS files/text multipart、ret 结果、目标字段 | 同文件 `:588`、`:659`、`:708` |
| iOS 会话选择、目录、搜索与语言 | 同文件 `:777`、`:815`、`:918`、`:1095` |
| App Group entitlement、扩展激活规则 | `platforms/ios/eeuiApp/shareExtension/shareExtension.entitlements:7`、`Info.plist:9` |
| 扩展 Bundle ID | `platforms/ios/eeuiApp/eeuiApp.xcodeproj/project.pbxproj:932`、`:967` |
| Android 原生分享界面与 intent | `plugins/eeui/share/android/src/main/AndroidManifest.xml:34`；`plugins/eeui/share/android/src/main/java/eeui/android/eeuiShare/activity/ShareActivity.java:91`、`:265` |
| Android 从 chatList 缓存提取 URL/token | 上述 `ShareActivity.java:229` |
| Android 会话多选、目录导航、查询与搜索 | 同文件 `:188`、`:317`、`:359`、`:426`、`:635` |
| Android 上传 token/dialog_ids/upload_file_id/files/text | 同文件 `:516` |
| Android 缓存 JSON 包装与过期值 | `plugins/eeui/framework/android/src/main/java/app/eeui/framework/extend/module/eeuiCommon.java:94`、`:111` |

旧 MMWormhole 的具体归档格式另核对了上游 [MMWormholeFileTransiting.m](https://github.com/mutualmobile/MMWormhole/blob/master/Source/MMWormholeFileTransiting.m)：`<identifier>.archive`，NSKeyedArchiver 根对象，没有额外字典包装。

前端只读依据（相对于 `/home/coder/workspaces/dootask`）：

- `resources/assets/js/store/actions.js:801`：登录信息更新时发送列表/上传 URL，token 在查询参数中。
- `resources/assets/js/functions/eeui.js:342`：语言 `zh → zh-Hans`、`zh-CHT → zh-Hant`。
- `resources/assets/js/App.vue:802`：`__handleLink` 只负责业务路由。本任务分享上传结束后直接关闭原生页，沿用旧壳行为，不调用它。
- `app/Http/Controllers/Api/UsersController.php:2972`、`:2980`、`:3015`：目录行 url 同时用于查询/上传，文本会话使用 sendtext；据此保留行 URL 与 pid，未将所有上传统一硬改成缓存的 sendfiles。

## 验证记录

- `npx tsc --noEmit`：通过。
- `npx expo lint`：通过，无 error。
- `node --test modules/share/tests/bridge.test.cjs`：6/6，通过注册、键映射、JSON 快照、空语言、退出清空、落盘失败、网页环境等断言。
- `CI=1 npx expo prebuild --clean --no-install`：通过。`node modules/share/tests/check-prebuild.cjs` 检查真实生成工程，确认扩展 target、主 App 显式构建依赖、签名嵌入至 PlugIns、四个 Swift 源文件、一个含 11 种语言的 variant group、隐私清单和双方 App Group。
- 同一插件对同一个工程/manifest 对象连续执行两次：target、依赖、资源、Activity/filter 均不重复；构建配置提供的 team 能传入扩展，其他 entitlement 保持；EAS 扩展元数据包含对应 Bundle ID。
- 双端 `expo-modules-autolinking resolve`：均发现 `dootask-share` 与 `DooTaskShareModule`。
- Kotlin 2.2.20 + Android API 36 类库（`org.robolectric:android-all:16-robolectric-13921718`）：`ShareActivity`、`SharePayload`、`ShareSettings`、`ShareTransport` 与测试源码编译通过，JVM target 17。此检查使用临时 R 字符串 ID 替身，不包含 Expo binding 编译，也不执行 aapt / Gradle。
- `ShareTransportTest.kt` 在临时 JRE 21 上执行，8 组回归通过：旧缓存键/包装/保留无关项/过期与清空、附件恢复及目录边界、4 MiB 实际 HTTP 文件 multipart、文本与目录 ID 0、ret=0 / HTTP 500、token/pid/重复参数/编码、列表解码、关闭后禁止请求。SharedPreferences 使用内存代理，HTTP 使用真实本地 HttpServer；未调用生产服务器。API 36 类库使用 Java 21 class 格式，因此用 JRE 21 运行，未修改系统 Java 或仓库依赖。

宿主回归可在准备好上述 Kotlin/Android 类库与标准库后复现：将四个原生 Kotlin 文件、`modules/share/tests/ShareTransportTest.kt` 以及从默认 strings.xml 生成的临时 R ID 一起用 `K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17` 编译，再以 `java --add-modules jdk.httpserver ... expo.modules.dootaskshare.ShareTransportTestKt` 运行。完整原生编译仍以构建机的 Gradle / Xcode 为准。

验证后已删除生成的 `ios/`、`android/`，构建机必须重新 prebuild。

## 未验证项与限制

- Linux 无 Xcode，Swift/iOS 扩展尚未编译，也未进行 iOS 真机/模拟器分享验收；生成工程检查不能代替原生编译和签名验证。
- 本机环境变量指向的 Android SDK 路径 `/home/coder/Android/Sdk` 与 JDK 路径 `/usr/lib/jvm/java-17-openjdk-amd64` 均不存在，不能执行 Gradle assembleDebug。宿主编译/HTTP 测试不能替代 APK 构建、aapt 资源编译、Expo 链接或设备行为验证。
- 冷/热启动通过独立原生入口实现，但尚未在设备上验证；不能沿用此前任务的设备验证结果。
- iOS App Group 的真实设备共享读取、旧版覆盖升级、NSItemProvider 的各类第三方数据提供者，以及 Android SAF/云盘临时 URI 授权，均待设备验收。
- 首次安装且从未登录时，原生页提示先登录；与旧壳一样，需要 App 至少写入一次可用配置。退出登录/服务端 token 失效后不应上传成功。
- 取消只中止客户端未完成工作，已经被服务端接收的文件无法撤回；系统回收进程后不会自动续传/重发。大文件仍需要足够的临时磁盘空间，iOS multipart 会额外占用一份磁盘空间。
- Android 优先使用 content URI；旧 file URI 仅允许公共外部存储，私有目录不会通过导出的 Activity 接收。未为旧式裸路径添加广泛存储授权，现代来源应使用系统 URI 临时授权。

## 需集成方处理

1. 在 `src/bridge/modules/index.ts` 添加一行，启用消息注册（本任务按归属未修改该文件）：

   ```ts
   import '../../features/share';
   ```

2. Apple Developer 后台确认 App IDs `com.dootask.task` 与 `com.dootask.task.shareExtension` 属于同一 team，二者均开启 App Groups 并关联已有 `group.im.dootask`。若延续旧版分发，沿用原 team 与 Group，才能访问升级前的共享容器。
3. 为两个 Bundle ID 配置正确开发/分发 provisioning profile。插件不写死 team；可由 `ios.appleTeamId` / 构建签名配置提供，插件会向扩展传递；EAS 扩展元数据已自动追加。不要在生成的 pbxproj 中维护签名修改。
4. Mac 上重新 prebuild、安装 pods、构建 iOS 主 App（会同时构建扩展），检查扩展签名、主 App 与扩展版本号一致，以及 Share Extension 出现在分享面板。Android 构建并安装带本地模块的新包，不能只更新 JS。
5. 原 `src/native/deepLink.ts` 与 `src/app/+native-intent.tsx` 保持原样：分享 intent 由独立 Activity 消费，iOS 扩展不唤起业务链接。无需为分享再增加深链转发 hook。

## 设备手测清单

- [ ] 登录后确认四个缓存键与语言在原生镜像中正确写入，检查时避免把含 token 的 URL 放进公开日志。
- [ ] 全新安装未登录时从其他 App 分享，显示先登录；登录后分享成功；退出后再分享失败而非沿用旧帐号。
- [ ] iOS 安装旧壳、登录，再覆盖安装新壳，在不先启动新主 App 时打开分享面板，验证 archive 回退与 Group 连续性。
- [ ] iOS 主 App 被结束、在后台、在前台三种状态下，从照片、文件、Safari、备忘录分享，选会话/多个会话并确认服务端收到文件或文本。
- [ ] iOS 最多 5 图片/文件、1 视频，中文/空格文件名、直接 UIImage、网页 URL、纯文本；目录附件显示不支持。
- [ ] Android 主 App 未运行、在后台、在前台三种状态下，测试 ACTION_SEND / SEND_MULTIPLE，以及 EXTRA_STREAM / ClipData，照片、文件、text/plain 文件和纯文本均能区分。
- [ ] Android 使用 SAF/云盘提供者，验证无真实文件路径时也可读取；单个 URI 不可读时有错误提示，取消不留下本次缓存。
- [ ] 搜索包含中文/空格/特殊符号的会话，快速更换关键词，结果不倒退；已选会话在搜索后仍保持选中。
- [ ] 文件目录下钻、点击中间面包屑返回、上传到根目录 ID 0 与多层子目录，确认实际落点正确；文本不出现目录入口。
- [ ] 中英文、繁体、日/韩/其他旧壳语言，切换 App 语言后重新打开分享页，检查按钮、搜索、成功/失败文案；浅/深色主题可读。
- [ ] 断网、列表报错重试、token 过期、ret=0、HTTP 非 2xx、部分文件失败、大文件进度、上传中取消，确认没有自动重发或假成功。
- [ ] Android 分享页旋转/后台恢复，返回原来源；连续分享产生独立实例，互不覆盖附件；中途进程回收后不自动重复上传。
- [ ] 分享后测试 `dootask:///manage/messenger` 冷/热启动业务深链，以及 `dootask://bridge-test`、`dootask://dev-eval?...`，确认原路由仍正常。

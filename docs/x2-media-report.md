# X2 媒体能力实现报告

日期：2026-10-17。范围：eeui 的 `openScaner`、`getLatestPhoto`、`uploadPhoto`、`cancelUploadPhoto`，sendMessage 的 `picturePreview`、`videoPreview`。

扫码、上传 / 取消、图片 / 视频预览已实现。最近照片的数据处理已实现，Android 的“最近”时间语义需要原生补充，清单据此标为 🟡。所有设备行为仍需本批验收；本报告不沿用此前任务的模拟器结果。

## 改动文件

| 文件 | 内容 |
|---|---|
| `src/features/media/index.ts` | 副作用注册四个 eeui 方法和两个 message action；权限检查、router.push |
| `src/features/media/params.ts` | 参数校验、文件路径 / URI 转换、预览索引、缩略图裁切、时间单位转换 |
| `src/features/media/requests.ts` | PageHandle.state 请求表、扫码生命周期、连续扫码节流、格式映射、回调释放 |
| `src/features/media/upload.ts` | SDK 58 UploadTask multipart POST、双端响应、URL 任务 ID、跨页面取消、竞态和释放 |
| `src/features/media/latestPhoto.ts` | 相册授权、Query / Asset、JPEG 原图、thumbnail base64、沙盒文件与资源释放 |
| `src/features/media/useMediaRoute.ts` | 从调用页查找请求、路由销毁清理、前后台 / 焦点状态 |
| `src/features/media/ScannerScreen.tsx` | 相机、手电筒、连续扫码、从图片识别、关闭 |
| `src/features/media/PreviewScreen.tsx` | 多图翻页、初始 position、旋转布局、expo-video 原生控件与暂停 |
| `src/features/media/ZoomableImage.tsx` | PanResponder 双指缩放、放大后平移、重置缩放 |
| `src/features/media/zoom.ts` | 缩放中心、1–6 倍限制、平移边界计算 |
| `src/features/media/strings.ts` | 自定义预览文案：简体、繁体中文及英文回退 |
| `src/features/media/__tests__/media.test.cjs` | Node 内置测试 + 已安装 TypeScript，设备 API 使用替身 |
| `src/app/scanner.tsx` | 新增扫码路由 |
| `src/app/media-preview.tsx` | 新增预览路由 |
| `app.config.ts` | 仅向 plugins 追加 expo-camera、expo-media-library、expo-video 和中文权限配置 |
| `docs/bridge-inventory.md` | 仅修改本批六行 |
| `docs/progress.md` | 末尾追加本批记录 |
| `docs/x2-media-report.md` | 本报告 |

未执行依赖安装，未编辑 package.json、桥核心、既有路由、src/native、modules 或 patches。工作区出现的这些目录的其他变动属于并行任务，未回退或覆盖。未执行暂存、commit、push 或建分支。

## 旧源码依据

以下路径均相对 `/home/coder/workspaces/dootask`。

| 接口 | 旧实现与行号 | 前端调用 |
|---|---|---|
| openScaner | `resources/mobile/plugins/eeui/framework/android/src/main/java/app/eeui/framework/ui/eeui.java:1566`；`resources/mobile/plugins/eeui/framework/android/src/main/java/app/eeui/framework/activity/ScanActivity.java:69`（create）、`:130`（手电筒）、`:180`（destroy）、`:212`（success）；`resources/mobile/plugins/eeui/framework/ios/eeui/Module/Webview/eeuiBridge.m:372`；同 iOS 树 `Utility/CCNScan/scanViewController.m:245`（success / 连续扫码）、`:273`（destroy） | `resources/assets/js/functions/eeui.js:141` |
| getLatestPhoto | `resources/mobile/plugins/eeui/framework/android/src/main/java/app/eeui/framework/extend/module/eeuiPhoto.java:264`、`:302`（DATE_ADDED）、`:434`（缩略图）、`:553`（返回字段）；`resources/mobile/plugins/eeui/framework/ios/eeui/Module/eeuiPhotoManager.m:42`、`:169`、`:287` | `resources/assets/js/functions/eeui.js:241`，依赖带前缀 base64、原图 path、秒值 created |
| uploadPhoto | 上述 Android `eeuiPhoto.java:55`、`:147`（URL ID / ready）、`:170`（响应）；上述 iOS `eeuiPhotoManager.m:408`、`:513`（ready）、`:550`（HTTP 错误）、`:561`（JSON） | `resources/assets/js/functions/eeui.js:286` |
| cancelUploadPhoto | 上述 Android `eeuiPhoto.java:202`，取消后 `:159` 的 onFailure 仍通知原上传；上述 iOS `eeuiPhotoManager.m:606`，`:536` 对取消错误不再通知原上传 | `resources/assets/js/functions/eeui.js:312` |
| picturePreview | `resources/mobile/src/pages/index.vue:287`、`web.vue:257`；`resources/mobile/plugins/eeui/picture/android/src/main/java/eeui/android/eeuiPicture/entry/eeuiPictureEntry.java:411`；`resources/mobile/plugins/eeui/picture/ios/eeuiPicture/eeuiPictureSelectorModule.m:763` | `resources/assets/js/components/PreviewImage/state.vue:91` |
| videoPreview | `resources/mobile/src/pages/index.vue:292`、`web.vue:262`；上述 Android `eeuiPictureEntry.java:477`；上述 iOS `eeuiPictureSelectorModule.m:821` | `resources/assets/js/components/PreviewImage/state.vue:76` |

原中文权限文案参考 `resources/mobile/platforms/ios/eeuiApp/eeuiApp/Info.plist:72`、`:80`、`:84`、`:86`；新相册读取文案明确说明查看最近照片、选择和发送图片。

## 契约与实现

- 扫码支持 `{title, desc, continuous}` 和旧字符串描述。iOS 在推入路由前发 create；Android 授权后在页面创建时发 create。成功后非连续模式关闭，随后发 destroy；连续模式保留回调，300ms 节流。手电筒发送 openLight / offLight。取消不伪造 success / error。success 保留 text、source、format、result；iOS 另含 pageName。每次多次回调均 keep=true，最终显式 release。
- 从图片识别使用 SDK 58 的 `File.pickFileAsync({mimeTypes:'image/*'})` 和 `scanFromURLAsync`，不增加依赖。图片选择为系统文件选择器，区别于旧 Photos 选择界面；iOS 静态图片识别与旧实现一样仅支持二维码。识别用副本用后删除。
- 最近照片只申请 photo 读取权限，允许系统“所选照片”权限。返回 thumbnail / original 的 path、width、height、size、name；thumbnail.base64 包含 `data:image/jpeg;base64,`；created 为 Unix 秒。普通缩略图最短边 300，极端比例居中裁至 5:1。iOS 原图导出 JPEG（0.95），缩略图质量 0.7；Android 保留原文件字节、缩略图质量 0.9，并将 content URI 复制到沙盒，确保返回裸路径可上传。失败时清理本次产物；成功文件留在系统缓存，供前端随后上传。
- 上传通过当前 `expo-file-system` 导出的 `new UploadTask(file, url, options)`，调用 uploadAsync / cancel / release，没有使用已废弃的顶层 uploadAsync / createUploadTask。POST multipart，默认 fieldName=file，data 转字符串表单字段，headers 保留；文件 MIME 为旧壳的 application/octet-stream。
- ready.id 保留原始 URL。ready 发出前登记任务，支持 onReady 中立即取消；同 URL 后发任务不会被先发完成事件误删。跨页取消通过遍历 getAllPages 的 page.state 查找最新任务，没有模块级任务表。
- 保留旧平台差异：Android 收到 HTTP 响应即 success（含非 2xx），data 为响应字符串；iOS 非 2xx 为 error，成功优先解析 JSON，否则返回字符串。均保留 statusCode。
- 取消自身返回 `{status:'success', id}`；空 ID / 找不到任务为旧中文 error。Android 原上传随后 error（Canceled）并释放；iOS 原上传只释放。取消后丢弃迟到结果。原生任务已经完成的瞬间请求取消，返回任务不存在错误并允许真实完成回调到达。
- 预览仅传调用页名与请求 ID 到原生路由，媒体列表存 page.state。paths 支持字符串数组、path 对象和 Android 旧 JSON 数组形式；position 限定到有效范围。保留 iOS 的 bmiddle → large 替换。图片支持左右翻页、双指缩放、放大后拖动、重置、横竖屏和关闭；视频保留原生播放 / 暂停 / 进度控件，离开页面或进入后台暂停，卸载由 useVideoPlayer 释放。
- 自定义预览按钮支持简繁中文；其他语言回退英文。视频系统控件语言由操作系统决定，未强行修改全局系统语言。

## SDK 58 已核实的 API 与限制

已读取本地 `package.json`（expo ~58.0.14）、上述五个 Expo 包的 build/*.d.ts、对应 config plugin 源码，并针对时间与扫码格式进一步读取原生实现。

1. `expo-media-library` 当前主入口是 Query / Asset。使用 `new Query().eq(AssetField.MEDIA_TYPE, MediaType.IMAGE).orderBy({key:AssetField.CREATION_TIME, ascending:false}).limit(1).exe()`，再读取 asset 信息。
2. 时间注释写“秒”，当前实现实际为毫秒：`node_modules/expo-media-library/src/next/js/AssetAlbum.ts:42` 直接转发；iOS `ios/next/objects/asset/AssetMapper.swift:36` 使用 millisecondsSince1970；Android `android/src/main/java/expo/modules/medialibrary/next/objects/asset/AssetMapper.kt:169` 原样返回 DATE_TAKEN。已转换毫秒，并兼容后续修正为秒的版本；回归覆盖两种值。
3. **Android 严格兼容尚缺 DATE_ADDED 查询。** 旧壳按 DATE_ADDED 降序取图，并把它作为 created；Expo 的 CREATION_TIME 映射到 DATE_TAKEN，不暴露 DATE_ADDED。拍照场景通常一致，刚导入的旧照片、下载图片无 DATE_TAKEN 时可能选图或“60 秒内”判断不同。没有用文件修改时间冒充加入相册时间。
4. 要完全对齐上一项，集成方需增加 Expo 本地原生查询，返回按 DATE_ADDED DESC 的一条图片及 added 秒值，再交给本批已有的图像处理。需要处理 scoped storage / content URI 和 Android 14 所选照片权限。按文件归属要求，本批未写 modules、plugins 自定义原生插件或 patches，也没有用类型断言访问不存在的 Query 字段。

## 验证记录

| 命令 / 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `npx expo lint` | 通过，无 error / warning |
| `node --test src/features/media/__tests__/media.test.cjs` | 24/24 通过 |
| `CI=1 npx expo prebuild --clean --no-install` | 通过；输出 package.json no changes，没有安装依赖 |
| Python plistlib / ElementTree 检查生成原生配置 | 通过，具体值如下 |
| 生成目录清理 | 已删除本次生成的 ios/、android/ |

逻辑测试覆盖：对象 / JSON 参数与路径转义、索引、缩略图居中裁切、SDK 毫秒 / 秒转换、双端响应差异、ready 顺序和 keep / release、网络 / 参数错误、立即取消、重复取消、完成时取消、取消后迟到成功、跨页取消、同 URL 并发、扫码状态 / 格式 / 连续节流 / 图片来源、StrictMode 重挂载、权限拒绝 / 首次授权 / 有限权限、空相册、异常产物清理、缩放中心 / 边界、自注册和路由归属。

生成 Info.plist 检查结果：

```text
NSCameraUsageDescription = $(PRODUCT_NAME) 需要访问您的相机，以便您可以扫描二维码、拍摄照片或进行视频会议。
NSMicrophoneUsageDescription = $(PRODUCT_NAME) 需要访问您的麦克风，以便您可以录制语音交流。
NSPhotoLibraryUsageDescription = $(PRODUCT_NAME) 需要访问您的相册，以便您可以查看最近照片、选择和发送图片。
NSPhotoLibraryAddUsageDescription = $(PRODUCT_NAME) 需要访问您的相册，以便您可以保存图片。
```

AndroidManifest 包含 CAMERA、READ_MEDIA_IMAGES、READ_MEDIA_VIDEO、READ_MEDIA_VISUAL_USER_SELECTED、READ_EXTERNAL_STORAGE、WRITE_EXTERNAL_STORAGE；未引入 READ_MEDIA_AUDIO。RECORD_AUDIO 沿用相机 / 会议配置。Android 权限对话框文案由系统提供。双端包名为 com.dootask.task；iOS 既有 audio 后台模式、Android localhost 明文访问和条码功能保持有效。

未验证：Linux 没有 Xcode，未编译 iOS；ANDROID_HOME / ANDROID_SDK_ROOT 指向不存在的 `/home/coder/Android/Sdk`，JAVA_HOME 指向不存在的 `/usr/lib/jvm/java-17-openjdk-amd64`，没有 java / adb，未执行 assembleDebug。未连接设备，Node API 替身和 prebuild 不能验证摄像头、媒体权限实际 UI、图像解码效果、原生上传网络栈、视频解码或手势手感。

## 集成方处理

必须在 `src/bridge/modules/index.ts` 增加副作用导入，本批按要求没有编辑该文件：

```diff
 import '../messages';
+import '../../features/media';
```

expo-router 的根 Stack 会自动发现新增路由，无需修改 _layout.tsx。扫码 / 预览路由用于内部 router.push；不需要将它们加入业务深链白名单。

额外依赖：无。已预装的五个媒体包直接使用；需要重新构建开发客户端以包含原生模块与权限配置。

除上述 import 外，Android DATE_ADDED 查询需按上一节补齐后才能将 getLatestPhoto 改为 ✅。若希望图片识别直接打开系统照片选择器，可由集成方安装 expo-image-picker 并替换当前文件选择；当前实现可用已有依赖完成图片识别。

另有既存前端差异需要集成方知晓：`resources/assets/js/functions/eeui.js:296` 直接访问 result.data.ret，而旧 Android 上传返回字符串。为了遵守本次“兼容契约不能变”，本批保持字符串；若业务要统一前端 Promise 行为，应在独立前端任务兼容解析字符串，不在壳中悄悄改变旧回调。

## 设备手测清单

- [ ] 集成 import 后重新 prebuild / 双端构建，验证模块与 action 均注册，现有桥接自测无回归。
- [ ] 主页面和二级 WebView 分别打开扫码：首次允许、拒绝、永久拒绝后设置恢复；create / success / destroy 顺序、回调归属、Android 返回键与 iOS 返回手势。
- [ ] 二维码及常用条码、中文 / URL、手电筒 openLight / offLight、连续扫码节流；单次扫码只发一个 success；无扫描结果关闭只发 destroy。
- [ ] 从图片识别、取消选择、无二维码图片、iCloud 文件；切后台或打开选择器后相机释放 / 恢复。
- [ ] 相册全部 / 所选照片权限、空相册、JPEG / PNG / HEIC / 旋转照片、全景 / 长截图、iCloud 照片；thumbnail 可直接在 WebView 显示，original.path 可随后上传，created 单位为秒。
- [ ] Android 刚导入旧照片、下载图片无拍摄时间；记录 DATE_ADDED / DATE_TAKEN 差异，待原生查询补齐后复测“发送最近照片”的 60 秒窗口。
- [ ] 真正后端验证 multipart fieldName / data / headers / 文件名；2xx JSON / 文本、4xx / 5xx、断网、慢网；逐平台核对返回 data 类型和 statusCode。
- [ ] ready 中立即取消、上传中取消、重复取消、完成同时取消、跨页取消、同 URL 连续上传；无迟到 success，回调与原生句柄只释放一次。
- [ ] 图片单张 / 多张 / 50 张、position 中间项、远程和本地 URI、左右滑动、双指中点缩放 / 平移 / 6 倍边界、重置后翻页、旋转屏幕、图片失败、关闭后返回原页。
- [ ] 视频远程 / 本地、播放 / 暂停 / 拖动进度、音频、加载失败、横竖屏、后台暂停和回前台、关闭后不继续播放；核对返回原 WebView 的恢复行为。
- [ ] 简繁中文 / 英文自定义按钮、系统视频控件语言、安全区、iPad 与 Android 大屏。

# X4：Expo 内测构建链路

日期：2026-10-17。主程序版本：1.9.66 / 245。

## 改动与边界

本批只增加 Expo 内测入口，旧 eeui 正式发布继续使用原命令与 workflow。

| 文件 | 改动 |
|---|---|
| 主仓库 `electron/build.js` | 新增 `app-expo [build]`；复用 `startBuild` / `electronBuild`，重新编译、清空目标后复制前端，并写入 `version.json` 的 `version`、`codeVerson` |
| 主仓库 `cmd` | 新增 `appexpo [build]`、`appexpo npm ...`，使用本机 Node，转发参数与退出码，不要求 Docker |
| 主仓库 `.github/workflows/app-internal.yml` | 仅手动触发，可选择 all / android / ios；共用前端 artifact，分别生成 APK / IPA |
| `.gitignore` | 补充占位入口及已追踪版本文件的处理说明；保留现有产物忽略规则 |
| `scripts/android-signing.gradle` | Gradle init script 在 `finalizeDsl` 配置 Release 签名；完整 keystore 配置优先，否则使用生成工程的 debug 签名 |
| `scripts/prepare-ios-signing.py` | 校验并安装两个内测 profiles，核对 Bundle ID、Team、App Group、设备列表、期限、导出类型，以及与钥匙串私钥匹配的共同证书；生成签名元数据和 ExportOptions.plist |
| `scripts/configure-ios-signing.js` | 对已 prebuild 工程单独执行 Expo config mod，仅为主 App 和分享扩展的 Release target 配置手动签名 |
| `docs/x4-build-report.md`、`docs/progress.md` | 本报告与末尾追加进度 |

未改动 `app.config.ts`、任何 package.json / lockfile、`src/`、`modules/`、`plugins/` 或已有 pack / mac-build 脚本。没有执行 add、commit、push、建分支或 stash。

新目标每次都构建前端，不依赖调用方设置 `BUILD_FRONTEND`，不接受 `publish`。它不进入桌面打包、Drawio 下载、旧 eeui 编译或上传分支，也不改写桌面开发使用的 `.native` / `.devload` 缓存。`electron/public/` 是复用现有 Vite 配置的构建暂存目录，每次新目标构建前清空。

已逐字节对照原代码：旧 `app` 入口、完整 eeui 构建分支、`appbuild` 分发、`electron_operate` 和两个旧发布 workflow 均保持原样。共享逻辑中的新增行为均限定在 `id === 'app-expo'`。

## 使用方法

在主仓库根目录，推荐使用 Node 24（Expo 58 / RN 0.88 要求 Node ^22.13 / ^24.3 或更新支持版本）：

```bash
./cmd appexpo                 # 默认执行前端编译与复制
./cmd appexpo build           # 同上
node ./electron/build.js app-expo build  # 依赖已安装时可直接调用；build 可省略
./cmd appexpo npm ci          # 在 resources/app 中运行 npm ci
./cmd appexpo npm run check
```

前端构建需要主仓库及 electron 的 npm 依赖；cmd 在依赖目录缺失时用本机 npm 安装。新子命令同 `electron` 一样跳过 Docker 检查和 `.env` 初始化。Expo 依赖通过显式的 `appexpo npm ci` 安装，前端复制本身不要求安装 Expo 依赖。

本机 Android Release 示例（需要配置好 JDK 17、Android SDK / NDK）：

```bash
./cmd appexpo build
./cmd appexpo npm ci
CI=1 EXPO_NO_DOTENV=1 EXPO_PUBLIC_WEB_URL= ./cmd appexpo npm exec -- expo prebuild --platform android --clean --no-install
cd resources/app/android
./gradlew :app:assembleRelease --no-daemon --init-script ../scripts/android-signing.gradle
```

没有 `ANDROID_KEYSTORE_PATH` 时使用 debug 签名。使用自有签名时，设置该变量为 keystore 绝对路径，并设置下表中的三个 Android 密码 / alias 环境变量。产物位于 `android/app/build/outputs/apk/release/`。debug 签名的包用于全新安装；它不能覆盖使用其他证书签名的正式包。

iOS 使用 workflow 中的证书导入、profile 校验、Expo mod、archive / export 步骤；本批未增加另一套完整本机发布脚本。

## 资源 URL、路由与包内位置

保留 `url: 'http://public/'`。这个值生成 `systemInfo.homeUrl` / `apiUrl`，其中 `public` 是“尚未设置服务器”的业务占位域名：`login.vue:isNotServer()` 会弹出服务器设置，`functions/web.js` 也据此处理默认隐私链接。它不决定 WebView 的静态资源 origin。若将它改为 localhost，首次登录会把本地静态服务当成业务 API，并跳过服务器设置提示。

`electronBuild` 在现有 `vite.config.js` 中使用 `base: './'`。新目标沿用 `electron/index.html`，生成入口形如 `./js/build/app.<hash>.js`、`./js/build/app.<hash>.css`，其余初始资源同样为 `./css/...`、`./js/...`、`./config.js`。不增加 `/public/` 或 `/web/` URL 前缀。

| 阶段 | 位置 / URL |
|---|---|
| 前端输出暂存 | 主仓库 `electron/public/` |
| Expo 构建输入 | `assets/web/` |
| Android prebuild 复制 | `android/app/src/main/assets/web/`；原生模块以 `web/<请求路径>` 读取 AssetManager |
| iOS prebuild 复制 | `ios/DooTask/web/`，以 folder reference 加入 Resources，包内为 `Bundle/web/` |
| WebView 请求 | `http://localhost:22223/` → `web/index.html`；`/js/...` → `web/js/...` |

`app.js` 通过 `isLocalHost(window.location)` 为 hostname 为 localhost 的地址选择 hash 路由，例如 `http://localhost:22223/#/manage/project`；路由片段不会改变相对资源的解析目录。原生服务另外提供无扩展名业务路径到 index.html 的回退，缺失静态资源仍返回 404。

现有 `.gitignore` 的 `/assets/web/*` 加 `!/assets/web/index.html` 已符合用途：编译出的目录 / 其他文件忽略，仓库继续追踪占位 index.html。ignore 规则不会隐藏已追踪入口的覆盖改动，构建验证后须恢复其原内容，不设置 assume-unchanged。`version.json` 也已被追踪，且是独立克隆时的版本回退文件，因此不删除、不取消追踪；本次验证后恢复了原内容 `{ "version": "1.9.66", "code": 245 }`。真正构建时会写成 `version` / `codeVerson`，现有版本读取器同时支持两者。

## CI 与 secrets

在 Actions 中手动运行 **Expo App Internal**。输入 `platform` 默认为 all，iOS 导出方式默认为 ad-hoc，也可选择 development。准备阶段编译并同步真实前端；两个原生 job 下载同一份资源后执行 `npm ci --include=dev`、clean prebuild。Android 执行 Gradle assembleRelease；iOS 使用 macos-26、CocoaPods、xcodebuild archive / export。

三个 job 使用独立的 **app-internal Environment**。iOS 沿用旧 workflow 的 secrets 名称，建议在此环境提供内测配置，保留旧 `build` 环境中的 App Store profiles。仓库级 secrets 也可被读取；若仓库级现有 profiles 是 App Store 类型，应在 app-internal 环境用同名内测 profiles 覆盖，不能替换旧正式发布配置。

| Secret | 用途与缺省处理 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 可选，base64 编码的 keystore |
| `ANDROID_KEYSTORE_PASSWORD` | 可选，keystore 密码 |
| `ANDROID_KEY_ALIAS` | 可选，key alias |
| `ANDROID_KEY_PASSWORD` | 可选，key 密码 |
| `IOS_CERTIFICATE_BASE64` | iOS .p12 证书及私钥的 base64；缺失时跳过 iOS job |
| `IOS_CERTIFICATE_PASSWORD` | .p12 密码；无密码时可留空 |
| `IOS_PROVISION_PROFILE_BASE64` | `com.dootask.task` 的内测 profile；缺失时跳过 iOS job |
| `IOS_SHARE_EXTENSION_PROVISION_PROFILE_BASE64` | `com.dootask.task.shareExtension` 的内测 profile；缺失时跳过 iOS job |

旧 `publish.yml` 没有 Android keystore secrets，旧 Gradle 从自身签名配置取值，所以四个 `ANDROID_*` secrets 为新链路新增约定。四项完整时解码到 runner 临时目录，Gradle init script 使用这些环境变量；缺失或不完整时给出摘要并使用 debug 签名。已提供但无效的完整签名配置会使构建失败，不静默更换证书。

iOS 两个 profiles 都必须关联 `group.im.dootask`，包含测试设备 UDID，属于同一 Team，并支持导入证书。ad-hoc 使用 Distribution 证书，development 使用 Development 证书及相应 profiles。脚本拒绝 App Store、过期、不匹配或缺少 App Group 的 profiles；一期不要求推送 entitlement。Xcode 26 的导出方法分别为 `release-testing` / `debugging`，语义对应 ad-hoc / development。Team ID 与具体签名身份从 profiles / 钥匙串读取，无需额外 Team secret。

缺少 iOS 证书或任一 profile 时，prepare 输出 skip 说明，iOS job 被跳过；Android 仍按所选平台正常执行。配置不合法时会明确失败。

前端 artifact 保留 7 天，APK / IPA 保留 14 天。导出目标固定为 `export`，没有 R2、GitHub Release、TestFlight 或商店上传步骤，不需要 ASC_*、R2_* 或 Apple ID secrets。构建后清理临时 keystore、证书、profiles 与钥匙串，并恢复原钥匙串搜索列表。

## 已验证

- `node --check electron/build.js`、`node --check scripts/configure-ios-signing.js`、Python AST 语法检查、`bash -n cmd` 通过。
- 安装到 `/tmp` 的 actionlint **1.7.12** 校验新 workflow 通过。
- 实际执行 `./cmd appexpo build` 成功：共 **1,630** 个文件，约 75 MiB，`version.json` 为 **1.9.66 / codeVerson 245**。
- 校验 HTML 的 **6** 个资源引用、manifest 的 **133** 个条目及其文件 / 依赖，以及 **2,791** 处静态 / 动态相对 JS import；所有引用在 localhost:22223 根路径下均有对应文件。确认 localhost 选择 hash 路由、API 保留 public 占位。
- `./cmd appexpo npm --version` / `npm prefix` 确认本机 npm 转发且目录为本子模块；`app-expo publish` 返回非零退出码。
- 在 `/tmp` 隔离副本 clean prebuild 双端成功；Android assets、iOS folder reference / Resources 中 **1,630** 个内置前端文件逐字节一致；未在工作区生成 ios/、android/。
- 隔离生成的真实 Xcode 工程运行签名 config mod 成功，主 App / 分享扩展分别绑定各自 profile，App Group 保留，重复执行结果不变。
- **9** 组临时合成 profile / 钥匙串输入检查通过：ad-hoc、development、App Store 拒绝、缺 App Group、不同 Team、错误 Bundle ID、过期、导出类型不符、证书不符。此检查不执行真实 Apple 签名。
- `npm run lint`：0 error，103 条存量 warning；`npm run check:lang`、`./cmd composer stan` 通过。子模块 `npx tsc --noEmit`、`npx expo lint` 通过（并行任务仍在推进，此处记录本次执行时的状态）。
- 两级仓库 `git diff --check` 通过。旧 eeui 入口、构建代码和两个正式发布 workflow 对照检查通过；已有 pack / mac-build 脚本未改动。

验证后 `assets/web/` 已恢复为唯一的原占位 index.html（SHA-256：`b71d313bd7960501942255f3367000d8a2f8b526246fdccbc41ffc806b4c383f`），已追踪的 version.json 原样恢复；构建生成的 electron/public/ 已清理。

## 未验证与集成待办

1. **登记新子模块**：本次工作区 `resources/app` 自身是 Git 仓库，但主仓库 `.gitmodules` / gitlink 尚未登记它；只登记了旧 mobile 与 drawio。须由集成方登记并锁定含本批脚本的修订，且保证 Actions checkout token 可读取该子模块。本批按归属约束未修改 `.gitmodules`，也未提交任何文件。
2. **配置内测环境**：在 app-internal 环境配置需要的 secrets，准备主 App / 分享扩展的测试设备与 App Group，避免影响旧 build 环境。
3. **运行真实原生构建**：本机无可用系统 JDK / Android SDK，Linux 无 Xcode，未执行 Gradle assembleRelease、真证书签名、pod install、archive 或 IPA export。Android init script 的真实 AGP 签名流程、双端完整编译及最终安装须由 workflow / 构建机确认；prebuild 与合成输入检查不能替代这些验收。
4. **真机验证包内模式**：清空开发地址后验证本地 Web 服务、首次服务器设置、登录、hash 路由 / 子页、离线静态资源、后台恢复、深链，以及分享扩展实际调用。开发模式加载远端页面的既有验证结果不能替代包内 Release 验证。
5. 集成并行原生任务后核对最终 package-lock 与配置，再手动运行新 workflow。主仓库及 electron 没有追踪 npm lockfile，新前端构建继续使用 npm install；Expo 子模块使用 npm ci。

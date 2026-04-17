# DooTask App

DooTask 的移动端壳（iOS + Android），基于 Expo (React Native) + WebView 加载 Vue 2 SPA。
从 EEUI 迁移而来；完整迁移方案见 [`docs/migration-eeui-to-expo.md`](./docs/migration-eeui-to-expo.md)。

## 架构一句话

原生壳（Expo + RN）只负责 WebView 承载、多页面栈、JS ↔ 原生桥接、推送、扫码、相册、OTA；
业务 UI 全部由主仓库 [`kuaifan/dootask`](https://github.com/kuaifan/dootask) 的 Vue SPA 提供。

| 功能域 | 实现 |
|--------|-----|
| 本地资源加载 | `@dr.pogodin/react-native-static-server` + 构建时把 Vue 产物打进 `assets/web/` |
| WebView 桥接 | `injectedJavaScriptBeforeContentLoaded` 注入 `requireModuleJs` Proxy，兼容旧 EEUI API |
| 多 WebView | `React Navigation Native Stack`：`Main` / `ChildWebView` / `Scanner` |
| 扫码 | `react-native-vision-camera` 4.x（不依赖 Google 服务） |
| 相册 / 上传 | `expo-media-library` + `expo-image-manipulator` + `expo-file-system/legacy` |
| 推送 | UMeng Config Plugin + 原生 stub（需填真实 APPKEY 后启用，见 Phase 4 说明） |
| OTA | `expo-updates`（`checkAutomatically: ON_LOAD` + `eeui.checkUpdate()` 手动触发） |

## 开发环境

- Node.js 20+
- Android Studio（Android 构建） / Xcode 16+（iOS 构建）
- 主仓库本地路径：`~/workspaces/dootask`

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 构建 Vue SPA 并同步到本项目
cd ~/workspaces/dootask
./cmd prod
cp -r public/* ~/workspaces/dootask-app/assets/web/

# 3. 跑 dev-client
cd ~/workspaces/dootask-app
npx expo run:android   # 首次会编译 Gradle 工程
npx expo run:ios       # 首次需在 ios/ 下 pod install
```

### 热重载主仓库前端代码

开发时可以让 WebView 直接加载主仓库的 Vite dev server，省去每次 `cp`：

```bash
# 终端 1
cd ~/workspaces/dootask && ./cmd dev   # 默认 http://localhost:5173

# 终端 2
cd ~/workspaces/dootask-app
# 临时把 WebViewHost 的 url 改为 http://<局域网 IP>:5173 后重载
```

（模拟器/真机的 `localhost` 指向自身，必须用电脑的局域网 IP）

## 原生工程

iOS / Android 原生项目源码（`ios/` `android/`）随仓库提交。修改 `app.json` 或 `plugins/` 下
的 Config Plugin 后必须重跑一次 prebuild 把 diff 同步出来：

```bash
npx expo prebuild --clean
```

两次连续运行 prebuild 产物相同（UUID 全部基于 sha1(relPath) 派生）。

## 桥接调试

用占位 `assets/web/index.html` 里的按钮自测 `getVersion / alert / toast / openPage /
getLatestPhoto / createSnapshot` 等（不覆盖 SPA 资源时才会看到）。也可以用：

- Android：Chrome → `chrome://inspect` → 选中 WebView
- iOS：Safari → 开发 → 设备 → 选中 WebView

## 构建发布

本地构建：

```bash
npx eas build --profile preview --platform android
npx eas build --profile production --platform ios
```

CI 发布：在仓库 Actions 里手动触发 `EAS Build` workflow（`.github/workflows/build.yml`），
选 platform / profile / submit / dootask_ref。必需 secrets：

| Secret | 用途 |
|--------|------|
| `EXPO_TOKEN` | 必需 — expo.dev Access Token |
| `APPLE_ID` / `ASC_APP_ID` / `APPLE_TEAM_ID` | iOS submit |
| `GOOGLE_PLAY_SA_B64` | Google Play 服务账号 JSON 的 base64 |

可选 vars：`DOOTASK_REPO`（默认 `kuaifan/dootask`）。

## 目录结构

```
src/
  App.tsx                     # Navigation + ToastHost + notification tap listener
  screens/                    # WebViewHost / MainScreen / ChildWebViewScreen / ScannerScreen
  bridge/                     # injectedJS, types, router (index.ts), handlers/
  services/                   # localServer, themeBus, toastBus, scannerBus,
                              # notificationTap, push, otaUpdates
plugins/
  withWebAssets.js            # 打包 assets/web 到原生项目
  withUmengPush.js            # UMeng 推送配置（manifest + MainApplication + pbxproj）
  umeng/                      # Kotlin / Swift 模板文件
assets/web/                   # Vue SPA 构建产物（用 ./cmd prod 从主仓库同步）
docs/migration-eeui-to-expo.md # 完整迁移方案文档
```

## 相关链接

- 主仓库：[kuaifan/dootask](https://github.com/kuaifan/dootask)
- 迁移文档：[`docs/migration-eeui-to-expo.md`](./docs/migration-eeui-to-expo.md)
- Expo EAS：<https://expo.dev>

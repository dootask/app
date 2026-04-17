# DooTask App (Expo / React Native)

DooTask 移动客户端，使用 Expo (React Native) 构建。本质是一个原生壳，通过多 WebView 加载 DooTask 的 Vue 2 SPA，并通过 JS 桥接提供原生能力。

## 迁移文档

本项目从 EEUI 框架迁移而来，**完整实施方案见 `docs/migration-eeui-to-expo.md`**。开发前必读。

文档包含 17 个章节 + 2 个附录，涵盖：架构设计、代码触点清单、桥接协议（含完整 injectedJS 和 createBridgeHandler 实现）、API 映射表（含响应格式契约）、推送方案、多 WebView 导航、本地资源加载与打包、扫码流转、App 启动序列、开发调试流程、分阶段实施计划等。

## DooTask 主仓库（必须引用）

**路径：`~/workspaces/dootask`**

本项目的目标是用 Expo 替换 EEUI，功能完全不变。开发过程中你**必须**频繁读取主仓库中的源码作为参考：

| 你在做什么 | 需要读取的主仓库文件 |
|-----------|---------------------|
| 实现桥接方法 | `resources/assets/js/functions/eeui.js` — 所有 38+ 个原生方法的调用方式和参数格式 |
| 确认方法被谁调用、怎么调用 | `resources/assets/js/` 下的 52 个引用 eeui 的 Vue/JS 文件 |
| 实现 openPage | `resources/assets/js/store/actions.js` — `openAppChildPage` action（约 1373 行） |
| 理解 URL 处理 | `resources/assets/js/store/actions.js` — `userUrl` action（约 1290 行） |
| 实现推送 | `app/Models/UmengAlias.php` — 推送发送逻辑 |
| 改后端 UA 识别 | `app/Module/Base.php`、`app/Models/UserDevice.php`、`app/Http/Controllers/IndexController.php` |
| 构建前端资源 | 在主仓库执行 `./cmd prod`，产物在 `public/` 目录 |
| 理解构建流程 | `electron/build.js`（570-604 行）、`cmd` 脚本 |
| 理解 config.js | `electron/build.js`（约 551 行）— `window.systemInfo` 生成逻辑 |

**关键原则**：
- 每个桥接方法的返回格式都必须与 EEUI 原版一致。如果文档中的描述与 `eeui.js` 源码有出入，以源码为准。
- **可以修改主仓库代码**：如果主仓库中某些调用方式（如 `eeui.js` 中的同步调用、前端组件中的 EEUI 特有写法）不适合 Expo 的桥接模式，可以直接改主仓库的代码来适配。不需要兼容旧的 EEUI App，因为最终是离线打包——旧 App 用的是已发布的资源，不会受影响。只要功能行为不变，主仓库的调用方式可以自由调整。

## 其他关联项目

- **Happy Next**：`~/workspaces/happy-next`（扫码实现参考：`packages/happy-app/sources/app/(app)/scanner.tsx`）

## 核心架构

- **本地资源加载**：Vue SPA 打包进 App assets，通过 App 内 HTTP Server 加载（非 file://）
- **多 WebView**：主页面（firstPage）+ 子页面（openPage 创建新 RN Screen + 独立 WebView）
- **JS 桥接**：通过 `postMessage`/`onMessage` + 注入 `requireModuleJs` polyfill 实现兼容
- **推送**：iOS + Android 均使用 UMeng（国内无 FCM，通过 Config Plugin + Native Module 集成）
- **扫码**：react-native-vision-camera（不依赖 Google 服务）
- **服务器地址**：由 Vue SPA 自己管理（登录页输入，localForage 存储），原生层不处理

## 技术栈

- Expo SDK + expo-dev-client（必需，UMeng 自定义 Native Module 不支持 Expo Go）
- React Native + TypeScript
- React Navigation（Native Stack，多 WebView 页面栈）
- react-native-webview（加载 Vue SPA）
- react-native-static-server（App 内 HTTP Server 加载本地资源）
- react-native-vision-camera（扫码，不依赖 Google 服务）
- UMeng SDK（iOS + Android 推送，通过 Expo Config Plugin + Native Module 集成）

## 开发命令

```bash
# 安装依赖
npm install

# 开发（需要 dev-client）
npx expo run:android
npx expo run:ios

# 构建
npx eas build --platform android
npx eas build --platform ios

# 提交应用商店
npx eas submit --platform ios
npx eas submit --platform android
```

## 前端资源

Vue SPA 打包进 `assets/web/` 目录：

```bash
cd ~/workspaces/dootask
./cmd prod
cp -r public/* ~/workspaces/dootask-app/assets/web/
```

开发期间可直接加载 Vite dev server（`http://LOCAL_IP:5173`）避免每次复制。详见迁移文档第 16 节。

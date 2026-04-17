# DooTask 移动端迁移方案：EEUI → React Native (Expo)

> 版本：v1.2 | 日期：2026-04-17
> 目标：将移动客户端从 EEUI WebView 壳迁移至 Expo (React Native)，保持 WebView + 原生桥接架构不变
> 说明：文档中的代码示例为架构参考，实施时需根据实际依赖版本调整 import 和类型定义

---

## 目录

1. [架构概述](#1-架构概述)
2. [现有代码触点清单](#2-现有代码触点清单)
3. [Expo 项目结构设计](#3-expo-项目结构设计)
4. [JS 桥接层设计](#4-js-桥接层设计)
5. [原生 API 映射表](#5-原生-api-映射表)
6. [推送通知迁移方案](#6-推送通知迁移方案)
7. [后端改造清单](#7-后端改造清单)
8. [前端改造清单](#8-前端改造清单)
9. [构建与 CI/CD 迁移](#9-构建与-cicd-迁移)
10. [分阶段实施计划](#10-分阶段实施计划)
11. [风险与注意事项](#11-风险与注意事项)
12. [本地资源加载方案](#12-本地资源加载方案)
13. [多 WebView 导航架构](#13-多-webview-导航架构)
14. [桥接响应格式契约](#14-桥接响应格式契约)
15. [userUrl 处理与子页面认证](#15-userurl-处理与子页面认证)
16. [开发调试流程](#16-开发调试流程)
17. [关键实现细节补充](#17-关键实现细节补充)

---

## 1. 架构概述

### 1.1 当前架构（EEUI）

```
┌─────────────────────────────────────┐
│         EEUI Native Shell           │
│  (Android: Kotlin, iOS: Swift/ObjC) │
│                                     │
│  ┌───────────────────────────────┐  │
│  │        WebView                │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │   Vue 2 SPA (Vite)      │  │  │
│  │  │   同一份前端代码         │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
│                                     │
│  JS Bridge: requireModuleJs()       │
│  推送: UMeng (友盟)                  │
│  构建: Docker eeui-cli              │
└─────────────────────────────────────┘
```

### 1.2 目标架构（Expo）

```
┌──────────────────────────────────────────────┐
│          Expo (React Native) Shell           │
│                                              │
│  ┌─── React Navigation Stack ─────────────┐ │
│  │                                         │ │
│  │  Screen 0 (Main)    Screen 1 (Child)    │ │
│  │  ┌──────────────┐  ┌──────────────┐     │ │
│  │  │  WebView #0   │  │  WebView #1   │    │ │
│  │  │  Vue SPA      │  │  Vue SPA      │    │ │
│  │  │  (firstPage)  │  │  (子页面)     │    │ │
│  │  └──────────────┘  └──────────────┘     │ │
│  │           ...可继续叠加子页面...          │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  资源加载: 本地打包（App 内 assets）           │
│  JS Bridge: postMessage/onMessage            │
│  推送: UMeng (iOS + Android)                 │
│  构建: EAS Build                             │
└──────────────────────────────────────────────┘
```

### 1.3 核心原则

- **最小改动原则**：保持 WebView 加载 Vue SPA 的模式，不重写 UI
- **桥接层替换**：用 `postMessage`/`onMessage` 替代 `requireModuleJs()`
- **本地加载**：Vue SPA 打包进 App assets，通过本地 HTTP server 加载（与 Electron 一致）
- **多 WebView**：`openPage` 创建新的 RN Screen + 独立 WebView 实例，保留 EEUI 的页面栈模式
- **渐进式迁移**：先跑通基础壳，再逐步替换原生 API
- **主仓库可改**：如果主仓库（`~/workspaces/dootask`）中的前端/后端代码存在不适合 Expo 桥接模式的写法（如同步调用、EEUI 特有 API 等），可以直接修改主仓库代码来适配。不需要兼容旧 EEUI App——最终是离线打包，旧 App 用的是已发布资源，不受影响。只要功能行为不变，调用方式可以自由调整

---

## 2. 现有代码触点清单

### 2.1 前端文件

| 文件路径 | 关键内容 | 迁移影响 |
|----------|----------|----------|
| `resources/assets/js/app.js:2` | `isEEUIApp` 检测 (UA 匹配 `/eeui/i`) | 需改为新 UA 标识 |
| `resources/assets/js/app.js:210` | `$A.isEEUIApp` 全局变量 | 保留变量名或新增 `isExpoApp` |
| `resources/assets/js/app.js:219-221` | 平台检测 (ios/android) | 保持不变 |
| `resources/assets/js/app.js:327-348` | EEUI 预加载：等待 `requireModuleJs` 可用 | **重写**为等待 RN bridge 就绪 |
| `resources/assets/js/functions/eeui.js` (全文件 382 行) | 所有原生桥接方法（38+ 个函数） | **核心改造文件** |
| `resources/assets/js/functions/common.js:482` | `isAndroid()` 平台判断 | 保持不变 |
| `resources/assets/js/store/state.js:19-20` | `safeAreaSize` 状态 | 保持不变 |
| `resources/assets/js/store/state.js:32-33` | `isFirstPage` 状态 | 保持不变 |
| `resources/assets/js/store/actions.js:175-195` | `safeAreaInsets()` action | 改为通过新桥接获取 |
| `resources/assets/js/App.vue:48-51` | MobileBack / MobileNotification 组件 | 保持不变 |
| `resources/assets/js/components/Mobile/Back.vue` | Android 返回键处理 | 改为通过新桥接通信 |
| `resources/assets/js/components/Mobile/Notification.vue:72-74` | 震动消息发送 | 改为通过新桥接通信 |
| `resources/assets/js/components/Mobile/Tabbar.vue:201-205` | Badge 数量更新 | 改为通过新桥接通信 |
| `resources/assets/js/utils/file.js:78-85` | EEUI 子页面打开 | 改为通过新桥接通信 |
| `resources/assets/js/utils/index.js:57-62` | EEUI 缓存管理 | 改为通过新桥接通信 |

### 2.2 后端文件

| 文件路径 | 关键内容 | 迁移影响 |
|----------|----------|----------|
| `app/Module/Base.php:1847-1851` | `isEEUIApp()` — UA 包含 `kuaifan_eeui` | 需兼容新 UA 标识 |
| `app/Models/UserDevice.php:132-159` | 设备识别 — `android_kuaifan_eeui` / `ios_kuaifan_eeui` | 需兼容新 UA 标识 |
| `app/Models/UmengAlias.php` (全文件) | 友盟推送：配置、发送、别名管理 | 推送方案迁移 |
| `app/Models/UmengLog.php` | 推送日志 | 推送方案迁移 |
| `app/Tasks/AppPushTask.php` | 任务提醒推送 | 调用入口不变 |
| `app/Http/Controllers/IndexController.php:462-474` | EEUI UA 检测，PDF 预览逻辑 | 需兼容新 UA 标识 |
| `app/Http/Controllers/Api/UsersController.php:22,24` | UmengAlias/UserDevice 引用 | 推送方案迁移时调整 |

### 2.3 构建与 CI/CD

| 文件路径 | 关键内容 | 迁移影响 |
|----------|----------|----------|
| `resources/mobile/` (git submodule) | EEUI 原生工程 (`dootask-app`) | **移除子模块**，App 迁移到独立仓库 |
| `electron/build.js:570-604` | EEUI 构建逻辑：Docker + Gradle/Xcode 配置 | **重写**为 EAS Build 流程 |
| `cmd:834-851` | `appbuild` / `eeui` 命令 | **重写**为 Expo 构建命令 |
| `.github/workflows/publish.yml:151-200` | Android 构建发布 | **重写**为 EAS Build |
| `.github/workflows/ios-publish.yml` | iOS 构建提交 App Store | **重写**为 EAS Submit |
| `package.json:81-96` | App 配置（id, name, publish url） | 迁移到 `app.json` |

---

## 3. Expo 项目结构设计

### 3.1 项目位置

创建**独立 Git 仓库**，与现有 `resources/mobile/` 子模块平级但完全独立。开发完成后将作为独立项目发布，不作为 DooTask 的子模块。

- **开发目录**：`~/workspaces/dootask-app`（与 `~/workspaces/dootask` 同级）
- **Git 仓库**：独立仓库（如 `github.com/kuaifan/dootask-app`）
- **与 DooTask 的关系**：通过构建脚本将 Vue SPA 产物复制到 Expo 项目的 `public/` 目录，或运行时加载远程 URL
- **现有子模块**：迁移完成后从 DooTask 主仓库移除 `resources/mobile` 子模块

```
~/workspaces/dootask-app/          # 独立 Git 仓库
├── app.json                       # Expo 配置
├── package.json
├── tsconfig.json
├── babel.config.js
├── eas.json                       # EAS Build 配置
├── plugins/
│   ├── withUmengPush.ts           # UMeng 推送 Config Plugin (Android)
│   └── withWebAssets.ts           # 将 assets/web/ 打包进原生项目
├── android/
│   └── src/main/java/com/dootask/
│       └── umeng/
│           ├── UmengPushModule.kt     # UMeng Native Module
│           └── UmengPushPackage.kt    # RN Package 注册
├── src/
│   ├── App.tsx                    # 入口：React Navigation Stack 配置
│   ├── screens/
│   │   ├── MainScreen.tsx         # 主页面（firstPage WebView）
│   │   ├── ChildWebViewScreen.tsx # 子页面（openPage 创建的 WebView）
│   │   └── ScannerScreen.tsx      # 扫码页面（react-native-vision-camera）
│   ├── bridge/
│   │   ├── index.ts               # 桥接层入口（消息路由）
│   │   ├── types.ts               # 消息类型定义
│   │   ├── handlers/
│   │   │   ├── clipboard.ts       # 剪贴板
│   │   │   ├── device.ts          # 设备信息
│   │   │   ├── keyboard.ts        # 键盘控制
│   │   │   ├── media.ts           # 相册/拍照/上传
│   │   │   ├── navigation.ts      # 页面导航
│   │   │   ├── scanner.ts         # 扫码（触发 ScannerScreen）
│   │   │   ├── screen.ts          # 屏幕控制
│   │   │   ├── storage.ts         # 本地存储
│   │   │   ├── theme.ts           # 主题检测
│   │   │   └── ui.ts              # Alert/Toast
│   │   └── injectedJS.ts          # 注入到 WebView 的 JS 代码
│   ├── services/
│   │   ├── push.ts                # 推送注册（iOS + Android 均用 UMeng）
│   │   └── update.ts              # OTA 热更新
│   └── utils/
│       └── userAgent.ts           # UA 构建
├── assets/
│   ├── icon.png                   # App 图标
│   ├── splash.png                 # 启动屏
│   ├── adaptive-icon.png          # Android 自适应图标
│   └── web/                       # 编译后的 Vue SPA（构建时从 DooTask 复制）
│       ├── index.html
│       ├── config.js              # window.systemInfo 配置
│       ├── js/build/              # Vite 构建产物
│       ├── css/
│       └── images/
```

### 3.2 app.json 配置

```json
{
  "expo": {
    "name": "DooTask",
    "slug": "dootask",
    "version": "1.7.23",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "dootask",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.dootask.task",
      "infoPlist": {
        "NSCameraUsageDescription": "用于扫码、拍照和视频会议",
        "NSPhotoLibraryUsageDescription": "用于选择和上传照片",
        "NSMicrophoneUsageDescription": "用于语音和视频会议"
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "com.dootask.task",
      "permissions": ["CAMERA", "VIBRATE", "RECORD_AUDIO", "READ_MEDIA_IMAGES"]
    },
    "plugins": [
      "./plugins/withWebAssets",
      ["react-native-vision-camera", { "enableCodeScanner": true }],
      "expo-image-picker",
      "expo-clipboard",
      "expo-haptics",
      "expo-notifications",
      "expo-device",
      "expo-keep-awake",
      "expo-secure-store",
      ["expo-media-library", { "photosPermission": "用于选择和上传照片", "isAccessMediaLocationEnabled": true }],
      ["./plugins/withUmengPush", { "appKey": "YOUR_UMENG_KEY", "messageSecret": "YOUR_SECRET" }]
    ]
  }
}
```

### 3.3 eas.json 配置

```json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "APPLE_ID",
        "ascAppId": "ASC_APP_ID",
        "appleTeamId": "TEAM_ID"
      },
      "android": {
        "serviceAccountKeyPath": "./google-services.json",
        "track": "production"
      }
    }
  }
}
```

### 3.4 核心依赖

```json
{
  "dependencies": {
    "expo": "~52.0.0",
    "expo-dev-client": "~5.0.0",
    "react": "18.3.1",
    "react-native": "0.76.x",
    "react-native-webview": "^13.0.0",
    "react-native-vision-camera": "^4.7.3",
    "expo-image-picker": "~16.0.0",
    "expo-clipboard": "~7.0.0",
    "expo-haptics": "~13.0.0",
    "expo-notifications": "~0.29.0",
    "expo-device": "~7.0.0",
    "expo-keep-awake": "~14.0.0",
    "expo-secure-store": "~14.0.0",
    "expo-linking": "~7.0.0",
    "expo-updates": "~0.27.0",
    "expo-media-library": "~17.0.0",
    "expo-file-system": "~18.0.0",
    "react-native-safe-area-context": "~4.12.0",
    "react-native-view-shot": "^4.0.0",
    "@react-navigation/native": "^7.0.0",
    "@react-navigation/native-stack": "^7.0.0",
    "react-native-screens": "~4.4.0",
    "react-native-static-server": "^0.5.0",
    "react-native-fs": "^2.20.0",
    "@react-native-async-storage/async-storage": "^2.1.0"
  }
}
```

> 注意：以上版本号为参考值，实际开发时以 `npx create-expo-app` 生成的版本为准
> `expo-dev-client` 是必需依赖——UMeng SDK 是自定义 native module，不支持 Expo Go，必须使用 development build

---

## 4. JS 桥接层设计

### 4.1 通信协议

EEUI 使用同步的 `requireModuleJs()` 调用原生方法，Expo 需改为 **异步消息** 模式：

```
WebView (Vue SPA)                    React Native
     │                                    │
     │── postMessage(JSON) ──────────────>│
     │                                    │── 处理请求
     │<───── injectedJavaScript ──────────│
     │   (window.dispatchEvent)           │
```

### 4.2 消息格式

```typescript
// WebView → RN（请求）
interface BridgeRequest {
  type: 'bridge_request';
  id: string;          // 唯一请求 ID，用于匹配响应
  module: string;      // 模块名：'eeui' | 'webview' | 'scanner' | ...
  method: string;      // 方法名：'getVersion' | 'openScaner' | ...
  args: any[];         // 参数列表
}

// RN → WebView（响应）
interface BridgeResponse {
  type: 'bridge_response';
  id: string;          // 对应请求 ID
  success: boolean;
  data?: any;
  error?: string;
}

// RN → WebView（主动推送事件）
interface BridgeEvent {
  type: 'bridge_event';
  event: string;       // 事件名：'backPressed' | 'themeChanged' | ...
  data?: any;
}
```

### 4.3 WebView 端注入代码（替代 requireModuleJs）

在 RN 侧通过 `injectedJavaScriptBeforeContentLoaded` 注入以下代码，使现有 `eeui.js` 的调用链能透明工作：

```javascript
// injectedJS.ts — 注入到 WebView 的桥接代码
const injectedJS = `
(function() {
  // 请求 ID 计数器
  let _reqId = 0;
  // 等待响应的回调 Map
  const _pending = new Map();

  // 监听 RN 发来的消息
  window.addEventListener('message', function(event) {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'bridge_response' && _pending.has(msg.id)) {
        const { resolve, reject } = _pending.get(msg.id);
        _pending.delete(msg.id);
        if (msg.success) {
          resolve(msg.data);
        } else {
          reject(new Error(msg.error || 'bridge error'));
        }
      } else if (msg.type === 'bridge_event') {
        window.dispatchEvent(new CustomEvent('bridge_event', { detail: msg }));
      }
    } catch (e) {}
  });

  // 发送请求到 RN 并等待响应
  function bridgeCall(module, method, args) {
    return new Promise(function(resolve, reject) {
      const id = 'req_' + (++_reqId);
      _pending.set(id, { resolve, reject });
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'bridge_request',
        id: id,
        module: module,
        method: method,
        args: args || []
      }));
      // 超时 30 秒
      setTimeout(function() {
        if (_pending.has(id)) {
          _pending.delete(id);
          reject(new Error('bridge timeout'));
        }
      }, 30000);
    });
  }

  // 同步调用（返回 Promise 代理对象）— 用于兼容 eeui.js 中的同步风格调用
  function createModuleProxy(moduleName) {
    return new Proxy({}, {
      get: function(target, prop) {
        if (prop === 'then' || prop === 'catch') return undefined;
        return function() {
          var args = Array.from(arguments);
          // 如果最后一个参数是回调函数，特殊处理
          var callback = null;
          if (args.length > 0 && typeof args[args.length - 1] === 'function') {
            callback = args.pop();
          }
          var promise = bridgeCall(moduleName, prop, args);
          if (callback) {
            promise.then(function(data) { callback(data); })
                   .catch(function(e) { callback({ status: 'error', error: e.message }); });
            return; // 回调模式不返回值
          }
          return promise;
        };
      }
    });
  }

  // 兼容层：模拟 requireModuleJs
  window.requireModuleJs = function(name) {
    return createModuleProxy(name || 'eeui');
  };

  // 标记 bridge 就绪
  window.__EXPO_BRIDGE_READY__ = true;
})();
true;
`;

// ⚠️ 实现注意：EEUI 的部分方法（如 openScaner、uploadPhoto）回调会被多次调用
// （如 status='ready' → status='success'）。上述 Proxy 的回调模式只触发一次 then/catch，
// 对于需要多次回调的方法，RN 侧应通过 bridge_event 主动推送中间状态，
// 最终结果通过 bridge_response 返回。具体实现参见附录 B 的 openScaner case。
```

### 4.4 RN 端消息处理（WebViewScreen.tsx 核心逻辑）

```tsx
// WebViewScreen.tsx — 核心结构示意
import { WebView } from 'react-native-webview';
import { useRef } from 'react';
import { handleBridgeRequest } from './bridge';

export function WebViewScreen() {
  const webViewRef = useRef<WebView>(null);

  const onMessage = async (event: WebViewMessageEvent) => {
    const msg = JSON.parse(event.nativeEvent.data);
    if (msg.type !== 'bridge_request') return;

    try {
      const result = await handleBridgeRequest(msg);
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'bridge_response',
        id: msg.id,
        success: true,
        data: result,
      }));
    } catch (error) {
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'bridge_response',
        id: msg.id,
        success: false,
        error: error.message,
      }));
    }
  };

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: `${getLocalServerUrl()}/index.html#/` }}
      injectedJavaScriptBeforeContentLoaded={injectedJS}
      onMessage={onMessage}
      // ... 其他配置
    />
  );
}
```

### 4.5 关于同步 vs 异步的兼容性说明

EEUI 的 `requireModuleJs()` 返回的是同步模块对象，可以直接调用方法并获取返回值（如 `eeui.getVersion()`）。而 Expo 的桥接是异步的。

**兼容策略**：

- 现有 `eeui.js` 中的方法分两类：
  1. **直接返回值的**（如 `getVersion()`、`getThemeName()`、`keyboardStatus()`）— 约 8 个方法
  2. **回调式或无返回值的**（如 `openScaner(callback)`、`toast()`、`keepScreenOn()`）— 约 30 个方法

- 对于第 2 类（回调式），上述 Proxy 方案可透明兼容
- 对于第 1 类（同步返回值），需要在 `eeui.js` 中逐个改造为 async/await 模式，或在 App 启动时通过注入预取这些值缓存到 `window` 对象

**具体方案**：App 启动时 RN 侧主动注入设备信息到 WebView：

```javascript
// RN 端在 WebView 加载完成后注入初始数据
const initData = {
  version: Constants.expoConfig.version,
  themeName: Appearance.getColorScheme(),
  // ...其他启动时已知的值
};
webViewRef.current?.injectJavaScript(`
  window.__EXPO_INIT_DATA__ = ${JSON.stringify(initData)};
  true;
`);
```

然后 `eeui.js` 中同步方法改为读取缓存：

```javascript
eeuiAppVersion() {
  return window.__EXPO_INIT_DATA__?.version;
},
eeuiAppGetThemeName() {
  return window.__EXPO_INIT_DATA__?.themeName;
},
```

---

## 5. 原生 API 映射表

### 5.1 完整映射

| EEUI 方法 | 功能 | Expo 替代方案 | 备注 |
|-----------|------|---------------|------|
| **基础信息** | | | |
| `getVersion()` | 获取 App 版本号 | `Constants.expoConfig.version` | 启动时注入 |
| `getLocalVersion()` | 获取本地版本号 | `Constants.expoConfig.version` | 同上 |
| `getThemeName()` | 获取主题 (light/dark) | `Appearance.getColorScheme()` | 启动时注入 + 监听变化推送 |
| `getDeviceInfo()` | 获取设备信息 | `expo-device` | 回调式，兼容 |
| `getSafeAreaInsets()` | 安全区域 | `react-native-safe-area-context` | 回调式，兼容 |
| `isFullscreen()` | 是否全屏 | RN Dimensions API | 启动时注入 |
| **键盘** | | | |
| `keyboardHide()` | 隐藏键盘 | `Keyboard.dismiss()` | 无返回值 |
| `keyboardStatus()` | 键盘是否可见 | `Keyboard` 事件监听 | 启动时注入 + 事件推送 |
| **屏幕** | | | |
| `keepScreenOn()` | 屏幕常亮 | `expo-keep-awake` `activateKeepAwakeAsync()` | 无返回值 |
| `keepScreenOff()` | 关闭常亮 | `expo-keep-awake` `deactivateKeepAwake()` | 无返回值 |
| **导航** | | | |
| `openPage()` | 打开新页面 | 新 RN Screen + 独立 WebView（详见 13.5 节） | 多 WebView 页面栈 |
| `openWeb()` | 系统浏览器打开 | `expo-linking` `Linking.openURL()` | 无返回值 |
| `goDesktop()` | 返回桌面 | `BackHandler.exitApp()` (Android) | Android only |
| `setPageBackPressed()` | 拦截返回键 | `BackHandler` 事件监听 | Android only |
| **UI** | | | |
| `alert()` | 原生 Alert | `Alert.alert()` (RN 内置) | 回调式 |
| `toast()` | Toast 提示 | `ToastAndroid` (Android) / 自定义 (iOS) | 无返回值 |
| **扫码** | | | |
| `openScaner()` | 打开扫码页 | `react-native-vision-camera` | 不依赖 Google 服务，参考 happy-next |
| **相册/拍照** | | | |
| `getLatestPhoto()` | 获取最新照片 | `expo-image-picker` + `expo-media-library` | 回调式 |
| `uploadPhoto()` | 上传照片 | `fetch` / `expo-file-system` `uploadAsync()` | 回调式 |
| `cancelUploadPhoto()` | 取消上传 | AbortController | 回调式 |
| **剪贴板** | | | |
| `copyText()` | 复制文本 | `expo-clipboard` `setStringAsync()` | 无返回值 |
| **存储** | | | |
| `setVariate()` / `getVariate()` | 全局变量 | 内存 Map（RN 侧） | 同步→异步 |
| `setCachesString()` / `getCachesString()` | 持久缓存 | `expo-secure-store` 或 `AsyncStorage` | 同步→异步 |
| **WebView 控制** | | | |
| `sendMessage()` | WebView 给原生层发命令 | `handleSendMessage()`（详见 17.7 节） | 命令总线，18 个 action |
| `setUrl()` | 设置 WebView URL | 更新 WebView `source` prop | RN 状态驱动 |
| `createSnapshot()` | WebView 截图 | `react-native-view-shot` | 需额外库 |
| `showSnapshot()` / `hideSnapshot()` | 显示/隐藏截图 | RN Image 组件覆盖层 | 自行实现 |
| `setScrollEnabled()` | 控制滚动 | WebView `scrollEnabled` prop | RN prop |
| `setHapticBackEnabled()` | 震动反馈 | `expo-haptics` | Android only |
| `setDisabledUserLongClickSelect()` | 禁止长按选择 | WebView 注入 CSS `-webkit-user-select: none` | 注入实现 |
| **系统** | | | |
| `checkUpdate()` | 检查更新 | `expo-updates` `checkForUpdateAsync()` | OTA 热更新 |
| `shakeToEditOn/Off()` | iOS 摇动撤销 | 无直接对应，可忽略 | iOS only，低优先级 |
| `rewriteUrl()` | URL 补全 | 前端自行处理 | 不需要原生 |

### 5.2 需要特殊处理的方法

#### 扫码（openScaner）— 使用 react-native-vision-camera

**重要**：不使用 `expo-camera` 的扫码功能，因为它底层依赖 Google ML Kit，国内 Android 设备大多没有 Google 服务。

使用 `react-native-vision-camera`，它直接调用 Android 原生 Camera API，不依赖 Google 服务。**参考实现来自 `~/workspaces/happy-next` 项目**。

**依赖**：
```json
{
  "react-native-vision-camera": "^4.7.3"
}
```

**Expo Config Plugin 配置**（app.json）：
```json
[
  "react-native-vision-camera",
  {
    "enableCodeScanner": true
  }
]
```

**扫码页面**（参考 `happy-next/packages/happy-app/sources/app/(app)/scanner.tsx`）：

```tsx
// src/ScannerScreen.tsx
import * as React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';

interface ScannerScreenProps {
  onScanned: (code: string) => void;
  onClose: () => void;
}

export function ScannerScreen({ onScanned, onClose }: ScannerScreenProps) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const hasScannedRef = React.useRef(false);

  React.useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      const value = codes[0]?.value;
      if (value && !hasScannedRef.current) {
        hasScannedRef.current = true;
        onScanned(value);
        onClose();
      }
    },
  });

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>需要相机权限才能扫码</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>授权</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>未检测到摄像头</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        codeScanner={codeScanner}
      />
      <TouchableOpacity style={styles.closeButton} onPress={onClose}>
        <Text style={styles.closeButtonText}>✕</Text>
      </TouchableOpacity>
      {/* 扫描框 */}
      <View style={styles.overlay}>
        <View style={styles.scanFrame} />
      </View>
    </View>
  );
}
```

**桥接集成**：WebView 发起 `openScaner` 请求时，RN 侧显示 `ScannerScreen` 覆盖层。扫码结果通过 `bridge_response` 返回给 WebView。

#### 照片获取与上传（getLatestPhoto / uploadPhoto）

```tsx
// src/bridge/handlers/media.ts
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';

export async function getLatestPhoto() {
  // 需要 expo-media-library 获取最新照片
  const { assets } = await MediaLibrary.getAssetsAsync({
    first: 1,
    sortBy: [MediaLibrary.SortBy.creationTime],
    mediaType: MediaLibrary.MediaType.photo,
  });
  if (assets.length === 0) throw new Error('no photo');
  return {
    status: 'success',
    created: Math.floor(new Date(assets[0].creationTime).getTime() / 1000),
    original: { path: assets[0].uri, width: assets[0].width },
    thumbnail: { base64: '...', width: assets[0].width }, // 需要生成缩略图
  };
}

export async function uploadPhoto(params) {
  const result = await FileSystem.uploadAsync(params.url, params.path, {
    fieldName: params.fieldName || 'file',
    httpMethod: 'POST',
    headers: params.headers || {},
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
  });
  return JSON.parse(result.body);
}
```

---

## 6. 推送通知迁移方案

### 6.1 当前方案：UMeng（友盟）

- 后端通过 `Hedeqiang\UMeng` SDK 发送推送
- 设备通过 `UmengAlias` 表注册别名（userid）
- 分 iOS (APNs) / Android (友盟通道 + 厂商通道) 发送
- 配置存储在系统设置 `appPushSetting`

### 6.2 确定方案：iOS + Android 均使用 UMeng

FCM 在中国大陆不可用，Android 必须保留 UMeng。iOS 初期也继续使用 UMeng（通过 Config Plugin 集成），与 Android 保持一致，**后端推送逻辑完全不变**。

> 后续稳定后可考虑 iOS 切换到 APNs 直推，但那是优化项，不在本次迁移范围内。

```
┌──────────────────────────────────────┐
│           后端推送服务（不变）          │
│                                      │
│   UmengAlias::pushMsgToAlias()      │
│   iOS: UMeng → APNs                 │
│   Android: UMeng → 厂商通道          │
└──────────────────────────────────────┘
          │                │
          ▼                ▼
   ┌────────────┐   ┌────────────┐
   │  iOS 设备   │   │ Android 设备│
   └────────────┘   └────────────┘
```

### 6.3 Expo 端集成 UMeng（iOS + Android 共用）

需要为 Expo 创建 **Config Plugin** 集成 UMeng SDK：

#### 6.3.1 创建 Config Plugin

```typescript
// plugins/withUmengPush.ts
import { ConfigPlugin, withAndroidManifest, withAppBuildGradle } from '@expo/config-plugins';

const withUmengPush: ConfigPlugin<{ appKey: string; messageSecret: string }> = (config, props) => {
  // 1. 注入 gradle 依赖
  config = withAppBuildGradle(config, (config) => {
    const gradle = config.modResults.contents;
    if (!gradle.includes('com.umeng.umsdk')) {
      config.modResults.contents = gradle.replace(
        /dependencies\s*\{/,
        `dependencies {
    implementation 'com.umeng.umsdk:common:9.+'
    implementation 'com.umeng.umsdk:push:6.+'
    // 厂商通道
    implementation 'com.umeng.umsdk:push-xiaomi:1.+'
    implementation 'com.umeng.umsdk:push-huawei:1.+'
    implementation 'com.umeng.umsdk:push-oppo:1.+'
    implementation 'com.umeng.umsdk:push-vivo:1.+'`
      );
    }
    return config;
  });

  // 2. 注入 AndroidManifest meta-data
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (application) {
      application['meta-data'] = application['meta-data'] || [];
      application['meta-data'].push(
        { $: { 'android:name': 'UMENG_APPKEY', 'android:value': props.appKey } },
        { $: { 'android:name': 'UMENG_MESSAGE_SECRET', 'android:value': props.messageSecret } }
      );
    }
    return config;
  });

  return config;
};

export default withUmengPush;
```

#### 6.3.2 编写 Native Module（Kotlin）

```kotlin
// android/src/main/java/com/dootask/umeng/UmengPushModule.kt
// 暴露给 RN 的方法：
// - initPush() — 初始化 UMeng SDK
// - setAlias(alias: String, type: String) — 设置别名
// - removeAlias(alias: String, type: String) — 移除别名
// - getDeviceToken() — 获取 UMeng device token
```

#### 6.3.3 App 端注册

```typescript
// src/services/push.ts
import { NativeModules } from 'react-native';

const { UmengPush } = NativeModules;

export async function registerPush(userId: string) {
  // iOS 和 Android 都通过 UMeng 注册
  await UmengPush.initPush();
  await UmengPush.setAlias(String(userId), 'userid');
  // 别名注册后，后端通过现有 api/users/umeng/alias 接口管理
}

export async function unregisterPush() {
  await UmengPush.removeAlias();
}
```

### 6.4 后端改造

**后端推送逻辑完全不变**。现有的 `UmengAlias` 模型、`pushMsgToAlias()` 方法、`appPushSetting` 配置全部保持原样。

现有 API 接口也不变：
- `api/users/umeng/alias` — 注册/删除推送别名
- `api/users/device/edit` — 更新设备信息

---

## 7. 后端改造清单

### 7.1 User-Agent 识别（必做）

新 App 的 UA 标识需要从 `kuaifan_eeui` 改为新的标识。建议采用 **向后兼容** 策略——同时识别新旧标识：

**新 UA 格式建议**：
```
// Android
... android_dootask_expo/1.7.23 ...

// iOS
... ios_dootask_expo/1.7.23 ...
```

**需改的文件**：

#### 7.1.1 `app/Module/Base.php:1847-1851`

```php
// 改前
public static function isEEUIApp()
{
    $userAgent = strtolower(Request::server('HTTP_USER_AGENT'));
    return str_contains($userAgent, 'kuaifan_eeui');
}

// 改后
public static function isEEUIApp()
{
    $userAgent = strtolower(Request::server('HTTP_USER_AGENT'));
    return str_contains($userAgent, 'kuaifan_eeui')
        || str_contains($userAgent, 'dootask_expo');
}
```

> 方法名 `isEEUIApp` 可保持不变（语义上指"是否为移动 App"），避免全局重命名的风险。

#### 7.1.2 `app/Models/UserDevice.php:132-159`

```php
// 增加 dootask_expo 的识别
if (preg_match("/android_dootask_expo/i", $ua)) {
    $result['app_type'] = 'Android';
    // ... 同原有 android 逻辑
    $result['app_version'] = self::getAfterVersion($ua, 'dootask_expo/');
} elseif (preg_match("/ios_dootask_expo/i", $ua)) {
    $result['app_type'] = 'iOS';
    // ... 同原有 ios 逻辑
    $result['app_version'] = self::getAfterVersion($ua, 'dootask_expo/');
} elseif (preg_match("/android_kuaifan_eeui/i", $ua)) {
    // 保留旧版兼容
    // ... 原有逻辑
}
```

#### 7.1.3 `app/Http/Controllers/IndexController.php:462-474`

同理增加 `dootask_expo` 的识别。

### 7.2 推送相关

**推送逻辑不需要改动**。iOS 和 Android 都继续使用 UMeng 推送，现有的 `UmengAlias` 模型、`pushMsgToAlias()` 方法、配置全部保持原样。（UA 识别等其他后端改动见 7.1 节）

### 7.3 后端无需改动的部分

- API 接口（控制器方法）— 完全不变
- WebSocket 通信 — 完全不变
- 业务逻辑 — 完全不变
- 数据库结构 — 完全不变

---

## 8. 前端改造清单

### 8.1 `resources/assets/js/app.js` 改造

```javascript
// 第 2 行：UA 检测
// 改前
const isEEUIApp = window && window.navigator && /eeui/i.test(window.navigator.userAgent);

// 改后（兼容新旧）
const isEEUIApp = window && window.navigator && (/eeui/i.test(window.navigator.userAgent) || /dootask_expo/i.test(window.navigator.userAgent));
```

```javascript
// 第 327-348 行：预加载逻辑
// 改前：等待 requireModuleJs 函数可用
if ($A.isEEUIApp) {
    const requireTime = new Date().getTime();
    while (typeof requireModuleJs !== "function") {
        await new Promise(resolve => setTimeout(resolve, 200));
        // ...
    }
    // ...
}

// 改后：等待 bridge 就绪（injectedJS 会设置 __EXPO_BRIDGE_READY__）
if ($A.isEEUIApp) {
    const requireTime = new Date().getTime();
    while (typeof requireModuleJs !== "function" && !window.__EXPO_BRIDGE_READY__) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (new Date().getTime() - requireTime > 15 * 1000) {
            break;
        }
    }
    if (typeof requireModuleJs !== "function" && !window.__EXPO_BRIDGE_READY__) {
        // 加载失败处理
        // ...
        return;
    }
    // 注意：injectedJS 已经提供了 requireModuleJs 的 polyfill
    // 所以到这里 requireModuleJs 一定是可用的
    const pageInfo = $A.eeuiAppGetPageInfo() || {};
    store.state.isFirstPage = pageInfo.pageName === 'firstPage';
    await store.dispatch("safeAreaInsets");
}
```

> 实际上因为 `injectedJavaScriptBeforeContentLoaded` 在页面加载前执行，`requireModuleJs` 在 Vue 代码运行时已经可用，所以这段等待逻辑可能直接通过。

### 8.2 `resources/assets/js/functions/eeui.js` 改造

**核心变化**：由于 `injectedJS` 已经提供了 `requireModuleJs` 的 Proxy 实现，大部分代码可以不用改。

**需要改的部分**——同步返回值的方法：

```javascript
// 以下方法原来直接返回同步值，需改为读取注入的缓存

// 改前
eeuiAppVersion() {
    return $A.eeuiModule()?.getVersion();
},

// 改后
eeuiAppVersion() {
    return window.__EXPO_INIT_DATA__?.version
        ?? $A.eeuiModule()?.getVersion();
},

// 类似地处理：
// eeuiAppLocalVersion() → window.__EXPO_INIT_DATA__?.version
// eeuiAppGetThemeName() → window.__EXPO_INIT_DATA__?.themeName
// eeuiAppKeyboardStatus() → window.__EXPO_INIT_DATA__?.keyboardVisible
// eeuiAppGetPageInfo() → window.__EXPO_INIT_DATA__?.pageInfo
```

**回调式方法（占大多数）不需要改**——Proxy 会自动将回调转为 Promise 响应。但需确保 RN 侧的响应格式与 EEUI 原生返回一致（特别是 `status`、`text`、`error` 等字段）。

### 8.3 其他前端文件（52 个，均无需改动）

经过全量扫描，共有 **52 个前端文件** 引用了 `isEEUIApp` 或 `eeuiAppXxx` 方法。这些文件全部通过以下两种方式访问 EEUI 功能：

1. **条件判断**：`$A.isEEUIApp` / `this.$isEEUIApp` — 用于隐藏 Tooltip、调整 UI 布局等
2. **方法调用**：`$A.eeuiAppXxx()` — 如 `eeuiAppGoDesktop()`、`eeuiAppGetLatestPhoto()` 等

只要 `eeui.js` 的桥接层接口签名不变、`app.js` 的检测逻辑兼容新 UA，**这 52 个文件全部不需要改动**。

主要涉及的文件（完整列表供参考）：

- `pages/login.vue` — 扫码登录判断、隐私协议、返回桌面
- `pages/manage.vue` — Tabbar 渲染
- `pages/manage/components/ChatInput/index.vue` — 最新照片获取、发送按钮适配
- `pages/manage/components/MeetingManager/index.vue` — 会议中消息发送
- `pages/manage/components/DialogWrapper.vue` — 对话框适配
- `pages/manage/messenger.vue` — 消息页面适配
- `components/Mobile/Back.vue` — Android 返回键
- `components/Mobile/Notification.vue` — 震动通知
- `components/Mobile/Tabbar.vue` — Badge 更新
- `store/actions.js` — SafeArea 获取
- `utils/file.js` — 文件打开方式
- `utils/index.js` — 缓存管理
- 以及其他约 40 个组件中的 `$isEEUIApp` 条件判断（主要用于隐藏 Tooltip 等 UI 细节）

---

## 9. 构建与 CI/CD 迁移

### 9.1 本地开发流程

```bash
# 1. 克隆独立仓库
cd ~/workspaces
git clone git@github.com:kuaifan/dootask-app.git
cd dootask-app && npm install

# 2. 构建 DooTask Vue SPA 并复制到 Expo 项目
cd ~/workspaces/dootask
./cmd prod
cp -r public/* ~/workspaces/dootask-app/assets/web/

# 3. 启动 Expo 开发（需要 dev-client，因为有 UMeng native module）
cd ~/workspaces/dootask-app
npx expo run:ios     # iOS（首次会编译原生项目）
npx expo run:android # Android（首次会编译原生项目）

# 开发期间前端改动可以直接用远程 URL 加载，避免每次复制
# WebView source 改为 { uri: 'http://LOCAL_IP:5173' }（Vite dev server）
```

### 9.2 `cmd` 脚本改造

由于 App 现在是独立仓库，DooTask 主仓库的 `cmd` 脚本只需保留前端资源构建，App 构建在独立仓库中进行。

```bash
# 改前
appbuild|buildapp)
    electron_operate app "$@"
    ;;
eeui)
    docker run ... kuaifan/eeui-cli:0.0.1 eeui "$@"
    ;;

# 改后：简化为导出前端资源
appbuild|buildapp)
    # 1. 构建前端资源
    npm_run prod
    # 2. 输出提示（不再自动复制到子模块）
    echo "前端资源已构建到 public/ 目录"
    echo "请手动复制到 dootask-app 项目：cp -r public/* ~/workspaces/dootask-app/assets/web/"
    ;;
# eeui 命令可以移除
```

**独立仓库 `dootask-app` 的构建命令**：

```bash
# 在 dootask-app/package.json scripts 中
{
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "build:android": "eas build --platform android",
    "build:ios": "eas build --platform ios",
    "build:all": "eas build --platform all",
    "submit:ios": "eas submit --platform ios",
    "submit:android": "eas submit --platform android"
  }
}
```

### 9.3 `electron/build.js` 改造

移除 EEUI 相关构建逻辑（约 570-604 行）。由于 App 已独立仓库，`electron/build.js` 中的 `case 'app'` 分支可以**直接删除**或简化为仅构建前端资源：

```javascript
// 改前：更新 local.properties / Version.xcconfig + Docker eeui-cli 构建
// 改后：直接删除 app 分支，或仅保留前端资源构建
case 'app': {
    // App 已迁移到独立仓库 dootask-app，此处仅构建前端资源
    execSync('npm run prod');
    console.log('前端资源已构建，请手动同步到 dootask-app 仓库');
    break;
}
```

> 版本号同步由 `dootask-app` 仓库的 `app.json` 独立管理，不再由 DooTask 主仓库控制。

### 9.4 GitHub Actions 改造

由于 App 是独立仓库，CI/CD 工作流在 **`dootask-app` 仓库** 中配置。

DooTask 主仓库的 `publish.yml` 和 `ios-publish.yml` 中移除移动端构建步骤（仅保留 Electron 桌面端和前端资源构建）。

#### `dootask-app` 仓库的 CI/CD 工作流

```yaml
# .github/workflows/build.yml（在 dootask-app 仓库中）
name: Build and Deploy

on:
  workflow_dispatch:
    inputs:
      platform:
        description: 'Platform to build'
        required: true
        type: choice
        options: [android, ios, all]

jobs:
  build-assets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # 从 DooTask 主仓库构建前端资源
      - name: Checkout DooTask
        uses: actions/checkout@v4
        with:
          repository: kuaifan/dootask
          path: dootask
          ref: pro

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Build Frontend Assets
        run: |
          cd dootask
          npm install
          ./cmd prod
          cp -r public/* $GITHUB_WORKSPACE/assets/web/

      - name: Upload Assets
        uses: actions/upload-artifact@v4
        with:
          name: frontend-assets
          path: assets/web/

  build-app:
    needs: build-assets
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Download Assets
        uses: actions/download-artifact@v4
        with:
          name: frontend-assets
          path: assets/web/

      - name: Setup Expo
        uses: expo/expo-github-action@v8
        with:
          expo-version: latest
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}

      - name: Install Dependencies
        run: npm install

      - name: Build
        run: npx eas build --platform ${{ inputs.platform }} --non-interactive

      # iOS 自动提交 App Store
      - name: Submit iOS
        if: inputs.platform == 'ios' || inputs.platform == 'all'
        run: npx eas submit --platform ios --non-interactive
```

### 9.5 所需的 Secrets 配置

| Secret 名称 | 用途 | 说明 |
|-------------|------|------|
| `EXPO_TOKEN` | EAS CLI 认证 | 在 expo.dev 生成 |
| `APPLE_ID` | App Store 提交 | eas.json 中配置 |
| `ASC_APP_ID` | App Store Connect App ID | eas.json 中配置 |
| `APPLE_TEAM_ID` | Apple 开发者团队 ID | eas.json 中配置 |
| `GOOGLE_SERVICES_JSON` | Google Play 上架所需（非推送） | 仅 Android 提交 Google Play 时需要 |

---

## 10. 分阶段实施计划

### Phase 0：准备工作（0.5 天）

- [ ] 注册 Expo 账号，创建项目
- [ ] 确认 Apple Developer / Google Play Console 账号状态
- [ ] 创建独立 Git 仓库 `dootask-app`

### Phase 1：Expo 壳搭建 + WebView 加载（3-4 天）

- [ ] `npx create-expo-app ~/workspaces/dootask-app --template blank-typescript`
- [ ] 安装核心依赖（详见 3.4 节完整列表）
- [ ] 实现本地 HTTP Server + 资源打包（详见 12.3、17.2、17.3 节）
- [ ] 配置 withWebAssets Config Plugin 确保 `assets/web/` 打包进 App（详见 17.2 节）
- [ ] 生成 `config.js`（`window.systemInfo`，详见 12.4 节）
- [ ] 配置 React Navigation Stack（App.tsx，详见 13.2 节）
- [ ] 编写 `MainScreen.tsx`：firstPage WebView（详见 13.3 节）
- [ ] 编写 `ChildWebViewScreen.tsx`：子页面 WebView（详见 13.4 节）
- [ ] 编写 `injectedJS.ts`：完整版含多次回调支持（详见 17.6 节）
- [ ] 编写 `bridge/index.ts`：完整消息路由（详见 17.4 节）
- [ ] 构建 User-Agent 字符串（`dootask_expo/版本号`，详见附录 A）
- [ ] 实现 App 启动序列（详见 17.1 节）
- [ ] 实现 `openPage` 桥接（创建子页面，详见 13.5 节）
- [ ] 验证：输入服务器地址 → 本地 WebView 加载 → 登录页显示 → openPage 子页面正常打开和返回

### Phase 2：核心桥接 API 实现（3-4 天）

- [ ] 键盘控制：`keyboardHide`、`keyboardStatus`
- [ ] 屏幕控制：`keepScreenOn`、`keepScreenOff`
- [ ] 导航：`openWeb`、`goDesktop`、`setPageBackPressed`（Android 返回键）
- [ ] UI：`alert`（注意参数格式，详见 14.2 节）、`toast`、`copyText`
- [ ] 存储：`setVariate`/`getVariate`（内存 Map + 多 WebView 同步，详见 14.3 节）
- [ ] 存储：`setCachesString`/`getCachesString`（AsyncStorage 持久化，详见 14.4 节）
- [ ] WebView 控制：`sendMessage`、`setUrl`、`setScrollEnabled`
- [ ] 震动反馈：`setHapticBackEnabled`
- [ ] 长按禁用：`setDisabledUserLongClickSelect`（CSS 注入）
- [ ] 页面生命周期：`pause`/`resume` 回调（地图定位页面依赖，详见 13.6 节）
- [ ] App 前后台切换：`AppState` → `__onPagePause`/`__onPageResume`（详见 17.8 节）
- [ ] WebView 媒体权限：麦克风/摄像头授权，支持会议功能（详见 17.9 节）
- [ ] 验证：所有桥接方法在 iOS 和 Android 真机上可用，特别关注多 WebView 间 storage 同步

### Phase 3：扫码 + 相册功能（2-3 天）

- [ ] 安装 `react-native-vision-camera`（不用 expo-camera 的扫码，避免 Google 服务依赖）
- [ ] 扫码页面：`ScannerScreen.tsx`（参考 `~/workspaces/happy-next` 的实现）
- [ ] 相册：`getLatestPhoto` 实现（expo-media-library）
- [ ] 拍照：`expo-image-picker` 集成
- [ ] 照片上传：`uploadPhoto` + 进度回调 + 取消功能
- [ ] WebView 快照：`react-native-view-shot` 集成
- [ ] 验证：扫码、拍照、选图、上传在**无 Google 服务的 Android 真机**上正常工作

### Phase 4：推送通知 — UMeng 集成（3-4 天）

- [ ] 创建 UMeng Config Plugin (`plugins/withUmengPush.ts`，详见 6.3.1 节)
- [ ] 编写 UMeng Native Module - Kotlin (`UmengPushModule.kt`，详见 6.3.2 节)
- [ ] 编写 UMeng Native Module - Swift（iOS 端 UMeng SDK 初始化）
- [ ] 统一推送注册服务 (`src/services/push.ts`，详见 6.3.3 节)
- [ ] 对接 `sendMessage` 的 `setUmengAlias`/`delUmengAlias` 命令（详见 17.7 节）
- [ ] Badge 数量同步（`sendMessage` 的 `setBdageNotify` 命令）
- [ ] 验证：iOS + Android 推送均正常到达，点击通知可跳转

### Phase 5：前端 + 后端适配（1-2 天）

- [ ] 前端 `app.js`：UA 检测兼容
- [ ] 前端 `eeui.js`：同步方法改为缓存读取
- [ ] 后端 `Base.php`：`isEEUIApp()` 兼容新 UA
- [ ] 后端 `UserDevice.php`：设备识别兼容新 UA
- [ ] 后端 `IndexController.php`：PDF 预览等逻辑兼容
- [ ] 验证：新旧 App 可以同时正常使用

### Phase 6：构建与发布流程（1-2 天）

- [ ] 配置 `eas.json`（development / preview / production）
- [ ] 在 `dootask-app` 仓库中配置 GitHub Actions
- [ ] DooTask 主仓库：简化 `cmd` 的 `appbuild` 命令（仅构建前端资源）
- [ ] DooTask 主仓库：`electron/build.js` 移除 EEUI 逻辑
- [ ] DooTask 主仓库：`publish.yml` / `ios-publish.yml` 移除移动端构建步骤
- [ ] 首次 EAS Build 测试（development profile）
- [ ] 验证：CI/CD 自动构建 + 提交应用商店

### Phase 7：OTA 热更新 + 收尾（1-2 天）

- [ ] 配置 `expo-updates`
- [ ] 实现 `checkUpdate()` 方法对接 EAS Update
- [ ] DooTask 主仓库：移除 `resources/mobile` 子模块引用和 `.gitmodules` 条目
- [ ] DooTask 主仓库：移除 `cmd` 中的 `eeui` 命令
- [ ] 文档更新（两个仓库的 README、DooTask 的 CLAUDE.md）
- [ ] 验证：OTA 更新推送 + App 自动更新

### 时间线总估：15-23 天

---

## 11. 风险与注意事项

### 11.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Proxy 兼容性 | 老版 WebView 可能不支持 ES6 Proxy | 检查最低 OS 版本要求（Android 5+/iOS 12+ 已支持） |
| 同步→异步改造遗漏 | 个别方法返回 Promise 而非值，导致判断逻辑出错 | Phase 2 逐一验证所有同步方法 |
| UMeng Expo Plugin 维护成本 | Android 自定义 native module 需跟随 Expo SDK 升级 | UMeng SDK API 稳定，升级成本低；仅 Android 需要 |
| WebView 文件加载 | `file://` 协议可能有跨域限制 | 使用 expo-asset 或本地 HTTP server |
| App Store 审核 | 纯 WebView App 可能被拒 | 确保有足够原生功能（推送、扫码等） |

### 11.2 注意事项

1. **App ID 不变**：`com.dootask.task` 必须与现有应用一致，否则无法覆盖安装更新
2. **签名证书迁移**：Android keystore 和 iOS 证书/Provisioning Profile 需迁移到 EAS 或继续本地管理
3. **版本号衔接**：新 App 的 versionCode/buildNumber 必须大于当前已发布版本
4. **独立仓库协调**：前端资源构建在 DooTask 主仓库，App 构建在独立仓库，需要建立清晰的版本对应关系和资源同步流程
5. **灰度发布**：建议先内部测试（EAS internal distribution），再上架
6. **旧版兼容期**：后端 UA 识别应同时支持新旧标识，直到所有用户升级到新 App
7. **WebView 调试**：开发期间启用 WebView 远程调试（Android Chrome DevTools / iOS Safari Web Inspector）

### 11.3 回退方案

如果 Expo 迁移遇到阻塞性问题，EEUI 子模块仍保留在 git 历史中，可以随时切回。建议在确认新 App 稳定后再清理旧代码。

---

## 12. 本地资源加载方案

### 12.1 策略：App 内 HTTP Server

与 Electron 版本一致（Electron 在 `localhost:22223` 启动 Express 服务），Expo 版本在 App 启动时启动本地 HTTP server 加载打包进 assets 的 Vue SPA。

**为什么不用 `file://` 协议**：
- `file://` 存在 CORS 限制，很多 Web API（如 fetch、WebSocket）无法正常工作
- Cookie 和 LocalStorage 在 `file://` 下行为不一致
- EEUI 原版也是用 HTTP 协议加载的

**依赖**：`react-native-static-server` 或 `@philipdev/react-native-static-server`

```json
{
  "react-native-static-server": "^0.5.0"
}
```

### 12.2 资源打包流程

```
DooTask 主仓库                       dootask-app 仓库
┌──────────────┐                    ┌──────────────────┐
│ ./cmd prod   │──→ public/ ──→ cp ──→│ assets/web/      │
│ (Vite build) │                    │  ├── index.html   │
└──────────────┘                    │  ├── config.js    │
                                    │  ├── js/build/    │
                                    │  ├── css/         │
                                    │  ├── images/      │
                                    │  └── ...          │
                                    └──────────────────┘
```

> 注意：放在 `assets/web/` 而不是 `public/`，因为 `public/` 在 Expo 中有特殊含义。

### 12.3 本地 HTTP Server 实现

```typescript
// src/services/localServer.ts
import StaticServer from 'react-native-static-server';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

const PORT = 22224; // 避免与 Electron 的 22223 冲突

let server: StaticServer | null = null;
let serverUrl: string | null = null;

export async function startLocalServer(): Promise<string> {
  if (serverUrl) return serverUrl;

  // assets/web 目录在打包后的位置
  const basePath = Platform.OS === 'android'
    ? `${RNFS.DocumentDirectoryPath}/web`  // Android: 需要先从 assets 复制
    : `${RNFS.MainBundlePath}/assets/web`; // iOS: 直接访问 bundle

  // Android 需要将 assets 复制到可访问的目录
  if (Platform.OS === 'android') {
    await copyAssetsToDocuments();
  }

  server = new StaticServer(PORT, basePath, {
    localOnly: true,        // 仅本机可访问
    keepAlive: true,
  });

  serverUrl = await server.start();
  console.log('Local server started at:', serverUrl);
  return serverUrl; // http://localhost:22224
}

export function getLocalServerUrl(): string | null {
  return serverUrl;
}

export async function stopLocalServer() {
  if (server) {
    await server.stop();
    server = null;
    serverUrl = null;
  }
}
```

> **备选方案**：如果 `react-native-static-server` 维护不理想，也可以用 `react-native-webview` 的 `originWhitelist` + `source={{ uri: ... }}` 配合 `expo-asset` 来加载本地文件，但需要额外处理 SPA 路由。实施时应先验证可行性。

### 12.4 config.js 生成

WebView 中的 Vue SPA 依赖 `window.systemInfo` 全局对象。打包时需要生成正确的 `config.js`：

```javascript
// assets/web/config.js — 由 DooTask 的 ./cmd prod 构建时自动生成
window.systemInfo = {
  title: "DooTask",
  debug: "no",
  version: "1.7.23",
  origin: "./",
  homeUrl: "./",
  apiUrl: "./api/",        // Vue SPA 启动时会从 localForage 读取 cacheServerUrl 覆盖此值
  codeVersion: 230
};
```

**服务器地址由 Vue SPA 自己管理**：用户在 Vue SPA 的登录页面输入服务器地址，存储在 localForage 的 `cacheServerUrl` 中。Vue SPA 启动时自动读取并设置 `window.systemInfo.apiUrl = state.cacheServerUrl`。原生层不需要干预。

### 12.5 OTA 更新 Web 资源

打包在 App 内的 Web 资源更新有两种方式：

1. **Expo Updates (EAS Update)**：更新整个 JS bundle（包含 Web 资源），无需重新提交应用商店
2. **自定义热更新**：App 启动时检查服务器版本号，如果有新版 Web 资源则下载到本地替换

建议 Phase 7 中实现方式 1（Expo Updates），作为基础更新机制。

---

## 13. 多 WebView 导航架构

### 13.1 设计概述

EEUI 的 `openPage` 会创建新的原生页面（独立 WebView）。在 Expo 中通过 **React Navigation Stack** 实现相同效果：

```
Navigation Stack
├── MainScreen (WebView #0, pageName='firstPage')
│   └── user navigates within Vue SPA (Vue Router)
│
├── ChildScreen #1 (WebView #1, 文件预览)  ← openPage 创建
│
├── ChildScreen #2 (WebView #2, 地图定位)  ← openPage 创建
│
└── ScannerScreen (扫码，非 WebView)       ← openScaner 创建
```

### 13.2 导航配置

```typescript
// src/App.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainScreen } from './screens/MainScreen';
import { ChildWebViewScreen } from './screens/ChildWebViewScreen';
import { ScannerScreen } from './screens/ScannerScreen';

export type RootStackParamList = {
  Main: undefined;
  ChildWebView: {
    url: string;
    title?: string;
    titleFixed?: boolean;
    pageId: string;       // 唯一页面 ID
  };
  Scanner: {
    scanId: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainScreen} />
        <Stack.Screen
          name="ChildWebView"
          component={ChildWebViewScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Scanner"
          component={ScannerScreen}
          options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

### 13.3 MainScreen（主页面，firstPage）

```typescript
// src/screens/MainScreen.tsx
import React, { useRef, useState, useCallback } from 'react';
import { SafeAreaView, BackHandler, StatusBar } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { injectedJS } from '../bridge/injectedJS';
import { createBridgeHandler } from '../bridge';
import { getLocalServerUrl } from '../services/localServer';
import { buildUserAgent } from '../utils/userAgent';

export function MainScreen() {
  const webViewRef = useRef<WebView>(null);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [showScanner, setShowScanner] = useState(false);

  const bridgeHandler = createBridgeHandler({
    webViewRef,
    navigation,
    insets,
    isFirstPage: true,
    pageId: 'firstPage',
  });

  const onMessage = useCallback(async (event) => {
    const msg = JSON.parse(event.nativeEvent.data);
    if (msg.type !== 'bridge_request') return;
    const response = await bridgeHandler(msg);
    webViewRef.current?.postMessage(JSON.stringify(response));
  }, [bridgeHandler]);

  // Android 返回键
  React.useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // 通知 WebView 处理返回
      webViewRef.current?.injectJavaScript(`
        window.dispatchEvent(new CustomEvent('bridge_event', {
          detail: { type: 'bridge_event', event: 'backPressed' }
        }));
        true;
      `);
      return true; // 阻止默认返回
    });
    return () => handler.remove();
  }, []);

  const serverUrl = getLocalServerUrl();

  return (
    <SafeAreaView style={{ flex: 1 }} edges={[]}>
      <StatusBar translucent backgroundColor="transparent" />
      <WebView
        ref={webViewRef}
        source={{ uri: `${serverUrl}/index.html#/` }}
        userAgent={buildUserAgent()}
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        onMessage={onMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowsBackForwardNavigationGestures={false}
        allowFileAccess={true}
        mixedContentMode="always"
        originWhitelist={['*']}
        // 键盘弹出时自动调整 WebView 大小（等同 softInputMode: "resize"）
        automaticallyAdjustContentInsets={true}
        keyboardDisplayRequiresUserAction={false}
        style={{ flex: 1 }}
      />
    </SafeAreaView>
  );
}
```

### 13.4 ChildWebViewScreen（子页面）

```typescript
// src/screens/ChildWebViewScreen.tsx
import React, { useRef, useCallback } from 'react';
import { SafeAreaView, BackHandler, View, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { injectedJS } from '../bridge/injectedJS';
import { createBridgeHandler } from '../bridge';
import { buildUserAgent } from '../utils/userAgent';
import type { RootStackParamList } from '../App';

type ChildRoute = RouteProp<RootStackParamList, 'ChildWebView'>;

export function ChildWebViewScreen() {
  const webViewRef = useRef<WebView>(null);
  const navigation = useNavigation();
  const route = useRoute<ChildRoute>();
  const insets = useSafeAreaInsets();
  const { url, title, titleFixed, pageId } = route.params;

  const bridgeHandler = createBridgeHandler({
    webViewRef,
    navigation,
    insets,
    isFirstPage: false,
    pageId,
  });

  const onMessage = useCallback(async (event) => {
    const msg = JSON.parse(event.nativeEvent.data);
    if (msg.type !== 'bridge_request') return;
    const response = await bridgeHandler(msg);
    webViewRef.current?.postMessage(JSON.stringify(response));
  }, [bridgeHandler]);

  // Android 返回键 → 返回上一页
  React.useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.goBack();
      return true;
    });
    return () => handler.remove();
  }, [navigation]);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      {/* 可选：顶部导航栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontSize: 16 }}>← 返回</Text>
        </TouchableOpacity>
        {title ? <Text style={{ flex: 1, textAlign: 'center', fontSize: 16 }} numberOfLines={1}>{title}</Text> : null}
        <View style={{ width: 44 }} />
      </View>
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        userAgent={buildUserAgent()}
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        onMessage={onMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        mixedContentMode="always"
        originWhitelist={['*']}
        automaticallyAdjustContentInsets={true}
        keyboardDisplayRequiresUserAction={false}
        style={{ flex: 1 }}
      />
    </SafeAreaView>
  );
}
```

### 13.5 openPage 桥接实现

当 WebView 调用 `$A.eeuiAppOpenPage()` 时，桥接层的处理逻辑：

```typescript
// src/bridge/handlers/navigation.ts
import { getLocalServerUrl } from '../../services/localServer';

interface OpenPageParams {
  url?: string;           // 'web.js'（EEUI 固定值，忽略）
  pageType?: string;      // 'app'
  pageTitle?: string;     // 标题
  params?: {
    url: string;          // 实际要加载的 URL
    titleFixed?: boolean;
    hiddenDone?: boolean;
    allowAccess?: boolean;
    showProgress?: boolean;
  };
  softInputMode?: string; // 'resize'
}

export function handleOpenPage(
  args: any[],
  navigation: any,
  pageId: string,
): { listenForPause: boolean; childPageId: string } {
  const params: OpenPageParams = args[0] || {};
  let targetUrl = params.params?.url || params.url || '';
  const childPageId = `child_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  // URL 处理：
  // 1. 如果是相对路径（/single/file/123），拼接本地 server 地址
  // 2. 如果是完整 URL（https://...），直接使用
  const serverUrl = getLocalServerUrl();
  if (targetUrl.startsWith('/') || targetUrl.startsWith('#')) {
    // 内部路由 — 使用本地 server + hash 路由
    targetUrl = `${serverUrl}/index.html#${targetUrl}`;
  } else if (!targetUrl.startsWith('http')) {
    targetUrl = `${serverUrl}/${targetUrl}`;
  }

  navigation.navigate('ChildWebView', {
    url: targetUrl,
    title: params.pageTitle || '',
    titleFixed: params.params?.titleFixed ?? false,
    pageId: childPageId,
  });

  return { listenForPause: !!params.callback, childPageId };
}
```

### 13.6 页面生命周期回调（pause/resume）

EEUI 的 `openPage` 支持 `callback`，当子页面暂停/恢复时通知父页面。目前只有地图定位页面用到 `status === 'pause'`。

在 Expo 中通过 React Navigation 的 `focus`/`blur` 事件模拟：

```typescript
// src/bridge/handlers/navigation.ts 续

// 在 MainScreen 或 ChildWebViewScreen 中监听 focus 事件
export function setupPageLifecycleListener(
  navigation: any,
  webViewRef: React.RefObject<WebView>,
  pageId: string,
) {
  // 当前页面获得焦点（子页面关闭后回到当前页面）
  const unsubscribe = navigation.addListener('focus', () => {
    // 通知 WebView 当前页面恢复
    webViewRef.current?.injectJavaScript(`
      window.dispatchEvent(new CustomEvent('bridge_event', {
        detail: { type: 'bridge_event', event: 'pageResume', data: { pageId: '${pageId}' } }
      }));
      true;
    `);
  });

  return unsubscribe;
}
```

对于地图页面的 `pause` 回调，由于它依赖 `eeuiAppGetVariate` 来传递数据，桥接层需要在子页面关闭（`navigation.goBack()`）时，触发父页面的 callback：

```typescript
// 桥接中维护一个全局回调 Map
const pageCallbacks = new Map<string, (status: string) => void>();

// openPage 时注册 callback
export function registerPageCallback(childPageId: string, callback: (status: string) => void) {
  pageCallbacks.set(childPageId, callback);
}

// 子页面关闭时触发
export function onChildPageClosed(childPageId: string) {
  const callback = pageCallbacks.get(childPageId);
  if (callback) {
    callback({ status: 'pause' }); // EEUI 回调传对象 {status}，见 actions.js:1351
    pageCallbacks.delete(childPageId);
  }
}
```

### 13.7 isFirstPage 逻辑

- **MainScreen** 的 WebView 是 `firstPage`（`pageName === 'firstPage'`）
- **ChildWebViewScreen** 的 WebView 不是 `firstPage`
- 注入到 WebView 的初始数据中需要包含 `pageInfo`：

```javascript
// MainScreen 的 injectedJS 中
window.__EXPO_INIT_DATA__ = {
  // ...
  pageInfo: { pageName: 'firstPage' },
};

// ChildWebViewScreen 的 injectedJS 中
window.__EXPO_INIT_DATA__ = {
  // ...
  pageInfo: { pageName: 'childPage_xxx' },
};
```

---

## 14. 桥接响应格式契约

### 14.1 概述

EEUI 的回调函数期望特定的响应格式。RN 侧必须返回**完全相同的格式**，否则前端代码的条件判断会失败。

### 14.2 逐方法格式说明

#### 扫码 openScaner

```javascript
// EEUI 回调格式
callback({
  status: 'success',  // 'success' | 'error'
  text: '扫码结果文本'
})
```

**扫码是单次回调**（`eeui.js:140` 只在 `status === 'success'` 时调用一次 callback），不需要多次回调机制。

RN 侧实现：`createBridgeHandler` 中的 `openScaner` case 返回一个 Promise，扫码完成后 resolve `{ status: 'success', text: '扫码结果' }`。Proxy 层自动将 resolve 的值传给 callback。详见 17.4 节和 17.5 节的完整流程。

#### getLatestPhoto

```javascript
// EEUI 回调格式
callback({
  status: 'success',          // 'success' | 'error'
  error: '',                  // 错误信息（失败时）
  created: 1713200000,        // Unix 时间戳（秒）
  thumbnail: {
    base64: 'data:image/...',  // 缩略图 base64
    width: 200,
  },
  original: {
    path: '/path/to/photo.jpg', // 原图本地路径
    width: 1920,
  }
})
```

#### uploadPhoto

**多次回调**，依次触发：

```javascript
// 第 1 次：准备就绪
callback({ status: 'ready', id: 'upload_123' })

// 第 2 次（可选）：上传进度
// EEUI 原版不一定有进度回调，但预留

// 第 3 次：上传结果
callback({
  status: 'success',  // 'success' | 'error'
  error: '',
  data: { ret: 1, msg: 'ok', data: { ... } }  // 服务器返回的 JSON
})
```

**重要**：Proxy 的 callback 模式只调用一次 `.then()`，但 `uploadPhoto` 需要多次回调。解决方案：

```typescript
// RN 侧处理 uploadPhoto
case 'uploadPhoto': {
  const params = args[0];

  // 第一次回调：ready
  const uploadId = `upload_${Date.now()}`;
  webViewRef.current?.injectJavaScript(`
    window.__bridgeCallbacks__?.['${msg.id}']?.({ status: 'ready', id: '${uploadId}' });
    true;
  `);

  // 执行上传
  try {
    const result = await FileSystem.uploadAsync(params.url, params.path, {
      fieldName: params.fieldName || 'file',
      httpMethod: 'POST',
      headers: params.headers || {},
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    });

    // 最终回调：success
    const responseData = JSON.parse(result.body);
    webViewRef.current?.injectJavaScript(`
      window.__bridgeCallbacks__?.['${msg.id}']?.({ status: 'success', data: ${result.body} });
      delete window.__bridgeCallbacks__?.['${msg.id}'];
      true;
    `);
  } catch (e) {
    webViewRef.current?.injectJavaScript(`
      window.__bridgeCallbacks__?.['${msg.id}']?.({ status: 'error', error: '${e.message}' });
      delete window.__bridgeCallbacks__?.['${msg.id}'];
      true;
    `);
  }
  return; // 不通过标准 bridge_response 返回
}
```

需要在 `injectedJS` 中增加持久回调注册：

```javascript
// injectedJS 补充 — 持久回调（支持多次调用）
window.__bridgeCallbacks__ = {};

// 在 createModuleProxy 中，如果方法需要多次回调，注册到 __bridgeCallbacks__
// 特殊方法列表：
const MULTI_CALLBACK_METHODS = ['uploadPhoto']; // openScaner 是单次回调，不在此列
```

#### getSafeAreaInsets

```javascript
// EEUI 回调格式
callback({
  status: 'success',
  top: 44,      // 状态栏高度（像素）
  bottom: 34,   // 底部安全区高度（像素）
  height: 812,  // 屏幕高度（像素）
})
```

#### getDeviceInfo

```javascript
// EEUI 回调格式（必须包含以下全部字段，App.vue:234 依赖）
callback({
  status: 'success',
  brand: 'Apple',              // 品牌
  model: 'iPhone16,1',         // 型号标识
  modelName: 'iPhone 15 Pro',  // 型号名称
  deviceName: 'My iPhone',     // 设备名称
  systemName: 'iOS',           // 系统名称
  systemVersion: '17.0',       // 系统版本
})
```

#### alert

```javascript
// EEUI 参数格式
eeui.alert({
  title: '标题',
  message: '内容',
  buttons: ['取消', '确定'],
}, callback)

// callback(index) — 按钮索引
```

#### toast

```javascript
// EEUI 参数格式
eeui.toast({ message: '提示文本', gravity: 'bottom' })
// 无回调
```

### 14.3 全局变量桥接（setVariate / getVariate）

这两个方法在 EEUI 中是**同步的**，用于跨 WebView 页面通信（如地图定位页面）。

RN 侧维护一个内存 Map：

```typescript
// src/bridge/handlers/storage.ts
const variateStore = new Map<string, string>();

export function setVariate(key: string, value: string) {
  variateStore.set(key, value);
}

export function getVariate(key: string, defaultVal: string = ''): string {
  return variateStore.get(key) ?? defaultVal;
}
```

**关键**：`getVariate` 在 EEUI 中是同步返回值的。在 Proxy 模式下会变成 Promise。需要在 `eeui.js` 的 `eeuiAppGetVariate` 中做适配：

```javascript
// eeui.js 改造
eeuiAppGetVariate(key, defaultVal = "") {
    // 优先从注入的缓存中读取
    return window.__EXPO_VARIATES__?.[key]
        ?? $A.eeuiModule()?.getVariate(key, defaultVal);
},
```

RN 侧在 `setVariate` 时同步注入到所有活跃的 WebView：

```typescript
// setVariate 时同步更新所有 WebView 的缓存
function syncVariateToWebViews(key: string, value: string) {
  activeWebViews.forEach(ref => {
    ref.current?.injectJavaScript(`
      window.__EXPO_VARIATES__ = window.__EXPO_VARIATES__ || {};
      window.__EXPO_VARIATES__['${key}'] = ${JSON.stringify(value)};
      true;
    `);
  });
}
```

### 14.4 缓存桥接（setCachesString / getCachesString）

与 `setVariate` / `getVariate` 类似，但需要**持久化**。使用 `expo-secure-store` 或 `AsyncStorage`：

```typescript
// src/bridge/handlers/storage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function setCachesString(key: string, value: string, expired: number = 0) {
  const data = { value, expired: expired > 0 ? Date.now() + expired * 1000 : 0 };
  await AsyncStorage.setItem(`cache_${key}`, JSON.stringify(data));
}

export async function getCachesString(key: string, defaultVal: string = ''): Promise<string> {
  const raw = await AsyncStorage.getItem(`cache_${key}`);
  if (!raw) return defaultVal;
  const data = JSON.parse(raw);
  if (data.expired > 0 && Date.now() > data.expired) {
    await AsyncStorage.removeItem(`cache_${key}`);
    return defaultVal;
  }
  return data.value;
}
```

**同步→异步适配**：与 `getVariate` 类似，`getCachesString` 需要在 `eeui.js` 中改为从注入缓存读取。

---

## 15. userUrl 处理与子页面认证

### 15.1 问题

`openAppChildPage` 会通过 Vuex `userUrl` action 处理 URL，自动添加 `token`、`language`、`theme`、`userid` 等参数。这对子页面的认证至关重要。

### 15.2 userUrl 的逻辑（来自 DooTask store/actions.js:1290-1319）

```javascript
userUrl({state}, url) {
    return new Promise(resolve => {
        // 如果 URL 是访问本服务器域名 且 当前是本地环境，则替换为本地路径
        if ($A.getDomain(url) == $A.mainDomain() && isLocalHost(window.location)) {
            try {
                const remoteURL = new URL(url)
                if (/^\/(single|meeting)\//.test(remoteURL.pathname)) {
                    const localURL = new URL(window.location)
                    localURL.hash = remoteURL.pathname + remoteURL.search
                    return resolve(localURL.toString())
                }
            } catch (e) {}
        }

        const params = {
            language: languageName,
            theme: state.themeConf,
            userid: state.userId,
        }
        // 如果是同域或本地 URL，附加 token
        if ($A.getDomain(url) == $A.mainDomain() || isLocalHost(url)) {
            params.token = state.userToken
        }
        resolve($A.urlAddParams(url, params))
    })
},
```

### 15.3 Expo 中的处理

这段逻辑在 **Vue SPA 内部**执行（Vuex action），**不需要在 RN 侧处理**。

只要确保：
1. 子 WebView 加载的 URL 经过 `openAppChildPage` dispatch 处理（已有逻辑）
2. 子 WebView 的 `document.cookie` 和 `localStorage` 与主 WebView 共享同源

由于所有 WebView 都通过 `http://localhost:22224` 加载，它们**天然同源**，cookie 和 storage 共享。

### 15.4 urlReplaceHash 说明

EEUI 使用 hash 路由模式，`urlReplaceHash(path)` 将路径转为 `http://localhost:22224/index.html#/single/file/123` 格式。

**无需额外处理**：`openAppChildPage` action 内部会调用 `$A.urlReplaceHash(path)` 再传给 `eeuiAppOpenPage`。RN 侧的 `handleOpenPage` 只需处理最终 URL。

---

## 16. 开发调试流程

### 16.1 日常开发（推荐流程）

```bash
# 终端 1：启动 DooTask 前端 dev server（Vite HMR）
cd ~/workspaces/dootask
./cmd dev
# → http://localhost:5173

# 终端 2：启动 Expo 开发
cd ~/workspaces/dootask-app
npx expo run:ios     # 或 npx expo run:android
```

**开发期间 WebView 直接加载 Vite dev server**，不需要每次复制资源：

```typescript
// src/screens/MainScreen.tsx — 开发模式
const DEV_MODE = __DEV__;
const devServerUrl = 'http://LOCAL_IP:5173';  // 注意用局域网 IP，不是 localhost

<WebView
  source={{ uri: DEV_MODE ? devServerUrl : `${getLocalServerUrl()}/index.html#/` }}
  // ...
/>
```

> 注意：开发模式下需要用电脑的**局域网 IP**（如 `192.168.1.100`），因为模拟器/真机的 localhost 指向自身。

### 16.2 调试技巧

1. **WebView 远程调试**：
   - Android：Chrome → `chrome://inspect` → 选择 WebView
   - iOS：Safari → Develop → 选择设备 → 选择 WebView

2. **RN 原生调试**：
   - `console.log` 输出到 Metro bundler 终端
   - React Native Debugger 或 Flipper

3. **桥接调试**：在 `injectedJS` 中添加日志：
   ```javascript
   console.log('[Bridge] Request:', JSON.stringify(msg));
   console.log('[Bridge] Response:', JSON.stringify(response));
   ```

### 16.3 生产构建测试

```bash
# 1. 构建 Vue SPA
cd ~/workspaces/dootask && ./cmd prod

# 2. 复制到 Expo 项目
cp -r public/* ~/workspaces/dootask-app/assets/web/

# 3. 构建 development 版本测试
cd ~/workspaces/dootask-app
npx eas build --profile development --platform ios  # 或 android

# 4. 安装到真机测试
```

---

## 附录 A：RN 侧 User-Agent 构建

```typescript
// src/utils/userAgent.ts
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function buildUserAgent(): string {
  const version = Constants.expoConfig?.version || '0.0.0';
  const platform = Platform.OS; // 'ios' | 'android'
  const brand = Device.brand || 'Unknown';
  const model = Device.modelName || 'Unknown';
  const osVersion = Device.osVersion || '';

  // 格式保持与旧版类似，方便后端识别
  return `Mozilla/5.0 (${brand} ${model}; ${Platform.OS} ${osVersion}) ${platform}_dootask_expo/${version}`;
}
```

在 WebView 中设置：

```tsx
<WebView
  userAgent={buildUserAgent()}
  // ...
/>
```

## 附录 B：桥接路由示例

> **注意**：此附录为早期草稿，已被 17.4 节（createBridgeHandler 完整实现）和 17.7 节（sendMessage 命令总线）取代。如有冲突，以第 17 节为准。

```typescript
// src/bridge/index.ts（早期草稿，完整版见 17.4 节）
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Keyboard, Alert, BackHandler, Linking, Appearance } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

type BridgeRequest = {
  type: 'bridge_request';
  id: string;
  module: string;
  method: string;
  args: any[];
};

export async function handleBridgeRequest(msg: BridgeRequest): Promise<any> {
  const { module, method, args } = msg;

  // eeui 主模块
  if (module === 'eeui') {
    switch (method) {
      case 'getVersion':
        return Constants.expoConfig?.version;

      case 'getThemeName':
        return Appearance.getColorScheme() || 'light';

      case 'keyboardHide':
        Keyboard.dismiss();
        return null;

      case 'keepScreenOn':
        await activateKeepAwakeAsync();
        return null;

      case 'keepScreenOff':
        deactivateKeepAwake();
        return null;

      case 'openWeb':
        await Linking.openURL(args[0]);
        return null;

      case 'goDesktop':
        BackHandler.exitApp();
        return null;

      case 'alert':
        return new Promise((resolve) => {
          Alert.alert(args[0]?.title || '', args[0]?.message || '', [
            { text: 'OK', onPress: () => resolve({ status: 'ok' }) },
          ]);
        });

      case 'copyText':
        await Clipboard.setStringAsync(args[0]);
        return null;

      case 'openScaner':
        // 触发 RN 状态更新，显示扫码页面
        // 通过 EventEmitter 或 state callback 实现
        return { status: 'pending' }; // 扫码结果通过 bridge_event 推送

      // ... 其他方法
      default:
        throw new Error(`Unknown eeui method: ${method}`);
    }
  }

  // webview 模块
  if (module === 'webview') {
    switch (method) {
      case 'setScrollEnabled':
        // 通过 state 更新 WebView 的 scrollEnabled prop
        return null;

      case 'sendMessage':
        // WebView 向原生层发命令（完整版见 17.7 节）
        return null;

      default:
        throw new Error(`Unknown webview method: ${method}`);
    }
  }

  throw new Error(`Unknown module: ${module}`);
}
```

---

## 17. 关键实现细节补充

以下内容是 AI 独立开发时**最容易卡住的地方**，务必仔细阅读。

### 17.1 App 启动序列

**服务器地址由 Vue SPA 自己管理**（登录页面中输入，存储在 localForage 的 `cacheServerUrl` 中，启动时自动设置 `window.systemInfo.apiUrl`）。原生层不需要处理服务器地址。

```
App Launch
    │
    ├─ 1. 启动本地 HTTP Server（加载 assets/web/ 中的 Vue SPA）
    │     └── 等待 server ready（获得 http://localhost:22224）
    │
    ├─ 2. 显示 MainScreen（WebView）
    │     ├── WebView 加载 http://localhost:22224/index.html#/
    │     ├── injectedJavaScriptBeforeContentLoaded 注入桥接代码
    │     ├── onLoad 后注入初始数据：
    │     │   window.__EXPO_INIT_DATA__ = { version, theme, pageInfo, ... }
    │     └── Vue SPA 启动
    │         ├── 读取 localForage 中的 cacheServerUrl → 设置 window.systemInfo.apiUrl
    │         ├── 如果未登录 → 显示登录页（含服务器地址输入）
    │         └── 如果已登录 → 进入主界面
    │
    └─ 3. 推送注册（登录成功后，由 WebView 通过桥接通知 RN）
          └── iOS + Android: UMeng SDK → setAlias(userId)（通过 sendMessage 的 setUmengAlias 触发）
```

### 17.2 Vue SPA 本地资源如何打包进 App

**关键问题**：Expo/React Native 不会自动把 `assets/web/` 目录打包进最终的 App。需要明确配置。

#### 方案 A：metro.config.js 配置 extra assets（推荐）

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 将 assets/web 目录作为额外资源打包
config.resolver.assetExts.push('html', 'css', 'js', 'json', 'map', 'png', 'jpg', 'gif', 'svg', 'woff', 'woff2', 'ttf', 'eot');

module.exports = config;
```

**配合 Expo Config Plugin 将 `assets/web/` 复制到原生项目**：

```typescript
// plugins/withWebAssets.ts
import { ConfigPlugin, withDangerousMod } from '@expo/config-plugins';
import * as fs from 'fs';
import * as path from 'path';

const withWebAssets: ConfigPlugin = (config) => {
  // Android: 复制到 android/app/src/main/assets/web/
  config = withDangerousMod(config, ['android', (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const src = path.join(projectRoot, 'assets', 'web');
    const dest = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'web');

    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
    return config;
  }]);

  // iOS: 复制到 ios bundle（通过 Xcode Build Phase 或直接复制）
  config = withDangerousMod(config, ['ios', (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const src = path.join(projectRoot, 'assets', 'web');
    // iOS assets 通过 Xcode 的 "Copy Bundle Resources" 自动包含
    // 需要在 Xcode 项目中添加 assets/web 文件夹引用
    // 或者复制到 ios/<projectName>/assets/web/
    const appName = config.modRequest.platformProjectRoot.split('/').pop();
    const dest = path.join(config.modRequest.platformProjectRoot, 'assets', 'web');

    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
    return config;
  }]);

  return config;
};

export default withWebAssets;
```

在 `app.json` 的 plugins 中注册：
```json
"plugins": [
  "./plugins/withWebAssets",
  // ... 其他 plugins
]
```

#### 方案 B：使用 expo-updates 的 assets 目录（备选）

如果方案 A 有问题，可以把 Web 资源放在 `expo-updates` 管理的目录中，通过 OTA 更新 Web 资源。

### 17.3 本地 HTTP Server 的 Android 资源加载

Android 的 assets 目录不能直接通过文件路径访问（它被打包在 APK 中），需要先复制到可读写的目录：

```typescript
// src/services/localServer.ts 中的 copyAssetsToDocuments 实现
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';

async function copyAssetsToDocuments(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const destDir = `${RNFS.DocumentDirectoryPath}/web`;

  // 检查是否已复制（通过版本标记）
  const versionFile = `${destDir}/.version`;
  const appVersion = require('../../app.json').expo.version;

  try {
    const savedVersion = await RNFS.readFile(versionFile, 'utf8');
    if (savedVersion === appVersion) {
      return; // 已经是最新版，不需要重新复制
    }
  } catch (e) {
    // 文件不存在，需要复制
  }

  // 清除旧文件
  if (await RNFS.exists(destDir)) {
    await RNFS.unlink(destDir);
  }
  await RNFS.mkdir(destDir);

  // 从 Android assets 递归复制
  await copyAssetDir('web', destDir);

  // 写入版本标记
  await RNFS.writeFile(versionFile, appVersion, 'utf8');
}

async function copyAssetDir(assetPath: string, destPath: string): Promise<void> {
  const items = await RNFS.readDirAssets(assetPath);
  for (const item of items) {
    const srcPath = `${assetPath}/${item.name}`;
    const dstPath = `${destPath}/${item.name}`;

    if (item.isDirectory()) {
      await RNFS.mkdir(dstPath);
      await copyAssetDir(srcPath, dstPath);
    } else {
      await RNFS.copyFileAssets(srcPath, dstPath);
    }
  }
}
```

> **注意**：`react-native-static-server` 包可能不够稳定，如果遇到问题可换用 `@dr.pogodin/react-native-static-server`（更活跃维护）。两者 API 基本兼容。

### 17.4 createBridgeHandler 完整实现

这是连接所有桥接处理器的核心路由函数。所有 Screen（MainScreen、ChildWebViewScreen）都使用它：

```typescript
// src/bridge/index.ts
import { RefObject } from 'react';
import { Keyboard, Alert, BackHandler, Linking, Appearance, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { EdgeInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { handleOpenPage } from './handlers/navigation';
import { handleSendMessage } from './handlers/nativeCommands';
import { getLatestPhoto, uploadPhoto } from './handlers/media';
import { setVariate, getVariate, setCachesString, getCachesString, syncVariateToWebView } from './handlers/storage';
// 全局状态
const activeWebViews = new Map<string, RefObject<WebView>>();

interface AppState {
  apiUrl: string;
  userId: string;
  userToken: string;
}

interface BridgeContext {
  webViewRef: RefObject<WebView>;
  navigation: any;
  insets: EdgeInsets;
  isFirstPage: boolean;
  pageId: string;
  appState: AppState;  // sendMessage 的 initApp 命令会填充此字段
  // 回调：触发扫码页面（由 Screen 组件提供）
  onRequestScan?: (callback: (result: string) => void) => void;
  // 回调：控制 WebView scrollEnabled（由 Screen 组件提供）
  onSetScrollEnabled?: (enabled: boolean) => void;
}

interface BridgeRequest {
  type: 'bridge_request';
  id: string;
  module: string;
  method: string;
  args: any[];
}

interface BridgeResponse {
  type: 'bridge_response';
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

export function createBridgeHandler(ctx: BridgeContext) {
  // 注册到活跃 WebView 列表（用于 setVariate 同步）
  activeWebViews.set(ctx.pageId, ctx.webViewRef);

  return async function handleMessage(msg: BridgeRequest): Promise<BridgeResponse> {
    try {
      const result = await routeRequest(msg, ctx);
      return { type: 'bridge_response', id: msg.id, success: true, data: result };
    } catch (error: any) {
      return { type: 'bridge_response', id: msg.id, success: false, error: error.message };
    }
  };
}

async function routeRequest(msg: BridgeRequest, ctx: BridgeContext): Promise<any> {
  const { module, method, args } = msg;

  if (module === 'eeui') {
    switch (method) {
      // ---- 基础信息 ----
      case 'getVersion':
      case 'getLocalVersion':
        return Constants.expoConfig?.version || '0.0.0';

      case 'getThemeName':
        return Appearance.getColorScheme() || 'light';

      case 'getPageInfo':
        return { pageName: ctx.isFirstPage ? 'firstPage' : ctx.pageId };

      case 'isFullscreen':
        return true; // 移动端始终全屏

      case 'getSafeAreaInsets':
        return {
          status: 'success',
          top: ctx.insets.top,
          bottom: ctx.insets.bottom,
          height: Dimensions.get('window').height,
        };

      case 'getDeviceInfo':
        return {
          status: 'success',
          brand: Device.brand || 'Unknown',
          model: Device.modelId || Device.modelName || 'Unknown',
          modelName: Device.modelName || 'Unknown',
          deviceName: Device.deviceName || 'Unknown',
          systemName: Platform.OS === 'ios' ? 'iOS' : 'Android',
          systemVersion: Device.osVersion || '',
        };

      // ---- 键盘 ----
      case 'keyboardHide':
        Keyboard.dismiss();
        return null;

      case 'keyboardStatus':
        // 需要通过 Keyboard 事件监听维护状态
        return keyboardVisible; // 全局变量，由 Keyboard 事件更新

      // ---- 屏幕 ----
      case 'keepScreenOn':
        await activateKeepAwakeAsync();
        return null;

      case 'keepScreenOff':
        deactivateKeepAwake();
        return null;

      // ---- 导航 ----
      case 'openPage':
        return handleOpenPage(args, ctx.navigation, ctx.pageId);

      case 'openWeb':
        await Linking.openURL(args[0]);
        return null;

      case 'goDesktop':
        BackHandler.exitApp();
        return null;

      case 'setPageBackPressed':
        // Android 返回键拦截 — MainScreen 已通过 BackHandler 处理
        // 这里记录 WebView 是否想要拦截
        return null;

      // ---- UI ----
      case 'alert':
        return new Promise(resolve => {
          const obj = args[0] || {};
          Alert.alert(obj.title || '', obj.message || '', [
            { text: obj.buttons?.[0] || '确定', onPress: () => resolve(0) },
          ]);
        });

      case 'toast':
        // Android 用 ToastAndroid，iOS 无原生 Toast
        if (Platform.OS === 'android') {
          const { ToastAndroid } = require('react-native');
          ToastAndroid.show(args[0]?.message || '', ToastAndroid.SHORT);
        }
        return null;

      case 'copyText':
        await Clipboard.setStringAsync(String(args[0] || ''));
        return null;

      // ---- 扫码 ----
      case 'openScaner':
        // 通过回调触发 Screen 组件显示扫码页面
        // 扫码结果通过 multiCallback 机制返回
        return new Promise(resolve => {
          ctx.onRequestScan?.((result) => {
            resolve({ status: 'success', text: result });
          });
        });

      // ---- 相册 ----
      case 'getLatestPhoto':
        return getLatestPhoto();

      case 'uploadPhoto':
        // 多次回调方法 — 通过 injectJavaScript 直接推送
        return uploadPhoto(args[0], msg.id, ctx.webViewRef);

      case 'cancelUploadPhoto':
        // 取消上传 — 通过 AbortController
        return null;

      // ---- 存储 ----
      case 'setVariate':
        setVariate(args[0], args[1]);
        // 同步到所有活跃 WebView
        activeWebViews.forEach((ref, pageId) => {
          syncVariateToWebView(ref, args[0], args[1]);
        });
        return null;

      case 'getVariate':
        return getVariate(args[0], args[1] || '');

      case 'setCachesString':
        await setCachesString(args[0], args[1], args[2] || 0);
        return null;

      case 'getCachesString':
        return getCachesString(args[0], args[1] || '');

      // ---- 震动 & 显示 ----
      case 'setHapticBackEnabled':
        if (args[0]) {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        return null;

      // ---- 更新 ----
      case 'checkUpdate':
        // Phase 7 实现：expo-updates
        return null;

      case 'rewriteUrl':
        // 前端自行处理，RN 侧不需要做什么
        return args[0];

      case 'shakeToEditOn':
      case 'shakeToEditOff':
        // iOS shake-to-undo，低优先级，可忽略
        return null;

      default:
        console.warn(`[Bridge] Unknown eeui method: ${method}`);
        return null;
    }
  }

  if (module === 'webview') {
    switch (method) {
      case 'sendMessage':
        // WebView 向原生层发送命令（不是给 WebView 发消息！）
        // 详见 17.7 节 sendMessage 命令总线协议
        return handleSendMessage(args[0], ctx);

      case 'setUrl':
        // 改变 WebView URL — 通过 state 更新 source prop
        // 需要 Screen 组件提供 onSetUrl 回调
        return null;

      case 'setScrollEnabled':
        ctx.onSetScrollEnabled?.(args[0] !== false);
        return null;

      case 'createSnapshot':
        // WebView 截图 — 使用 react-native-view-shot
        return null; // Phase 3 实现

      case 'showSnapshot':
      case 'hideSnapshot':
        return null; // Phase 3 实现

      case 'setDisabledUserLongClickSelect':
        const disabled = args[0];
        ctx.webViewRef.current?.injectJavaScript(`
          document.body.style.webkitUserSelect = ${disabled ? "'none'" : "'auto'"};
          document.body.style.userSelect = ${disabled ? "'none'" : "'auto'"};
          true;
        `);
        return null;

      default:
        console.warn(`[Bridge] Unknown webview method: ${method}`);
        return null;
    }
  }

  console.warn(`[Bridge] Unknown module: ${module}`);
  return null;
}

// ---- 键盘状态全局监听 ----
import { Dimensions } from 'react-native';

let keyboardVisible = false;
Keyboard.addListener('keyboardDidShow', () => { keyboardVisible = true; });
Keyboard.addListener('keyboardDidHide', () => { keyboardVisible = false; });

// ---- 清理 ----
export function unregisterWebView(pageId: string) {
  activeWebViews.delete(pageId);
}
```

### 17.5 扫码 ↔ 桥接完整流转

```
WebView                    MainScreen                  ScannerScreen
  │                            │                            │
  │─ openScaner(callback) ────>│                            │
  │                            │─ onRequestScan ───────────>│
  │                            │                            │
  │                            │    （用户扫码）               │
  │                            │                            │
  │                            │<── result (string) ────────│
  │                            │                            │
  │<── bridge_response ────────│    （ScannerScreen 关闭）    │
  │    { status:'success',     │
  │      text: '扫码结果' }     │
```

**MainScreen 中的扫码触发实现**：

```typescript
// MainScreen.tsx 中
const [scanCallback, setScanCallback] = useState<((result: string) => void) | null>(null);

const bridgeHandler = createBridgeHandler({
  // ...
  onRequestScan: (callback) => {
    // 保存回调，导航到扫码页面
    setScanCallback(() => callback);
    const scanId = `scan_${Date.now()}`;
    navigation.navigate('Scanner', { scanId });
  },
});

// 监听扫码结果（从 ScannerScreen 返回）
useScannerEvents((state) => {
  if (state.lastScannedCode && scanCallback) {
    scanCallback(state.lastScannedCode);
    setScanCallback(null);
    state.clearScan();
  }
});
```

> `useScannerEvents` 是一个 Zustand store，与 happy-next 的实现一致（详见第 5.2 节的 ScannerScreen 代码）。

### 17.6 injectedJS 完整版（含多次回调支持）

第 4.3 节的 injectedJS 需要增加多次回调支持。以下是**完整版**：

```javascript
const injectedJS = `
(function() {
  let _reqId = 0;
  const _pending = new Map();

  // 多次回调注册表（uploadPhoto、openScaner 等）
  window.__bridgeCallbacks__ = {};

  // 需要多次回调的方法列表
  const MULTI_CALLBACK_METHODS = ['uploadPhoto'];

  window.addEventListener('message', function(event) {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'bridge_response' && _pending.has(msg.id)) {
        const { resolve, reject } = _pending.get(msg.id);
        _pending.delete(msg.id);
        if (msg.success) {
          resolve(msg.data);
        } else {
          reject(new Error(msg.error || 'bridge error'));
        }
      } else if (msg.type === 'bridge_event') {
        window.dispatchEvent(new CustomEvent('bridge_event', { detail: msg }));
      }
    } catch (e) {}
  });

  function bridgeCall(module, method, args) {
    return new Promise(function(resolve, reject) {
      const id = 'req_' + (++_reqId);
      _pending.set(id, { resolve, reject });
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'bridge_request',
        id: id,
        module: module,
        method: method,
        args: args || []
      }));
      setTimeout(function() {
        if (_pending.has(id)) {
          _pending.delete(id);
          reject(new Error('bridge timeout'));
        }
      }, 30000);
    });
  }

  function createModuleProxy(moduleName) {
    return new Proxy({}, {
      get: function(target, prop) {
        if (prop === 'then' || prop === 'catch') return undefined;
        return function() {
          var args = Array.from(arguments);
          var callback = null;
          if (args.length > 0 && typeof args[args.length - 1] === 'function') {
            callback = args.pop();
          }

          // 多次回调方法：注册持久回调
          if (callback && MULTI_CALLBACK_METHODS.indexOf(prop) !== -1) {
            var id = 'req_' + (++_reqId);
            window.__bridgeCallbacks__[id] = callback;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'bridge_request',
              id: id,
              module: moduleName,
              method: prop,
              args: args
            }));
            return;
          }

          var promise = bridgeCall(moduleName, prop, args);
          if (callback) {
            promise.then(function(data) { callback(data); })
                   .catch(function(e) { callback({ status: 'error', error: e.message }); });
            return;
          }
          return promise;
        };
      }
    });
  }

  window.requireModuleJs = function(name) {
    return createModuleProxy(name || 'eeui');
  };

  // 全局变量缓存（由 RN 端 setVariate 时同步注入）
  window.__EXPO_VARIATES__ = {};

  window.__EXPO_BRIDGE_READY__ = true;
})();
true;
`;
```

### 17.7 sendMessage 命令总线协议（关键遗漏项）

**重要纠正**：文档之前把 `eeuiAppSendMessage` 描述成"发消息给 WebView"，这是**完全错误的**。

`eeuiAppSendMessage` 实际上是 **WebView 向原生壳发送命令的总线**。它通过 `$A.eeuiModule("webview")?.sendMessage(object)` 调用，发送一个 `{ action: 'xxx', ...params }` 对象给原生层执行。

**来源**：`~/workspaces/dootask/resources/assets/js/App.vue:224-809`

#### 所有 action 命令清单

| action | 用途 | 调用位置 | Expo 实现 |
|--------|------|----------|-----------|
| `initApp` | 登录后初始化原生层（传 apiUrl/userid/token/language/userAgent） | App.vue:224 | Bridge handler：保存用户信息，初始化推送 |
| `setUmengAlias` | 设置 UMeng 推送别名 | store/actions.js | UmengPush.setAlias()（iOS + Android 共用） |
| `delUmengAlias` | 删除 UMeng 推送别名（退出登录时） | store/actions.js | Android: UmengPush.removeAlias() |
| `windowSize` | 通知原生层当前 WebView 尺寸 | App.vue:805 | 可忽略（Expo 自动管理） |
| `setVibrate` | 触发震动 | Notification.vue:72 | `Haptics.notificationAsync()` |
| `setBdageNotify` | 设置 App 角标数字 | Tabbar.vue:201 | `Notifications.setBadgeCountAsync()` |
| `videoPreview` | 原生视频预览 | PreviewImage/state.vue | 在 WebView 内播放或 `Linking.openURL()` |
| `picturePreview` | 原生图片预览 | PreviewImage/state.vue | 在 WebView 内预览或原生图片查看器 |
| `callTel` | 拨打电话 | 多处 | `Linking.openURL('tel:xxx')` |
| `startMeeting` | 启动原生会议（Agora） | MeetingManager/index.vue:352 | **重要**：见 17.12 节 |
| `updateMeetingInfo` | 更新会议参与者信息 | App.vue:745 | 会议相关，见 17.12 节 |
| `openUrl` | 原生层打开 URL | 多处 | `Linking.openURL()` |
| `setPageData` | 设置页面数据 | 多处 | 通过 navigation params 传递 |
| `createTarget` | 创建新窗口 | App.vue | 走 `openAppChildPage` 逻辑 |
| `updateTheme` | 通知原生层主题变化 | store/actions.js | 更新 StatusBar 样式 + 通知其他 WebView |
| `getNotificationPermission` | 查询通知权限状态 | App.vue | `Notifications.getPermissionsAsync()` |
| `gotoSetting` | 打开系统设置 | 多处 | `Linking.openSettings()` |
| `userChatList` | 用户聊天列表通知 | store/actions.js | 保存聊天数据到内存供原生层使用 |
| `userUploadUrl` | 通知原生上传地址 | store/actions.js | 保存 URL 供 uploadPhoto 使用 |

#### Bridge 处理 sendMessage

```typescript
// src/bridge/handlers/nativeCommands.ts
// sendMessage 不再是"给 WebView 发消息"，而是"WebView 给原生发命令"

import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';

export async function handleSendMessage(data: any, ctx: BridgeContext): Promise<any> {
  const { action, ...params } = data;

  switch (action) {
    case 'initApp':
      // 保存用户信息，用于推送注册等
      ctx.appState.apiUrl = params.apiUrl;
      ctx.appState.userId = params.userid;
      ctx.appState.userToken = params.token;
      // 注册推送
      await registerPush(params.userid);
      return null;

    case 'setUmengAlias':
      // iOS + Android 都用 UMeng
      await registerPush(params.alias || params.userid);
      return null;

    case 'delUmengAlias':
      // 退出登录时取消推送注册
      await unregisterPush();
      return null;

    case 'setVibrate':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return null;

    case 'setBdageNotify':
      await Notifications.setBadgeCountAsync(params.bdage || 0);
      return null;

    case 'callTel':
      await Linking.openURL(`tel:${params.tel || params.phone}`);
      return null;

    case 'openUrl':
      await Linking.openURL(params.url);
      return null;

    case 'gotoSetting':
      await Linking.openSettings();
      return null;

    case 'getNotificationPermission':
      const { status } = await Notifications.getPermissionsAsync();
      // 通过 __onNotificationPermissionStatus 回调通知 WebView
      ctx.webViewRef.current?.injectJavaScript(`
        typeof window.__onNotificationPermissionStatus === 'function'
          && window.__onNotificationPermissionStatus(${status === 'granted' ? 1 : 0});
        true;
      `);
      return null;

    case 'startMeeting':
      // 见 17.12 节
      return handleStartMeeting(params, ctx);

    case 'updateMeetingInfo':
      // 见 17.12 节
      return handleUpdateMeetingInfo(params, ctx);

    case 'windowSize':
    case 'userChatList':
    case 'userUploadUrl':
    case 'setPageData':
    case 'createTarget':
      // 信息保存到 ctx.appState，供其他功能使用
      return null;

    case 'videoPreview':
    case 'picturePreview':
      // WebView 内已有预览逻辑，原生预览作为增强（可后续实现）
      return null;

    default:
      console.warn(`[Bridge] Unknown sendMessage action: ${action}`);
      return null;
  }
}
```

**重要**：在 17.4 节的 `createBridgeHandler` 中，`webview` 模块的 `sendMessage` case 需要改为调用 `handleSendMessage`：

```typescript
// 修正前（错误）：
case 'sendMessage':
  // 直接注入事件 ← 这是错的！
  ctx.webViewRef.current?.injectJavaScript(`...`);

// 修正后（正确）：
case 'sendMessage':
  return handleSendMessage(args[0], ctx);
```

### 17.8 原生→Web 全局回调函数完整清单

EEUI 原生层在特定时机调用 WebView 中的全局函数。Expo 需要在对应时机通过 `injectJavaScript` 触发这些回调。

**来源**：`~/workspaces/dootask/resources/assets/js/App.vue:652-803`（`eeuiEvents()` 方法）

| 回调函数 | 触发时机 | EEUI 行为 | Expo 实现 |
|----------|----------|-----------|-----------|
| `__onAppActive` | App 从后台回到前台 | 隐藏快照、更新主题、检查更新 | `AppState` change → 'active' |
| `__onAppDeactive` | App 进入后台 | 延迟 500ms 后截图并显示快照（防止任务切换器泄露内容） | `AppState` change → 'background' |
| `__onPagePause` | 页面失活 | `windowActive = false`，停止数据刷新 | 同 `__onAppDeactive` 一起触发 |
| `__onPageResume(num)` | 页面激活 | `windowActive = true`，刷新数据 | 同 `__onAppActive` 一起触发 |
| `__onCreateTarget(url)` | WebView 中 `window.open()` | 拦截并在 App 内打开子页面 | WebView `onOpenWindow` prop |
| `__onMeetingEvent(event)` | 会议状态变化 | 处理会议加入/退出/邀请等事件 | 见 17.12 节 |
| `__onKeyboardStatus(event)` | 键盘显隐 | 更新 `keyboardShow`/`keyboardHeight` 状态 + 切换 shakeToEdit | RN `Keyboard` 事件监听后注入 |
| `__onNotificationPermissionStatus(ret)` | 通知权限查询结果 | 更新 `appNotificationPermission` | sendMessage 的 `getNotificationPermission` 响应时注入 |
| `__handleLink(path)` | 推送通知点击/Deep Link | 路由到指定页面 | 推送 onNotificationResponse 时注入 |

**MainScreen 完整的回调注入实现**：

```typescript
// MainScreen.tsx — AppState + Keyboard 监听
React.useEffect(() => {
  let lastState = AppState.currentState;

  // App 前后台
  const appSub = AppState.addEventListener('change', (next) => {
    if (next === 'active' && lastState !== 'active') {
      webViewRef.current?.injectJavaScript(`
        typeof window.__onAppActive === 'function' && window.__onAppActive();
        typeof window.__onPageResume === 'function' && window.__onPageResume(1);
        true;
      `);
    } else if (next.match(/inactive|background/) && lastState === 'active') {
      webViewRef.current?.injectJavaScript(`
        typeof window.__onAppDeactive === 'function' && window.__onAppDeactive();
        typeof window.__onPagePause === 'function' && window.__onPagePause();
        true;
      `);
    }
    lastState = next;
  });

  // 键盘状态
  const kbShow = Keyboard.addListener('keyboardDidShow', (e) => {
    webViewRef.current?.injectJavaScript(`
      typeof window.__onKeyboardStatus === 'function'
        && window.__onKeyboardStatus({ keyboardType: 'show', keyboardHeight: ${e.endCoordinates.height} });
      true;
    `);
  });
  const kbHide = Keyboard.addListener('keyboardDidHide', () => {
    webViewRef.current?.injectJavaScript(`
      typeof window.__onKeyboardStatus === 'function'
        && window.__onKeyboardStatus({ keyboardType: 'hide', keyboardHeight: 0 });
      true;
    `);
  });

  return () => {
    appSub.remove();
    kbShow.remove();
    kbHide.remove();
  };
}, []);
```

### 17.9 WebView 媒体权限（会议 / Agora WebRTC）

> 注意：根据 Codex 审查，DooTask 的会议实际是**原生层实现**（通过 `startMeeting` 命令），而非 WebView 中运行 Agora JS SDK。但 WebView 仍可能播放音视频内容（语音消息等），因此媒体权限配置仍然需要：

```tsx
<WebView
  allowsInlineMediaPlayback={true}
  mediaPlaybackRequiresUserAction={false}
  mediaCapturePermissionGrantType="grant"
  onPermissionRequest={(request) => {
    request.grant(request.resources);
  }}
/>
```

### 17.10 getDeviceInfo 返回结构修正

文档之前写的 `brand`/`model`/`system` 与实际消费方不匹配。

**实际需要的字段**（来自 `App.vue:234-249`）：

```typescript
// 正确的返回格式
{
  status: 'success',
  brand: 'Apple',              // 品牌
  model: 'iPhone16,1',         // 型号标识
  modelName: 'iPhone 15 Pro',  // 型号名称
  deviceName: 'My iPhone',     // 设备名称
  systemName: 'iOS',           // 系统名称
  systemVersion: '17.0',       // 系统版本
}
```

Expo 实现：
```typescript
import * as Device from 'expo-device';
import { Platform } from 'react-native';

case 'getDeviceInfo':
  return {
    status: 'success',
    brand: Device.brand || 'Unknown',
    model: Device.modelId || Device.modelName || 'Unknown',
    modelName: Device.modelName || 'Unknown',
    deviceName: Device.deviceName || 'Unknown',
    systemName: Platform.OS === 'ios' ? 'iOS' : 'Android',
    systemVersion: Device.osVersion || '',
  };
```

### 17.11 额外的 UA 检测文件（后端补充）

Codex 发现还有 2 个后端文件需要兼容新 UA：

1. **`app/Http/Controllers/Api/SystemController.php`**（约 1556 行）— `prefetch` 方法根据 UA 判断是否为 App 并返回资源预加载列表
2. **`resources/views/download.blade.php`**（约 81 行）— 下载页检测 `/eeui/i` 决定显示方式

这两个文件需要增加 `dootask_expo` 的识别，与 7.1 节的改法一致。

### 17.12 会议功能架构说明

**重要纠正**：DooTask 的会议功能不是在 WebView 中运行 Agora JS SDK，而是通过 `sendMessage({ action: 'startMeeting' })` 交给**原生层**处理会议，原生层与 WebView 通过 `__onMeetingEvent` 双向交互。

**当前流程**：
```
WebView                        EEUI 原生层
  │                                │
  │── sendMessage({               │
  │     action: 'startMeeting',   │
  │     meetingid, channel, ...   │
  │   }) ─────────────────────────>│── 启动原生 Agora 会议页面
  │                                │
  │<── __onMeetingEvent({         │
  │     act: 'success'            │
  │   }) ─────────────────────────│── 加入成功
  │                                │
  │<── __onMeetingEvent({         │
  │     act: 'getInfo',           │
  │     uuid: '...'               │
  │   }) ─────────────────────────│── 请求参与者信息
  │                                │
  │── sendMessage({               │
  │     action: 'updateMeetingInfo',
  │     infos: { avatar, ... }    │
  │   }) ─────────────────────────>│── 更新参与者头像/昵称
```

**Expo 迁移选项**：

1. **方案 A（推荐）**：使用 `react-native-agora` SDK，在 RN 原生层实现会议功能
   - 收到 `startMeeting` 命令后，导航到一个 RN 原生会议页面
   - 通过 `__onMeetingEvent` 回调与 WebView 双向通信
   - 需要 Agora App ID（从 DooTask 后台配置获取）

2. **方案 B（简化）**：WebView 内实现会议（如果 Agora Web SDK 在 WebView 中可用）
   - 改造前端代码，不走 `startMeeting` 命令，直接在 WebView 中调用 Agora Web SDK
   - 需要改主仓库的 `MeetingManager` 组件
   - 属于"主仓库可改"范围

建议先确认 Agora 在 Expo WebView 中的兼容性，再决定方案。

### 17.13 推送方案修正

Codex 指出推送方案存在自相矛盾。修正如下：

**现有 API 接口**（不变）：
- `api/users/umeng/alias` — 注册/删除推送别名
- `api/users/device/edit` — 更新设备信息

**不再新增** `POST /api/users/device/register` 和 `push_type` 字段。

**iOS 推送方案简化**：初期阶段保持 iOS 也用 UMeng（通过 Config Plugin 集成），与 Android 一致。等稳定后再考虑是否切换到 APNs 直推。这样后端完全不需要改动。

### 17.14 本地 HTTP Server 库选型说明

`react-native-static-server` 有多个 fork，维护状态不一。**实施时应按以下优先级尝试**：

1. **`@dr.pogodin/react-native-static-server`** — 最活跃的 fork，支持最新 RN 版本
2. **`react-native-static-server`** — 原版，可能版本较旧
3. **备选方案：不用 HTTP server**，改为：
   - 使用 `WebView` 的 `source={{ uri: 'file:///...' }}` + `originWhitelist={['*']}` + `allowFileAccess`
   - 在 `config.js` 中将 API 地址设为绝对 URL（已经是）
   - 前端代码中的相对路径请求改为绝对路径
   - 此方案的风险是 CORS 和 cookie 限制，但对于纯 SPA + API 调用模式可能够用

**AI 在实施时**：先尝试方案 1，如果安装/编译有问题再尝试备选方案。不要在一个方案上卡太久。

### 17.15 相册权限补充

`getLatestPhoto` 使用 `expo-media-library` 访问相册。权限已在 app.json 3.2 节配置（`NSPhotoLibraryUsageDescription` + `READ_MEDIA_IMAGES` + `expo-media-library` plugin）。

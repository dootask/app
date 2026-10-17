# DooTask App（Expo 壳）— AGENTS 指南

这是 DooTask 的移动端 App，用于替换旧的 eeui（Weex）壳。整个 App 是一个全屏 WebView，加载 DooTask 的 Vue 2 前端；前端通过 eeui 兼容桥（`requireModuleJs`）调用原生能力。以后会逐步把部分页面迁移为 RN 原生页。

- 技术栈：Expo SDK 58（React Native 0.88、React 19.3、新架构）、expo-router、react-native-webview，以及 CNG 和 config plugin。
- 本仓库以 git 子模块形式挂载在 DooTask 主仓库的 `resources/app` 下。前端源码在主仓库的 `resources/assets/js`，旧 eeui 壳在 `resources/mobile`，两者都只作参考，**本仓库任务不要修改它们**。
- 回复和代码注释使用简体中文。

## 必读文档

- `docs/bridge-inventory.md`：桥接口清单，即前端与壳之间的全部契约和验收项。实现任何方法都以它为准，完成后把对应行的状态改为 ✅。
- `docs/progress.md`：里程碑进度，以及已验证和未验证的项目。
- `docs/dev.md`：开发、同步和构建流程。

## 目录与归属

```
src/app/                 路由（expo-router），每个文件就是一个页面
  _layout.tsx            根布局（C）
  index.tsx              主页面 firstPage（C）
  web.tsx                二级页面，对应 eeui 的 web.js（核心部分 C，导航栏和参数 X）
  bridge-test.tsx        桥接自测页（C）
src/bridge/              兼容桥
  protocol.ts injected.ts store.ts pages.ts dispatcher.ts navigation.ts hooks.ts BridgeWebView.tsx   核心（C）
  modules/core.ts        核心方法（C）
  modules/eeui/          eeui 模块其余方法（X）
  modules/webview/       webview 模块其余方法（X）
  messages/              sendMessage 各 action（X）
src/native/              原生能力的 TS 封装（X）
modules/                 本地 Expo 模块（Expo Modules API，Swift/Kotlin），例如 modules/web-server（X）
plugins/                 自定义 config plugin（X）
src/devtools/            开发工具（C）
docs/                    文档
scripts/                 同步与构建脚本
```

C 代表 Claude（集成方）负责，X 代表实现任务负责。**核心文件（C）不要改**；如果确实需要改动核心，在任务结果中写明原因和建议的 diff，由集成方处理。

## 硬性规则

1. **不要提交 git**：不执行 commit、push、建分支，也不修改暂存区。提交由集成方统一完成。
2. **兼容契约不能改**：
   - `requireModuleJs` 的方法名、参数和回调数据结构必须与 eeui 保持一致（见清单和旧实现 `resources/mobile`）。
   - UA 后缀格式 `*_kuaifan_eeui/{版本}` 不变。
   - 本地服务地址 `http://localhost:22223` 不变。
   - 包名 / Bundle ID `com.dootask.task` 不变。
3. **原生代码只能通过 Expo 方式添加**：
   - 本地 Expo 模块放在 `modules/<name>`（使用 `npx create-expo-module@latest --local`）。
   - 修改原生工程配置要写 config plugin（放在 `plugins/`）。
   - **不要手动创建或编辑 `ios/`、`android/`**：这两个目录是生成产物，已加入 gitignore。
4. 依赖统一用 `npx expo install <pkg>` 安装；优先用 Expo 官方模块。新增依赖要在任务结果中说明理由。
5. 注册方式：
   - 模块方法：`registerModule('eeui' | 'webview', {...})`。
   - sendMessage 的 action：`registerMessage(action, handler)`。
   - 处理函数的第一个参数是 `PageHandle`，用于回调（`page.callback(ref, data, keep)`）、调用 window 函数和保存页面级状态。
   - 多次触发的回调必须传 `keep=true`，结束后调用 `page.release(ref)`。
6. 变量和缓存只能通过 `bridgeStore` 读写，不要自建存储，否则同步方法的快照会不一致。
7. 不要在模块级变量里保存与页面相关的状态，应放在 `page.state`。

## 完成标准（每个任务都要满足）

- `npx tsc --noEmit` 无错误。
- `npx expo lint` 无 error。
- 新增或修改 native 代码时，执行 `npx expo prebuild --clean --no-install` 能成功生成原生工程。Linux 上无法编译 iOS；如果有 Android SDK，再执行 `cd android && ./gradlew assembleDebug`；没有就在结果中注明。
- 更新 `docs/bridge-inventory.md` 中对应行的状态。
- 任务结果写清楚：改了哪些文件、怎么验证的、哪些没验证以及原因、有哪些需要集成方处理的事项。

## Expo 已变化，不要相信训练数据

每个 SDK 版本都可能有破坏性变更。写任何 Expo / RN API 之前，先查 `package.json` 中的 expo 主版本，再查对应文档：
`https://docs.expo.dev/versions/v58.0.0/`；索引见 https://docs.expo.dev/llms.txt 。也可以直接读 `node_modules/<pkg>` 里的类型定义确认 API。

```bash
npx expo install <package>  # 安装依赖（自动选择与 SDK 兼容的版本）
npx expo lint               # lint
npx tsc --noEmit            # 类型检查
npx expo-doctor             # 依赖诊断
```

导航使用 Expo Router，路由放在 `src/app/`；非路由代码放在 `src/app/` 之外。

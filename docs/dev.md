# 开发与构建

## 本机（Linux 开发机）

在主仓库根目录执行（首次会自动 `npm install`）：

```bash
./cmd expo dev               # 同时启动前端（同 ./cmd dev）与 Metro
npm run check                # 在本目录执行：tsc + lint
```

- 键盘输入交给 Metro（`r` 重载等）；Ctrl+C 或任一进程退出时一起结束。
- Metro 端口：未指定 `EXPO_PACKAGER_PROXY_URL` 时从 2220 起自动找空闲端口；指定了则固定为 `METRO_PORT`（默认 2220），被占用直接报错退出。
- 两个地址按以下顺序确定，启动时会打印出来：
  - `EXPO_PACKAGER_PROXY_URL`（Metro 对外地址）：命令行传入 → 按 `VSCODE_PROXY_URI` 的 `{{port}}` 模板与实际端口推导 → 留空由 Expo 自动取局域网地址。
  - `EXPO_PUBLIC_WEB_URL`（WebView 加载的前端地址）：命令行传入 → 按 `VSCODE_PROXY_URI` 模板推导 → `http://<本机局域网 IP>:<APP_PORT>`。由 Metro 内联到 JS，改后重启即可，不需要重新编译原生包。
  - 手动指定示例：`EXPO_PACKAGER_PROXY_URL=https://metro.example.com EXPO_PUBLIC_WEB_URL=https://web.example.com ./cmd expo dev`
- 单独在本目录 `npm start` 时不做推导，可按 `.env.example` 写 `.env.local`。
- 版本号取自主仓库 `package.json` 的 `version` / `codeVerson`；独立克隆时取本仓库的 `version.json`。

## Mac 构建机（只构建，不在上面改代码）

1. 本机打包：`scripts/pack.sh /tmp/dootask-app-src.tgz`（不包含 node_modules、ios、android）。
2. 把包传到 Mac（orchestrator_transfer 或 scp），放到 `/tmp/dootask-app-src.tgz`。
3. 在 Mac 上执行：

```bash
cd <dootask>/resources/app
IOS_DEVICE=<模拟器UDID> scripts/mac-build.sh ios /tmp/dootask-app-src.tgz
ANDROID_DEVICE=emulator-5554 scripts/mac-build.sh android /tmp/dootask-app-src.tgz
```

### 真机装 Dev 包

`DooTask (dev)`（包名 `com.dootask.task.dev`）可与正式版同时安装，用 Dev Client 连 Metro 实时开发；不接 Android 厂商推送：

```bash
DEV=1 IOS_DEVICE=<真机UDID> scripts/mac-build.sh ios /tmp/dootask-app-src.tgz
DEV=1 ANDROID_DEVICE=<设备序列号> scripts/mac-build.sh android /tmp/dootask-app-src.tgz
```

`mac-build.sh` 会解包（保留 node_modules、ios、android），然后依次执行 `npm install`、`expo prebuild --clean` 和 `expo run:<platform> --no-bundler`。

## 连接 Metro

Dev Client 启动后，选择或输入 Metro 地址（即 `EXPO_PACKAGER_PROXY_URL`）；也可以用命令直接打开（Dev 包的 scheme 为 `exp+dootask-dev`）：

```bash
# iOS 模拟器
xcrun simctl openurl booted "exp+dootask://expo-development-client/?url=<URL编码的Metro地址>"
# Android
adb shell am start -a android.intent.action.VIEW -d "exp+dootask://expo-development-client/?url=<URL编码的Metro地址>"
```

## 桥接自测页

```bash
xcrun simctl openurl booted dootask://bridge-test
adb shell am start -a android.intent.action.VIEW -d dootask://bridge-test
```

页面顶部会显示 `N / N passed`；控制台输出带 `[bridge-test]` 前缀，可以在 Metro 日志中查看。

## 调试 WebView

开发构建已开启 `webviewDebuggingEnabled`：iOS 用 Safari 的“开发”菜单，Android 用 `chrome://inspect`。

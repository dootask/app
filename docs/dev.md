# 开发与构建

## 本机（Linux 开发机）

```bash
npm install
cp .env.example .env.local   # 设置 EXPO_PUBLIC_WEB_URL=开发前端地址（不设则加载本地 Web 服务）
npm start                    # Metro 监听 2221 端口，外部地址 https://2221--main--apang--kuaifan.coder.dootask.com
npm run check                # tsc + lint
```

- `EXPO_PUBLIC_WEB_URL` 由 Metro 内联到 JS，修改后重启 Metro 即可，不需要重新编译原生包。
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

`mac-build.sh` 会解包（保留 node_modules、ios、android），然后依次执行 `npm install`、`expo prebuild --clean` 和 `expo run:<platform> --no-bundler`。

## 连接 Metro

Dev Client 启动后，选择或输入 Metro 地址 `https://2221--main--apang--kuaifan.coder.dootask.com`；也可以用命令直接打开：

```bash
# iOS 模拟器
xcrun simctl openurl booted "exp+dootask://expo-development-client/?url=https%3A%2F%2F2221--main--apang--kuaifan.coder.dootask.com"
# Android
adb shell am start -a android.intent.action.VIEW -d "exp+dootask://expo-development-client/?url=https%3A%2F%2F2221--main--apang--kuaifan.coder.dootask.com"
```

## 桥接自测页

```bash
xcrun simctl openurl booted dootask://bridge-test
adb shell am start -a android.intent.action.VIEW -d dootask://bridge-test
```

页面顶部会显示 `N / N passed`；控制台输出带 `[bridge-test]` 前缀，可以在 Metro 日志中查看。

## 调试 WebView

开发构建已开启 `webviewDebuggingEnabled`：iOS 用 Safari 的“开发”菜单，Android 用 `chrome://inspect`。

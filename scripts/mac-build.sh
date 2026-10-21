#!/usr/bin/env bash
# Mac 构建机上执行：解包 → 安装依赖 → prebuild → 编译安装到模拟器
# 用法：scripts/mac-build.sh <ios|android|all> [tgz路径]
# RELEASE=1 时编译包内 Release（需先 ./cmd expo build 且打包时排除 .env.local）
# Android Release 正式签名：读取 $DOOTASK_KEYS_DIR/android/（默认 iCloud 云盘 DooTaskKeys）下的
# dootask-release.jks 与 signing.env（ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD）；
# 已导出 ANDROID_KEYSTORE_PATH 时以环境变量为准
# DEV=1 时构建 DooTask (dev) 变体（APP_VARIANT=development，独立包名，可与正式版共存），固定 Debug，忽略 RELEASE
set -euo pipefail
platform="${1:-all}"
tgz="${2:-}"
case "${BASH_SOURCE[0]}" in /dev/*|-*|bash) echo "必须以文件路径执行本脚本" >&2; exit 1 ;; esac
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ -n "$tgz" ]]; then
  # 防误删：清理前确认当前目录是 App 根目录
  if [[ ! -f app.config.ts || ! -f package.json || "$(basename "$PWD")" != "app" ]]; then
    echo "拒绝清理：$PWD 不是 App 根目录" >&2; exit 1
  fi
  find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name ios ! -name android -exec rm -rf {} +
  tar -xzf "$tgz"
fi
npm install --no-audit --no-fund
if [[ -n "${DEV:-}" ]]; then
  export APP_VARIANT=development
  unset RELEASE
fi
ios_extra=()
if [[ -n "${RELEASE:-}" ]]; then ios_extra=(--configuration Release); fi
if [[ "$platform" == "ios" || "$platform" == "all" ]]; then
  npx expo prebuild --platform ios --clean --no-install
  (cd ios && pod install)
  if [[ -n "${DEV:-}" && -n "${IOS_DEVICE:-}" ]]; then
    # 工程已带 appleTeamId 时 expo run:ios 不传 -allowProvisioningUpdates，新包名/App Group 无法自动注册，故直接调 xcodebuild
    workspace=$(ls -d ios/*.xcworkspace | head -1)
    scheme=$(basename "$workspace" .xcworkspace)
    xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Debug -destination "id=$IOS_DEVICE" \
      -derivedDataPath ios/build/dd -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
      COCOAPODS_PARALLEL_CODE_SIGN=true COMPILER_INDEX_STORE_ENABLE=NO build
    xcrun devicectl device install app --device "$IOS_DEVICE" "ios/build/dd/Build/Products/Debug-iphoneos/$scheme.app"
  else
    npx expo run:ios --no-bundler ${ios_extra[@]+"${ios_extra[@]}"} ${IOS_DEVICE:+--device "$IOS_DEVICE"}
  fi
fi
if [[ "$platform" == "android" || "$platform" == "all" ]]; then
  npx expo prebuild --platform android --clean --no-install
  if [[ -n "${RELEASE:-}" ]]; then
    if [[ -z "${ANDROID_KEYSTORE_PATH:-}" ]]; then
      keys_dir="${DOOTASK_KEYS_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/DooTaskKeys}/android"
      # iCloud 可能只留占位文件：读不到时直接失败，避免静默退化为 debug 签名
      if [[ ! -s "$keys_dir/dootask-release.jks" || ! -s "$keys_dir/signing.env" ]]; then
        echo "缺少签名文件：$keys_dir（iCloud 文件需在本机已下载）" >&2; exit 1
      fi
      set -a; source "$keys_dir/signing.env"; set +a
      export ANDROID_KEYSTORE_PATH="$keys_dir/dootask-release.jks"
    fi
    # 签名经 init script 注入（ANDROID_KEYSTORE_PATH 等未设置时退化 debug 签名）；安装目标设备由 ANDROID_SERIAL 指定
    (cd android && ./gradlew :app:assembleRelease --init-script ../scripts/android-signing.gradle)
    if ! adb install -r android/app/build/outputs/apk/release/app-release.apk; then
      echo "安装失败：若为签名不一致（INSTALL_FAILED_UPDATE_INCOMPATIBLE），需先手动卸载设备上的旧包" >&2; exit 1
    fi
    adb shell am start -n com.dootask.task/.MainActivity
  else
    npx expo run:android --no-bundler ${ANDROID_DEVICE:+--device "$ANDROID_DEVICE"}
  fi
fi

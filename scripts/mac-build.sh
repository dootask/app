#!/usr/bin/env bash
# Mac 构建机上执行：解包 → 安装依赖 → prebuild → 编译安装到模拟器
# 用法：scripts/mac-build.sh <ios|android|all> [tgz路径]
set -euo pipefail
platform="${1:-all}"
tgz="${2:-}"
cd "$(dirname "$0")/.."
if [[ -n "$tgz" ]]; then
  find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name ios ! -name android -exec rm -rf {} +
  tar -xzf "$tgz"
fi
npm install --no-audit --no-fund
if [[ "$platform" == "ios" || "$platform" == "all" ]]; then
  npx expo prebuild --platform ios --clean --no-install
  (cd ios && pod install)
  npx expo run:ios --no-bundler ${IOS_DEVICE:+--device "$IOS_DEVICE"}
fi
if [[ "$platform" == "android" || "$platform" == "all" ]]; then
  npx expo prebuild --platform android --clean --no-install
  npx expo run:android --no-bundler ${ANDROID_DEVICE:+--device "$ANDROID_DEVICE"}
fi

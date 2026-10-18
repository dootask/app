#!/usr/bin/env bash
# Mac 构建机上执行：解包 → 安装依赖 → prebuild → 编译安装到模拟器
# 用法：scripts/mac-build.sh <ios|android|all> [tgz路径]
# RELEASE=1 时编译包内 Release（需先 ./cmd appexpo build 且打包时排除 .env.local）
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
ios_extra=(); android_extra=()
if [[ -n "${RELEASE:-}" ]]; then ios_extra=(--configuration Release); android_extra=(--variant release); fi
if [[ "$platform" == "ios" || "$platform" == "all" ]]; then
  npx expo prebuild --platform ios --clean --no-install
  (cd ios && pod install)
  npx expo run:ios --no-bundler ${ios_extra[@]+"${ios_extra[@]}"} ${IOS_DEVICE:+--device "$IOS_DEVICE"}
fi
if [[ "$platform" == "android" || "$platform" == "all" ]]; then
  npx expo prebuild --platform android --clean --no-install
  npx expo run:android --no-bundler ${android_extra[@]+"${android_extra[@]}"} ${ANDROID_DEVICE:+--device "$ANDROID_DEVICE"}
fi

#!/usr/bin/env bash
# 打包源码（不含 node_modules / 原生目录），用于同步到 Mac 构建机
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-/tmp/dootask-app-src.tgz}"
tar --exclude=./node_modules --exclude=./ios --exclude=./android --exclude=./.expo --exclude=./.git \
  -czf "$out" .
echo "$out"

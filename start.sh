#!/usr/bin/env sh
# macOS / Linux 启动脚本：本文件所在目录 = 工具目录
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] 没找到 Node.js，请先安装 Node.js 18+：https://nodejs.org/"
  exit 1
fi

exec node server.js --open "$@"

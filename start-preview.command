#!/bin/zsh
set -eu
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$PROJECT_DIR/server/data/preview.pid"
LOG_FILE="$PROJECT_DIR/server/data/preview.log"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -x "/Users/zhuyun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then NODE_BIN="/Users/zhuyun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; fi
if [ -z "$NODE_BIN" ]; then echo "未找到 Node.js，请先安装 Node.js 18 或更高版本。"; read -k 1; exit 1; fi
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then echo "预览已经启动。"; else cd "$PROJECT_DIR"; nohup "$NODE_BIN" server/src/server.js > "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE"; sleep 1; fi
if [ "${PREVIEW_NO_OPEN:-0}" != "1" ]; then
  open "http://localhost:3000/member/"
  open "http://localhost:3000/admin/"
fi
echo "会员预览：http://localhost:3000/member/"
echo "运营后台：http://localhost:3000/admin/"
echo "关闭预览请双击 stop-preview.command"

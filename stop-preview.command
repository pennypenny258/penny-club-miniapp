#!/bin/zsh
set -eu
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$PROJECT_DIR/server/data/preview.pid"
if [ ! -f "$PID_FILE" ]; then echo "预览当前未运行。"; exit 0; fi
PID_VALUE="$(cat "$PID_FILE")"
if [[ "$PID_VALUE" == <-> ]] && kill -0 "$PID_VALUE" 2>/dev/null; then kill "$PID_VALUE"; echo "预览已关闭。"; else echo "预览进程已经停止。"; fi
rm -f "$PID_FILE"

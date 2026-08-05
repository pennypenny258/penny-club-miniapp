#!/bin/zsh
set -eu
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_ENV_FILE="$PROJECT_DIR/.env.local"
EXAMPLE_FILE="$PROJECT_DIR/config/local.env.example"

if [ ! -f "$LOCAL_ENV_FILE" ]; then
  umask 077
  cp "$EXAMPLE_FILE" "$LOCAL_ENV_FILE"
fi
chmod 600 "$LOCAL_ENV_FILE"

open -e "$LOCAL_ENV_FILE"
echo "已用 TextEdit 打开本机私密配置。"
echo "只填写 FEISHU_APP_ID 和 FEISHU_APP_SECRET 的等号右侧，不要加到网页、聊天或截图中。"
echo "保存并关闭 TextEdit 后，请双击 restart-preview.command。"
read -k 1 "?按任意键关闭此窗口。"

#!/bin/zsh
set -eu
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$PROJECT_DIR/stop-preview.command"
"$PROJECT_DIR/start-preview.command"

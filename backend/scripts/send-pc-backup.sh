#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/dlckdgn/switchgear-estimate-app"
BACKEND_DIR="$ROOT_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env"
LOG_PREFIX="[send-pc-backup]"

export PATH="/home/dlckdgn/.nvm/versions/node/v22.21.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

TARGET="${PC_BAKC_UP:-${PC_BACK_UP:-}}"
if [ -z "$TARGET" ]; then
  echo "$LOG_PREFIX PC_BAKC_UP 또는 PC_BACK_UP 환경변수가 없습니다."
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "$LOG_PREFIX tailscale 명령을 찾을 수 없습니다."
  exit 1
fi

cd "$BACKEND_DIR"

echo "$LOG_PREFIX 백업 ZIP 생성 시작"
node send-db-email.js --no-email --no-dropbox --no-excel

LATEST_ZIP="$(ls -1t data-*.db.zip 2>/dev/null | head -n 1 || true)"
if [ -z "$LATEST_ZIP" ]; then
  echo "$LOG_PREFIX 전송할 data-*.db.zip 파일을 찾지 못했습니다."
  exit 1
fi

echo "$LOG_PREFIX Taildrop 전송 시작: $LATEST_ZIP -> $TARGET"
tailscale file cp "$LATEST_ZIP" "$TARGET:"
echo "$LOG_PREFIX Taildrop 전송 완료: $LATEST_ZIP"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm wurde nicht gefunden." >&2
  exit 1
fi

if ! command -v xdg-open >/dev/null 2>&1; then
  echo "xdg-open wurde nicht gefunden." >&2
  exit 1
fi

npx pm2 start ecosystem.config.cjs >/dev/null 2>&1 || npx pm2 restart ecosystem.config.cjs >/dev/null 2>&1
sleep 3
xdg-open http://localhost:23666 >/dev/null 2>&1 &

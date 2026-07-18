#!/usr/bin/env bash
# Install Paradox Health Monitor on a Debian/Ubuntu/Raspberry Pi OS host.
# Usage: sudo bash scripts/install.sh [--app-dir /opt/paradox/apps/PxH]

set -euo pipefail

APP_DIR="${1:-/opt/paradox/apps/PxH}"
CONFIG_DIR="/opt/paradox/config"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

echo "==> Installing Paradox Health Monitor (PxH) → $APP_DIR"
install -d -m 755 -o paradox -g paradox "$APP_DIR"
install -d -m 750 -o paradox -g paradox "$CONFIG_DIR"

rsync -a --delete --exclude node_modules --exclude .git "$REPO_ROOT/" "$APP_DIR/"
cd "$APP_DIR"
npm install --omit=dev
npm run build

if [[ ! -f "$CONFIG_DIR/pxh.ini" ]]; then
  cp "$APP_DIR/config/pxh.example.ini" "$CONFIG_DIR/pxh.ini"
  chown paradox:paradox "$CONFIG_DIR/pxh.ini"
  echo "    Wrote $CONFIG_DIR/pxh.ini — edit machine.id / mqtt as needed"
fi

install -m 644 "$APP_DIR/systemd/paradox-health.service" /etc/systemd/system/paradox-health.service
systemctl daemon-reload
systemctl enable --now paradox-health.service
echo "==> paradox-health.service active"
systemctl --no-pager --full status paradox-health.service || true
echo "Configure nginx: /health-api/ → 127.0.0.1:19090 and /health/ → $APP_DIR/public/"

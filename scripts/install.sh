#!/usr/bin/env bash
# Install Paradox Health Monitor on a Debian/Ubuntu/Raspberry Pi OS host.
# Usage: sudo bash scripts/install.sh

set -euo pipefail

APP_DIR="/opt/paradox/apps/PxH"
CONFIG_DIR="/opt/paradox/config"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
    echo "Run as root (sudo)." >&2
    exit 1
fi

if ! id paradox &>/dev/null; then
    echo "User 'paradox' does not exist. Create it before installing." >&2
    exit 1
fi

echo "==> Installing Paradox Health Monitor (PxH) → $APP_DIR"
install -d -m 755 -o paradox -g paradox "$APP_DIR"
install -d -m 750 -o paradox -g paradox "$CONFIG_DIR"

rsync -a --delete --exclude node_modules --exclude dist "$REPO_ROOT/" "$APP_DIR/"
# Keep .git so System Health can report commit / origin status (Plan 13).
cd "$APP_DIR"
chmod +x scripts/pam-auth.py scripts/install.sh \
  scripts/os-upgrade.sh scripts/os-upgrade-launch.sh
# typescript is a devDependency — install it for build, then prune for runtime
sudo -u paradox npm install
sudo -u paradox npm run build
sudo -u paradox npm prune --omit=dev

if [[ ! -f "$CONFIG_DIR/pxh.ini" ]]; then
    cp "$APP_DIR/config/pxh.example.ini" "$CONFIG_DIR/pxh.ini"
    chown paradox:paradox "$CONFIG_DIR/pxh.ini"
    echo "    Wrote $CONFIG_DIR/pxh.ini — edit machine.id / mqtt as needed"
fi

# sudoers (required for maintenance actions)
install -m 440 "$APP_DIR/config/sudoers.paradox-health" /etc/sudoers.d/paradox-health
if ! visudo -cf /etc/sudoers.d/paradox-health >/dev/null; then
    echo "ERROR: sudoers validation failed" >&2
    rm -f /etc/sudoers.d/paradox-health
    exit 1
fi
echo "    Installed /etc/sudoers.d/paradox-health"

install -m 644 "$APP_DIR/systemd/paradox-health.service" /etc/systemd/system/paradox-health.service
systemctl daemon-reload
systemctl enable --now paradox-health.service
echo "==> paradox-health.service active"
systemctl --no-pager --full status paradox-health.service || true
echo ""
echo "Next: edit $CONFIG_DIR/pxh.ini (machine.id, broker)."
echo "nginx: merge config/nginx-health.example.conf — /health-api/ → 127.0.0.1:19090, /health/ → UI"
echo "Docs: docs/INSTALL.md · docs/QUICK-SETUP.md"
echo "UI: http://$(hostname):19090/ui/"

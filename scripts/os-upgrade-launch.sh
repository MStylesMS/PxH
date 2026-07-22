#!/usr/bin/env bash
# Start a detached PxH OS upgrade (transient systemd unit).
# Invoked by PxH via: sudo /opt/paradox/apps/PxH/scripts/os-upgrade-launch.sh
# Must run as root (NOPASSWD allowlisted for user paradox).

set -euo pipefail

UNIT=pxh-os-upgrade
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKER="${SCRIPT_DIR}/os-upgrade.sh"

if [[ "${EUID}" -ne 0 ]]; then
  echo "os-upgrade-launch.sh must run as root" >&2
  exit 1
fi

if [[ ! -x "$WORKER" ]]; then
  echo "Worker not executable: $WORKER" >&2
  exit 1
fi

if systemctl is-active --quiet "${UNIT}.service" 2>/dev/null; then
  echo "Upgrade already in progress (${UNIT}.service)" >&2
  exit 75
fi

systemctl reset-failed "${UNIT}.service" 2>/dev/null || true

# RuntimeMaxSec=900 → 15 minute hard cap (matches SPEC)
systemd-run \
  --unit="$UNIT" \
  --property=Description="PxH OS package upgrade" \
  --property=RuntimeMaxSec=900 \
  --collect \
  "$WORKER"

echo "Started ${UNIT}.service"
exit 0

#!/usr/bin/env bash
# PxH OS upgrade worker — runs as root under transient unit pxh-os-upgrade.
# Do not invoke interactively unless debugging; use os-upgrade-launch.sh.

set -euo pipefail

STATUS_DIR=/run/pxh
STATUS_FILE="${STATUS_DIR}/upgrade-status.json"
LOG_FILE="${STATUS_DIR}/upgrade.log"
COMPLETED_FILE="${STATUS_DIR}/upgrade-completed"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
COMPLETED=0
TOTAL=0

mkdir -p "$STATUS_DIR"
chmod 755 "$STATUS_DIR"
: >"$LOG_FILE"
chmod 644 "$LOG_FILE"
echo 0 >"$COMPLETED_FILE"

write_status() {
  local in_progress="$1"
  local phase="$2"
  local message="$3"
  local ok="${4-}"
  local finished_at="${5-}"
  if [[ -f "$COMPLETED_FILE" ]]; then
    COMPLETED="$(tr -d '[:space:]' <"$COMPLETED_FILE" || echo 0)"
  fi
  IN_PROGRESS="$in_progress" PHASE="$phase" MESSAGE="$message" \
    COMPLETED="${COMPLETED:-0}" TOTAL="${TOTAL:-0}" OK="$ok" \
    STARTED_AT="$STARTED_AT" FINISHED_AT="$finished_at" \
    STATUS_FILE="$STATUS_FILE" python3 - <<'PY'
import json, os

ok_raw = os.environ.get("OK", "")
ok = True if ok_raw == "true" else False if ok_raw == "false" else None
finished = os.environ.get("FINISHED_AT") or None
data = {
    "inProgress": os.environ["IN_PROGRESS"] == "true",
    "phase": os.environ["PHASE"],
    "message": os.environ["MESSAGE"],
    "completed": int(os.environ.get("COMPLETED") or 0),
    "total": int(os.environ.get("TOTAL") or 0),
    "startedAt": os.environ.get("STARTED_AT") or None,
    "finishedAt": finished,
    "ok": ok,
}
path = os.environ["STATUS_FILE"]
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, separators=(",", ":"))
os.replace(tmp, path)
os.chmod(path, 0o644)
PY
}

fail() {
  local msg="$1"
  echo "$msg" | tee -a "$LOG_FILE" >&2
  write_status false error "$msg" false "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  exit 1
}

count_upgradable() {
  apt list --upgradable 2>/dev/null | grep -v '^Listing' | grep -c '/' || true
}

# Keep wlan0 on NetworkManager so ifupdown/wpa_supplicant cannot steal it
# during or after apt (common on this kiosk after package upgrades).
ensure_wlan0_nm() {
  {
    echo "===== wlan0 NetworkManager heal ====="
    nmcli -f DEVICE,TYPE,STATE,CONNECTION dev status || true
    ip link show wlan0 || true

    mkdir -p /etc/network/interfaces.d.disabled
    if [[ -e /etc/network/interfaces.d/wlan0-lineman.disabled ]]; then
      mv /etc/network/interfaces.d/wlan0-lineman.disabled \
        /etc/network/interfaces.d.disabled/wlan0-lineman.disabled
    fi
    if [[ -e /etc/network/interfaces.d/wlan0-lineman ]]; then
      mv /etc/network/interfaces.d/wlan0-lineman \
        /etc/network/interfaces.d.disabled/wlan0-lineman
    fi

    cat > /etc/network/interfaces.d/zz-no-wlan0 <<EOF
# Managed by NetworkManager. Do not ifup this interface.
iface wlan0 inet manual
EOF

    cat > /etc/NetworkManager/NetworkManager.conf <<EOF
[main]
plugins=ifupdown,keyfile

[ifupdown]
managed=true

[device]
wifi.scan-rand-mac-address=no
EOF
    mkdir -p /etc/NetworkManager/conf.d
    cat > /etc/NetworkManager/conf.d/10-manage-wlan0.conf <<EOF
[device]
match-device=interface-name:wlan0
managed=1
wifi.scan-rand-mac-address=no
EOF

    ifdown --force wlan0 || true
    pkill -f "/usr/sbin/wpa_supplicant .* -i wlan0" || true
    rm -f /run/wpa_supplicant.wlan0.pid /run/wpa_supplicant/wlan0 \
      /var/run/wpa_supplicant/wlan0 /run/network/ifstate.wlan0
    if [[ -f /run/network/ifstate ]]; then
      sed -i "/^wlan0=/d" /run/network/ifstate || true
    fi

    nmcli connection modify Paradox connection.autoconnect yes \
      connection.autoconnect-priority 100 \
      802-11-wireless.cloned-mac-address permanent || true

    systemctl restart wpa_supplicant NetworkManager || true
    sleep 4
    nmcli radio wifi on || true
    nmcli device set wlan0 managed yes || true
    ip link set wlan0 up || true
    sleep 3
    nmcli -w 45 connection up Paradox || true

    nmcli -f DEVICE,TYPE,STATE,CONNECTION dev status || true
    ip -4 addr show wlan0 || true
    ip -4 route || true
  } >>"$LOG_FILE" 2>&1 || true
}

write_status true network "Ensuring wlan0 is managed by NetworkManager…"
ensure_wlan0_nm

write_status true heal "Repairing interrupted dpkg (configure)…"
if ! dpkg --configure -a >>"$LOG_FILE" 2>&1; then
  fail "dpkg --configure -a failed — see /run/pxh/upgrade.log"
fi

write_status true update "Running apt-get update…"
if ! apt-get update >>"$LOG_FILE" 2>&1; then
  fail "apt-get update failed — see /run/pxh/upgrade.log"
fi

TOTAL="$(count_upgradable)"
RUN_TOTAL="$TOTAL"
echo 0 >"$COMPLETED_FILE"
export TOTAL STARTED_AT STATUS_FILE COMPLETED_FILE
write_status true upgrade "Upgrading packages…"

# Best-effort progress: APT::Status-Fd pmstatus lines (pkg reaches 100%)
set +e
DEBIAN_FRONTEND=noninteractive apt-get -y \
  -o Dpkg::Options::=--force-confdef \
  -o Dpkg::Options::=--force-confold \
  -o APT::Status-Fd=3 \
  upgrade >>"$LOG_FILE" 2>&1 \
  3> >(
    declare -A seen=()
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
        pmstatus:*)
          rest="${line#pmstatus:}"
          pkg="${rest%%:*}"
          rest2="${rest#*:}"
          pct="${rest2%%:*}"
          if [[ "$pct" == "100" && -n "$pkg" && -z "${seen[$pkg]:-}" ]]; then
            seen[$pkg]=1
            n="$(tr -d '[:space:]' <"$COMPLETED_FILE" 2>/dev/null || echo 0)"
            n=$((n + 1))
            echo "$n" >"$COMPLETED_FILE"
            COMPLETED="$n"
            write_status true upgrade "Configuring ${pkg}…"
          fi
          ;;
      esac
    done
  )
APT_RC=$?
set -e

# Give the status parser a moment to drain
sleep 0.2 || true

if [[ "$APT_RC" -ne 0 ]]; then
  fail "apt-get upgrade failed (exit ${APT_RC}) — see /run/pxh/upgrade.log"
fi

write_status true network "Re-applying wlan0 NetworkManager ownership…"
ensure_wlan0_nm

TOTAL="$RUN_TOTAL"
COMPLETED="$(tr -d '[:space:]' <"$COMPLETED_FILE" || echo 0)"
# Prefer a full bar when apt succeeded but status-fd under-counted
if [[ "$COMPLETED" -lt "$TOTAL" ]]; then
  COMPLETED="$TOTAL"
fi
echo "$COMPLETED" >"$COMPLETED_FILE"
write_status false done "Upgrade finished" true "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
rm -f "$COMPLETED_FILE"
exit 0

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

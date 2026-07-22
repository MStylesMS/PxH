# Paradox Health Monitor — Install

Install PxH on a Debian / Raspberry Pi OS host under `/opt/paradox`.

## Prerequisites

- Node.js ≥ 20
- User/group `paradox`
- MQTT broker reachable (often `127.0.0.1:1883`, not required to be local)
- Optional: nginx for preferred `/health/` URLs

## Quick install

```bash
cd /opt/paradox/apps/PxH   # or clone into this path
sudo bash scripts/install.sh
```

The installer:

1. Syncs the app tree to `/opt/paradox/apps/PxH` (keeps `.git` so version inventory works)
2. Runs `npm install`, `npm run build`, then `npm prune --omit=dev`
3. Writes `/opt/paradox/config/pxh.ini` from the example if missing
4. Installs `paradox-health.service` and enables it
5. Installs `/etc/sudoers.d/paradox-health` (NOPASSWD allowlist for maintenance actions)

## Required: sudoers

Destructive actions (`apt`, `systemctl`, reboot) run as user `paradox` via `sudo`.
Without the sudoers snippet they fail closed.

```bash
sudo install -m 440 /opt/paradox/apps/PxH/config/sudoers.paradox-health \
  /etc/sudoers.d/paradox-health
sudo visudo -cf /etc/sudoers.d/paradox-health
sudo -u paradox sudo -n apt-get clean   # should succeed with no password prompt
```

See [QUICK-SETUP.md](QUICK-SETUP.md) for first-boot config (`machine.id`, broker, nginx).

## nginx (preferred operator URL)

Merge [config/nginx-health.example.conf](../config/nginx-health.example.conf) into the venue site:

- `http://<host>/health/` → System Health UI
- `http://<host>/health-api/` → API + WebSocket

Fallback (always): `http://<host>:19090/ui/` — use when nginx itself is down.

HTTPS is optional and belongs on nginx (venue cert). PxH itself listens HTTP on `:19090`.

## Verify

```bash
systemctl status paradox-health
curl -s http://127.0.0.1:19090/metrics | head
curl -s http://127.0.0.1:19090/services
```

Open `http://<host>:19090/ui/` or `http://<host>/health/`.

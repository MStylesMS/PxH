# Prompt: Install Paradox Health Monitor (PxH) on Agent 22

Copy everything below the line into a fresh Cursor agent session on **agent22**.

---

## Goal

Install and enable **Paradox Health Monitor (PxH)** on this Agent 22 host so operators get:

1. A **System Health** link on the PxD landing page (`/health/`)
2. Live disk / service alerts in the PxD **System Warnings** pane (`paradox/+/system/alerts`)
3. `paradox-health.service` running on boot

Reference docs in the clone: `docs/INSTALL.md`, `docs/QUICK-SETUP.md`, `docs/SPEC.md`.  
Houdini already has a working reference install under `/opt/paradox/apps/PxH` and `/opt/paradox/config/pxh.ini`.

## Constraints

- App path: `/opt/paradox/apps/PxH`
- Config: `/opt/paradox/config/pxh.ini`
- Unit: `paradox-health.service` (user `paradox`)
- Node.js **≥ 20** required (install NodeSource 20.x if missing)
- Do **not** invent a separate password store — PAM against local OS users
- Do **not** break existing PFx / game / nginx / MQTT paths
- Prefer additive nginx snippets; reload nginx after merge
- Update the Agent 22 **PxD** `room.json` + repackage so the landing page and warnings pane pick up the new settings

## Steps

### 1. Prerequisites

```bash
hostname
node -v || true
id paradox
ls /opt/paradox/apps
systemctl is-active mosquitto nginx pfx 2>/dev/null || true
```

If Node is missing or &lt; 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # expect v20.x
```

### 2. Clone PxH

```bash
sudo mkdir -p /opt/paradox/apps
cd /opt/paradox/apps
if [ ! -d PxH/.git ]; then
  sudo -u paradox git clone git@github.com:MStylesMS/PxH.git PxH
else
  cd PxH && sudo -u paradox git pull --ff-only
fi
```

(If SSH to GitHub fails, use HTTPS or rsync from a host that already has the tree.)

### 3. Install as a system service

```bash
cd /opt/paradox/apps/PxH
sudo bash scripts/install.sh
```

This builds the app, installs sudoers, enables `paradox-health.service`, and seeds `pxh.ini` from the example if missing.

### 4. Configure `/opt/paradox/config/pxh.ini` for Agent 22

Edit at least:

```ini
[machine]
id = agent22
hostname = agent22

[mqtt]
enabled = true
broker = mqtt://127.0.0.1:1883
topic_root = paradox

[services]
; Trim to units that exist on this host (systemctl list-units --type=service)
required = mosquitto,nginx,pfx
optional = paradox-health
user =
; Add room game / bridge units if present, e.g. user = houdini-game — or Agent22 equivalents
```

Publish prefix becomes `paradox/agent22/system/{health,disk,services,alerts}`.

Restart after edits:

```bash
sudo systemctl restart paradox-health
systemctl status paradox-health --no-pager
curl -s http://127.0.0.1:19090/metrics | head
curl -s http://127.0.0.1:19090/services
```

Fallback UI (always): `http://<agent22>:19090/ui/`

### 5. nginx — preferred `/health/` URLs

Merge `apps/PxH/config/nginx-health.example.conf` into the venue site (often `/etc/nginx/sites-available/paradox-html` or the Agent 22 site):

- `location /health/` → alias `PxH/public/`
- `location /health-api/` → proxy to `127.0.0.1:19090/` (WebSocket upgrade required)

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI http://127.0.0.1/health/ | head
```

### 6. Update PxD room package (landing + System Warnings)

Locate the Agent 22 room source (typically `rooms/agent22/pxd/room.json` or the path this host actually uses). Apply:

**A. Landing link** — ensure `sites[]` includes an external System Health entry (starter already documents this):

```json
{
  "id": "system-health",
  "title": "System Health",
  "description": "Host metrics, disk, services, IDE prune (Paradox Health Monitor)",
  "type": "external",
  "url": "/health/"
}
```

**B. System Warnings topics** — under `system.warningTopics`, include PxH alerts in addition to room warnings:

```json
"system": {
  "warningTopics": [
    "paradox/agent22/warnings",
    "paradox/agent22/+/warnings",
    "paradox/+/system/alerts"
  ]
}
```

(Adjust the room prefix to match this room’s `topicRoot`. Keep `paradox/+/system/alerts` so every host’s PxH alerts — controller, picture, etc. — appear.)

**C. Repackage and verify nginx still serves the packaged HTML:**

```bash
cd /opt/paradox/apps/PxD
npm run package:agent22
# or: node scripts/package.js --room-dir ../../rooms/agent22/pxd --out ../../rooms/agent22/html
sudo nginx -t && sudo systemctl reload nginx
```

Confirm the landing page lists **System Health** and that opening it loads the PxH UI.

### 7. Optional: paradox-control integration

If this host’s `/opt/paradox/scripts/paradox-control.sh` and `install-services.sh` already know about `paradox-health` (newer trees do), run:

```bash
/opt/paradox/scripts/paradox-control.sh status
/opt/paradox/scripts/paradox-control.sh logs health
```

Otherwise `systemctl` / `journalctl -u paradox-health` is enough.

### 8. Acceptance checklist

- [ ] `systemctl is-active paradox-health` → `active`
- [ ] `http://<host>:19090/ui/` and (if nginx merged) `http://<host>/health/` show non-null disk %
- [ ] MQTT retained health visible: `mosquitto_sub -t 'paradox/agent22/system/health' -C 1 -W 35`
- [ ] PxD landing shows **System Health**
- [ ] `system.warningTopics` includes `paradox/+/system/alerts`
- [ ] Required services in the UI match units actually installed on Agent 22
- [ ] IDE prune dry-run works after PAM login in the UI

## Out of scope

- Fleet Diagnose & Repair (PxP / pxp-agent)
- Changing game logic or PFx media config
- Forcing nginx if the venue intentionally uses only `:19090` (document that in the room link)

## Expected return

Short report: commands run, `pxh.ini` machine id + required services, nginx changed (yes/no), room.json paths edited, package command used, and the acceptance checklist results.

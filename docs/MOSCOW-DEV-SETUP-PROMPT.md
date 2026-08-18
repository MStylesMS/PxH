# Prompt: Install Paradox Health Monitor (PxH) on SpyCatcher Moscow (dev)

Copy everything below the line into a fresh Cursor agent session connected to
**moscow-dev.local** (SpyCatcher Moscow development host).

---

## Goal

Install and enable **Paradox Health Monitor (PxH)** on this SpyCatcher Moscow
dev machine (`moscow-dev` / `moscow-dev.local`) so operators get:

1. A **System Health** link on the PxD landing page (`/health/`)
2. Live disk / service alerts in the PxD **System Warnings** pane (`paradox/+/system/alerts`)
3. `pxh.service` running on boot

Reference docs in the clone: `docs/INSTALL.md`, `docs/QUICK-SETUP.md`, `docs/SPEC.md`.  
Working reference installs already exist on Houdini (`/opt/paradox/apps/PxH`,
`/opt/paradox/config/pxh.ini`) and the Houdini picture Pi (`id = picture`).

## Host context

- This workspace is the **SpyCatcher Moscow** development Pi.
- mDNS / LAN name: **`moscow-dev.local`**
- Prefer stable MQTT machine id **`moscow-dev`** (matches hostname; appears as
  `paradox/moscow-dev/system/...`)
- Room MQTT `topicRoot` is typically **`paradox/spycatcher`** (confirm in the
  live `room.json` — do not invent a different root)
- Dashboards are often served under `/spycatcher/` (e.g. `/spycatcher/simple/`,
  `/spycatcher/live/`) — discover the actual nginx root / room path on this host

## Constraints

- App path: `/opt/paradox/apps/PxH`
- Config: `/opt/paradox/config/pxh.ini`
- Unit: `pxh.service` (user `paradox`)
- Node.js **24 LTS** required (`/usr/local/bin/node`; install official binary or NodeSource 24.x if missing)
- Do **not** invent a separate password store — PAM against local OS users
- Do **not** break existing PFx / game / nginx / MQTT / PxT terminal paths
- Prefer additive nginx snippets; reload nginx after merge
- Update this host’s **PxD** `room.json` + repackage so the landing page and
  warnings pane pick up the new settings
- If this host is picture-only (PFx only), watch `pfx` alone and point MQTT at
  the room broker; otherwise use the combined/controller profile below

## Steps

### 1. Prerequisites / discover layout

```bash
hostname
hostname -f || true
node -v || true
id paradox
ls /opt/paradox/apps
ls /opt/paradox/rooms
systemctl is-active mosquitto nginx pfx pxb pxo pxh 2>/dev/null || true
readlink -f /opt/paradox/config/pfx.ini 2>/dev/null || true
ls /etc/nginx/sites-enabled 2>/dev/null
# Find SpyCatcher PxD source + packaged HTML
find /opt/paradox/rooms -maxdepth 4 -name room.json 2>/dev/null | head -40
```

If **Tailscale** is set up on this host, disable Raspberry Pi Connect (standard on all
Paradox Pis — saves RAM/CPU; use Tailscale SSH instead):

```bash
tailscale status | head
command -v rpi-connect >/dev/null && rpi-connect off
rpi-connect status
```

Note the real room source path (examples to look for):

- `rooms/spycatcher/pxd/room.json`
- `rooms/spycatcher/moscow/pxd/room.json`
- `rooms/spycatcher-moscow/pxd/room.json`

and where nginx serves it from (symlink under `/opt/paradox/html/…` or a
`/spycatcher/` alias).

If Node is missing, not under `/usr/local/bin`, or &lt; 24:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # expect v24.x LTS
which node  # prefer /usr/local/bin/node for systemd units
```

If Debian/Raspberry Pi OS still ships an older `/usr/bin/node` via apt, remove it after
installing 24 LTS so services do not pick up the wrong runtime:

```bash
sudo apt-get remove -y nodejs
/usr/local/bin/node -v
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

(If SSH to GitHub fails, use HTTPS or rsync from a host that already has the tree,
e.g. houdini’s `/opt/paradox/apps/PxH`.)

### 3. Install as a system service

```bash
cd /opt/paradox/apps/PxH
sudo bash scripts/install.sh
```

This builds the app, installs sudoers, enables `pxh.service`, and
seeds `pxh.ini` from the example if missing.

### 4. Configure `/opt/paradox/config/pxh.ini` for moscow-dev

Edit at least:

```ini
[machine]
id = moscow-dev
hostname = moscow-dev

[mqtt]
enabled = true
; Local broker on the room controller / combined install
broker = mqtt://127.0.0.1:1883
topic_root = paradox

[services]
; Trim to units that actually exist on this host:
;   systemctl list-units --type=service --all | grep -Ei 'pfx|pxo|pxb|nginx|mosquitto|game'
required = mosquitto,nginx,pfx
optional = pxh
user =
; Add SpyCatcher game / bridge / orchestrator units if present on this Pi
; (examples only — verify names first): pxo, pxb, spycatcher-game, etc.
```

Publish prefix becomes `paradox/moscow-dev/system/{health,disk,services,alerts}`.

If Mosquitto is remote (unusual for moscow-dev, but possible), set `broker` to
that URL the same way PFx does in `pfx.ini`.

Restart after edits:

```bash
sudo systemctl restart pxh
systemctl status pxh --no-pager
curl -s http://127.0.0.1:19090/metrics | head
curl -s http://127.0.0.1:19090/services
```

Fallback UI (always): `http://moscow-dev.local:19090/ui/`  
(or this host’s Tailscale / LAN IP on `:19090/ui/`)

### 5. nginx — preferred `/health/` URLs

Merge `apps/PxH/config/nginx-health.example.conf` into the venue site that
serves SpyCatcher (often `/etc/nginx/sites-available/paradox-html`,
`spycatcher`, or similar under `sites-enabled`):

- `location /health/` → alias `/opt/paradox/apps/PxH/public/`
- `location /health-api/` → proxy to `127.0.0.1:19090/` (WebSocket upgrade required)

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI http://127.0.0.1/health/ | head
curl -sI http://moscow-dev.local/health/ | head
```

### 6. Update PxD room package (landing + System Warnings)

Edit the SpyCatcher Moscow `room.json` discovered in step 1.

**A. Landing link** — ensure `sites[]` includes an external System Health entry:

```json
{
  "id": "system-health",
  "title": "System Health",
  "description": "Host metrics, disk, services, IDE prune (Paradox Health Monitor)",
  "type": "external",
  "url": "/health/"
}
```

**B. System Warnings topics** — under `system.warningTopics`, keep room warnings
and add PxH alerts. Use this host’s real `topicRoot` (confirm in `room.json`;
usually `paradox/spycatcher`):

```json
"system": {
  "warningTopics": [
    "paradox/spycatcher/warnings",
    "paradox/spycatcher/+/warnings",
    "paradox/+/system/alerts"
  ]
}
```

Keep `paradox/+/system/alerts` so every host’s PxH alerts (moscow-dev, any
picture / secondary Pi, etc.) appear in the pane.

**C. Repackage** using the paths that exist on this machine:

```bash
cd /opt/paradox/apps/PxD
# Prefer an npm script if present, otherwise call the packager explicitly, e.g.:
# npm run package:spycatcher
# or:
node scripts/package.js \
  --room-dir ../../rooms/spycatcher/pxd \
  --out      ../../rooms/spycatcher/html
# Adjust --room-dir / --out to the paths found in step 1.
sudo nginx -t && sudo systemctl reload nginx
```

Confirm the SpyCatcher landing page lists **System Health** and that opening it
loads the PxH UI (`/health/` or `:19090/ui/`).

### 7. Optional: paradox-control integration

If this host’s `/opt/paradox/scripts/paradox-control.sh` already knows about
`pxh`:

```bash
/opt/paradox/scripts/paradox-control.sh status
/opt/paradox/scripts/paradox-control.sh logs health
```

Otherwise `systemctl` / `journalctl -u pxh` is enough.

### 8. Acceptance checklist

- [ ] `hostname` is `moscow-dev` (or document the actual name if different)
- [ ] `systemctl is-active pxh` → `active`
- [ ] `http://moscow-dev.local:19090/ui/` and (if nginx merged)
      `http://moscow-dev.local/health/` show non-null disk %
- [ ] MQTT retained health visible:
      `mosquitto_sub -t 'paradox/moscow-dev/system/health' -C 1 -W 35`
- [ ] SpyCatcher PxD landing shows **System Health**
- [ ] `system.warningTopics` includes `paradox/+/system/alerts`
- [ ] Required services in the UI match units actually installed on this Pi
- [ ] IDE prune dry-run works after PAM login in the UI

## Out of scope

- Fleet Diagnose & Repair (PxP / pxp-agent)
- Changing SpyCatcher game logic, PxT terminal config, or PFx media config
- Migrating the whole room to a new PxD layout (only add the health link +
  warning topics)
- Production Moscow / Washington hosts unless this workspace clearly *is* that
  host (this prompt targets **moscow-dev**)

## Expected return

Short report: hostname, room.json path used, package command used, `pxh.ini`
`machine.id` + `required` services, nginx changed (yes/no), and the acceptance
checklist results.

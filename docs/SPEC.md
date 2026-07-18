# Paradox Health Monitor (PxH) — Functional Specification

_Status: draft / bootstrap from existing prototype_  
_Last updated: 2026-07-17_  
_Product name:_ **Paradox Health Monitor** (short: **PxH**). Earlier UI copy used “Machine Health”;
an interim draft name was “Paradox Monitor (PxM)”.

> **Note on the acronym:** The former product **Paradox Hub** also used “PxH” and is now
> **Paradox Prime (PxP)**. This repository and acronym **PxH** mean **Paradox Health Monitor** only.

---

## 0. Provenance (what already exists)

The start of this product already lives on some install trees as an informal **Machine Health** stack:

| Piece | Location | Notes |
|-------|----------|--------|
| Health API | `/opt/paradox/scripts/health-api.js` | Node HTTP API on `:19090` |
| Systemd unit | `paradox-health-api.service` | Present on lab host (`pi5-ssd`); **not** deployed on all store Pis (e.g. Agent22) |
| Health UI | `/opt/paradox/html/pi5-ssd/health/index.html` | Title: “Machine Health”; polls `/health-api/metrics` |
| Hub link | `/opt/paradox/html/pi5-ssd/index.html` | Card → `/health/` |
| Nginx | `config/nginx-paradox.conf`, `config/houdini-nginx.conf` | `/health/` static + `/health-api/` proxy |
| Docs mention | `scripts/README.md`, `docs/SETUP.md` | Describes launcher/health pages |

This document treats that stack as the **prototype** for Paradox Health Monitor and defines the
productization path into `apps/PxH`.

---

## 1. Purpose

Paradox Health Monitor (PxH) is a **host-local system health service** for Paradox room machines. It:

1. Collects machine and Paradox-runtime health metrics.
2. Serves a simple **System Health** web UI for operators.
3. Publishes health/alerts over **MQTT** for dashboards, PxD, PxP, or remote ops.
4. Optionally exposes safe operator actions (refresh, package upgrade, reboot, service controls,
   IDE prune) already prototyped in `health-api.js` / specified below.

It is **not** a replacement for PFx/PxO game logic, PxD camera tooling, PxP’s Diagnose & Repair
suite, or **pxp-agent** remote management. It is the always-on, low-dependency health beacon on
each Pi.

---

## 2. Goals

- Answer “is this room machine healthy?” from a browser on the LAN/Tailscale.
- Surface that answer from game **landing pages** (PxD-generated index links).
- Emit MQTT telemetry and threshold alerts so a full disk / dead service is visible before showtime.
- Install cleanly as a **systemd service** on every Paradox host (combined, mirror, picture,
  Agent22, etc.).
- Stay small enough for 8–16 GB SD cards (no large IDE caches as part of the product).

---

## 3. Non-goals (initial product)

- Full MQTT message browser (see PxP `MQTT_MONITOR.md`).
- Remote fleet orchestration UI (PxP / pxp-agent territory).
- Unrestricted filesystem cleanup outside the defined IDE prune / apt / npm cache actions (§7.1–7.2).
  Media and room configs are never auto-deleted.

---

## 4. Current prototype behavior (as of 2026-07-17)

### 4.1 Metrics (`GET /metrics`)

Reported today (when API is running):

- Host name, timestamp, uptime
- CPU load (1/5/15), per-core %, SoC temperature
- GPU memory (vcgencmd), GPU temp (same sensor where applicable)
- RAM used / total / %
- **Disk root (`diskRoot`)** — intended fields: `totalGb`, `usedGb`, `availableGb`, `usedPercent`
- Apt updates available count
- Sudo-without-password capability flag

**Known defect:** on the lab host, `diskRoot` currently returns `null` because `readDiskRoot()`
builds a broken `awk` command string. The Machine Health UI already has a Disk Used card and falls
back to “n/a”. Fixing disk metrics is required before disk monitoring can be trusted.

### 4.2 Runtime status (`GET /runtime`)

Service/process summary used by the Control Hub (MQTT, OpenClaw gateway, PFx/PxO/PxB/PxT/PFxE,
clock target, etc.). Broader than pure “machine health”; productization may split **host metrics**
vs **runtime control** later.

### 4.3 Actions (prototype)

- `POST /actions/upgrade` — apt update/upgrade (sudo required)
- `POST /actions/restart` — reboot host
- `POST /actions/service` — start/stop/restart selected Paradox services
- Additional hub helpers for PxC/PxT/PxB profile selection

### 4.4 UI

- Path: `/health/` (nginx alias to static HTML)
- Auto-refresh ~15s
- Cards for CPU, temp, GPU, RAM, disk, updates, uptime, host
- Buttons: Refresh, Upgrade Packages, Restart Machine

### 4.5 Deployment gaps

- Agent22 (and likely other store installs) lack `health-api.js`, the systemd unit, nginx
  `/health-api/` proxy, and landing-page System Health link.
- Prototype naming was inconsistent (“Machine Health” vs interim “Paradox Monitor”).

---

## 5. Target architecture

```
┌─────────────────────────────┐
│  paradox-health.service     │  (systemd; Node — PxH)
│  - collect metrics          │
│  - HTTP API (:19090)        │
│  - MQTT publisher           │
└──────────┬──────────────────┘
           │
     ┌─────┴──────┐
     │            │
     ▼            ▼
 /health-api/   MQTT topics
     │         paradox/<room-or-host>/system/...
     ▼
 /health/  (static System Health UI)
     ▲
     │ link from
 PxD landing page / Control Hub
```

**Install layout:**

- App: `/opt/paradox/apps/PxH/`
- Unit: `paradox-health.service` (compat alias `paradox-health-api.service` during migration)
- Config: `/opt/paradox/config/pxh.ini` (MQTT broker, room/host id, thresholds, publish interval)
- UI static: served as `/health/` (nginx → `PxH/public/` or `html/health/`)

---

## 6. Functional requirements

### 6.1 System service

| ID | Requirement |
|----|-------------|
| S1 | Installable via Paradox install scripts; enabled on boot |
| S2 | Runs as `paradox` user; restarts on failure |
| S3 | Depends on `network-online.target`; MQTT publish soft-fails if broker down, retries |
| S4 | Bound primarily to localhost; nginx exposes `/health-api/` |

### 6.2 System Health page

| ID | Requirement |
|----|-------------|
| U1 | Served at `/health/` (or `/system-health/`) on each game host |
| U2 | Shows host metrics including **disk used % and free space** with warn/critical coloring |
| U3 | Linked from Control Hub and from **PxD-generated game landing pages** as “System Health” |
| U4 | Works on Tailscale hostnames (e.g. `http://agent22.story-geological.ts.net/health/`) |

### 6.3 MQTT publication

| ID | Requirement |
|----|-------------|
| M1 | Periodically publish retained host snapshot (JSON) |
| M2 | Publish alert messages when thresholds crossed (edge-triggered + periodic reaffirm while critical) |
| M3 | Topic scheme (proposed): `paradox/<id>/system/health`, `paradox/<id>/system/disk`, `paradox/<id>/system/alerts` where `<id>` is room slug or hostname from config |
| M4 | Alert payload includes at least: `level`, `type`, `message`, metric values, ISO timestamp |

### 6.4 Landing page integration (PxD)

| ID | Requirement |
|----|-------------|
| L1 | Packager/landing config can include an optional external/manual site entry for System Health (e.g. `/health/` or absolute URL) |
| L2 | Default room templates document how to enable the link |
| L3 | Single-site redirect landings still allow a secondary health link where operators expect a menu |

---

## 7. Future additions

### 7.1 Disk space monitoring & reporting _(priority — motivated by Agent22 2026-07-17 outage)_

**Incident summary:** Agent22’s root filesystem filled to 100% (remote IDE server caches + apt/npm
caches on a 15 GB card). PxO crashed with `ENOSPC` while writing logs; systemd entered
restart-rate-limit failure. PFx logged MPV `SIGTERM` during service restarts — a secondary symptom,
not the root cause.

**Add to Paradox Health Monitor:**

| ID | Requirement |
|----|-------------|
| D1 | Fix and continuously report root filesystem usage (`df /`) in API, UI, and MQTT |
| D2 | Configurable thresholds (defaults: **warn ≥ 85%**, **critical ≥ 95%**, or free-GB floors for small cards) |
| D3 | MQTT alert on threshold cross; retained disk snapshot for dashboards |
| D4 | Health UI disk card: used %, used/total GB, free GB, color bands (good/warn/critical) |
| D5 | Optional “top consumers” diagnostic (e.g. `~/.vscode-server`, `~/.cursor-server`, `~/.npm`, `/var/cache/apt`, `/opt/paradox/logs`) — read-only listing for operators |
| D6 | Optional safe cleanup actions (gated, confirm in UI): `apt-get clean`, `npm cache clean`, and **IDE remote-server prune** (§7.2) — never delete media or room configs automatically |
| D7 | Document store-Pi policy: avoid leaving multiple Cursor/VS Code remote server versions on production cards; prefer ≥32 GB media where practical |

### 7.2 Prune IDE remote servers _(maintenance — beyond monitoring)_

PxH should **maintain** free space on store Pis by pruning stale remote IDE server installs. This is
the primary disk consumer that filled Agent22 (hundreds of MB per leftover build).

**Scan targets**

| Path | Pattern |
|------|---------|
| Cursor | `~/.cursor-server/bin/linux-arm64/*` |
| VS Code | `~/.vscode-server/cli/servers/Stable-*` |

**Keep / delete rules**

1. Scan running processes for Cursor/VS Code server hashes (or build ids) currently in use.
2. **Keep** any hash/build that appears in a running process.
3. **Delete** all other matching server directories under the scan targets.
4. Also remove orphaned `~/.vscode-server/code-*` binaries.
5. Clear `~/.vscode-server/data/CachedExtensionVSIXs`.
6. After pruning VS Code servers, reset `~/.vscode-server/cli/servers/lru.json` to `[]`.
7. Optional: drop log dirs under `*/data/logs` older than ~7 days.

**Operations**

| ID | Requirement |
|----|-------------|
| P1 | Implement as a PxH maintenance action (UI confirm + MQTT/log result) and/or a periodic systemd timer |
| P2 | Default schedule: **weekly**, or **on-demand when free space is low** (e.g. after warn/critical disk threshold) |
| P3 | Never delete a build still referenced by a live process; dry-run mode lists what would be removed |
| P4 | Report bytes reclaimed and which builds were kept vs deleted in the action result / MQTT event |
| P5 | Expectation: **~300–550 MB per stale build** recovered |

**Safety notes**

- Run as the `paradox` user (home dirs above are under `/home/paradox`).
- Do not touch `/opt/paradox` media, configs, or app trees.
- If no IDE remote session is active, pruning may remove *all* cached servers (acceptable on store
  Pis; next remote connect re-downloads).

### 7.3 Other backlog (non-blocking)

- Inode exhaustion monitoring (`df -i`)
- Journald disk usage
- Per-service last-heartbeat from PFx/PxO discovery
- Push bridge (Telegram / HA) from a central subscriber of `paradox/+/system/alerts`
- Extract Control Hub service-control endpoints out of PxH into a dedicated ops API if the surface
  grows too large

---

## 8. Acceptance criteria (MVP productization)

1. `paradox-health` (or current `paradox-health-api`) unit is active on a fresh Agent22-class install.
2. `/health/` loads and shows non-null **disk** metrics.
3. Crossing warn threshold publishes an MQTT alert within one publish interval.
4. PxD landing page for Agent22 (or equivalent) includes a **System Health** link that reaches that page.
5. Filling the disk no longer fails silently: operators see UI + MQTT before PxO dies with `ENOSPC`.

---

## 9. Open decisions

- Room id source: hostname vs `pfx.ini` / `pxo.ini` room prefix vs explicit `pxh.ini`.
- Whether runtime service control stays in PxH or moves fully under PxP / Control Hub only.
- ~~Branding~~ → **Resolved:** product is **Paradox Health Monitor (PxH)**; UI page title
  **System Health**; nginx path remains `/health/`.

---

## 10. Related references

- Prototype API: `/opt/paradox/scripts/health-api.js`
- Prototype UI: `/opt/paradox/html/*/health/`
- Nginx templates: venue `config/nginx-paradox.conf`, `config/houdini-nginx.conf`
- PxD landing generation: `apps/PxD/scripts/package.js` (`buildLandingPage`)
- PxP diagnose concepts: PxP `docs/MQTT_MONITOR.md`, `docs/SPEC.md` (fleet-level; complementary)
- Remote management agent: [PxP-Agent](https://github.com/MStylesMS/PxP-Agent) (different job)

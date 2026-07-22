# Paradox Health Monitor (PxH) — Functional Specification

_Status: MVP_  
_Last updated: 2026-07-19_  
_Product:_ **Paradox Health Monitor** (**PxH**)

> Former **Paradox Hub** is now **Paradox Prime (PxP)**. This repo’s **PxH** means Health Monitor only.

**Related:** [API.md](API.md) · [INSTALL.md](INSTALL.md) · [QUICK-SETUP.md](QUICK-SETUP.md) · [pending plans](pending/INDEX.md) · [business overview](BUSINESS-OVERVIEW.html)

---

## 0. Provenance

Informal **Machine Health** prototype on some hosts (`health-api.js` on `:19090`,
`paradox-health-api.service`, `/health/` HTML). Lab host **pi5-ssd** also has a one-off Hub —
**out of product scope**, but must not collide with PxH defaults when both run for testing
(see §12 and [pending/09-pi5-ssd-coexistence.md](pending/09-pi5-ssd-coexistence.md)).

---

## 1. Purpose

PxH is the **host-local health beacon** on each Paradox room machine:

1. Collect host metrics (CPU, RAM, temp, **disk**, apt, …).
2. Monitor configured **systemd units** (Paradox apps + system deps + optional user services).
3. Serve a **System Health** web UI (metrics cards + warning/journal/props panels).
4. Publish health/disk/alerts on MQTT; **subscribe** to configured warning/prop topics for the UI.
5. Offer gated maintenance: apt/npm clean, **IDE remote-server prune**, optional service
   start/stop/restart/enable/disable.

**Not** game logic, not PxD cameras, not PxP fleet Diagnose & Repair, not **pxp-agent**.

---

## 2. Goals / non-goals

**Goals:** LAN/Tailscale “is this Pi healthy?”; disk/ENOSPC prevention; landing-page link; small
footprint on 8–16 GB cards; installable on every host profile (only configured services matter).

**Non-goals (PxH):** MQTT Explorer-style browsing (→ PxP MQTT Monitor); fleet orchestration
(→ PxP + pxp-agent); game-run history / audit reports / people-counting / IM push (→ PxP/PxO
plans — see [pending/INDEX.md](pending/INDEX.md)); unrestricted filesystem deletes.

---

## 3. Target architecture

```
                    ┌──────────────────────────────────────┐
                    │  paradox-health.service (PxH / Node) │
                    │  metrics · systemd probe · MQTT      │
                    │  HTTP + WS API (:19090 default)      │
                    │  optional: serve UI itself           │
                    └────────────┬─────────────────────────┘
           ┌─────────────────────┼─────────────────────────┐
           ▼                     ▼                         ▼
    LAN :19090/ui          nginx /health/             MQTT broker
    (fallback path)        + /health-api/             pub: …/system/*
                           (preferred)                sub: warnings, props, …
```

| Path | Role |
|------|------|
| App | `/opt/paradox/apps/PxH/` |
| Config | `/opt/paradox/config/pxh.ini` |
| Unit | `paradox-health.service` |
| Operator UI URL | Prefer `http://<host>/health/` via nginx; **always** also reachable at `http://<host>:19090/ui/` |

Default bind: `0.0.0.0:19090` (LAN/Tailscale viewing). HTTPS belongs on nginx if the venue already has certs; PxH itself serves HTTP.

---

## 4. Configuration (`pxh.ini`)

Single INI drives machine id, thresholds, service lists, MQTT pub/sub, UI panels, themes, history
limits, auth, prune. Full sample: [config/pxh.example.ini](../config/pxh.example.ini).

| Section | Purpose |
|---------|---------|
| `[server]` | bind host/port (`0.0.0.0` default), `serve_ui` |
| `[machine]` | `id` (MQTT `<id>`), display hostname |
| `[thresholds]` | disk warn/critical % and free-GB floors |
| `[services]` | required / optional / user units; `scan_conflicts` (default true) |
| `[apps]` | unit → absolute path for Paradox app git checkouts (version inventory) |
| `[mqtt]` | broker, `topic_root` (default `paradox`), optional `topic_base` override, interval |
| `[warnings]` | topic patterns, colors, history limits → **System Warnings** panel |
| `[journal]` | enable, unit filters, history, severity colors |
| `[props]` | announce topic(s) (default `paradox/props`), history |
| `[ui]` | theme `day` / `night` / `auto`, refresh interval |
| `[actions]` | gates, `session_hours`, `allowed_users` |
| `[prune]` | `schedule` (`weekly` \| `low_disk` \| `manual_only`), `interval_hours` |

---

## 4.1 Auth model

- **View** (metrics, panels, WebSocket): open on the trusted LAN/Tailscale network.
- **Actions** (apt, cleanup, service control, reboot, IDE prune preview/execute): require PAM
  authentication against a **local OS username/password**, then an httpOnly session cookie
  (default 12 hours). Optional `allowed_users` allowlist.
- Do not invent a separate PxH password store. Network is considered safe; this gate stops guests.

Sudoers: install [config/sudoers.paradox-health](../config/sudoers.paradox-health) so user `paradox`
can run the allowlisted maintenance commands without a password prompt. See [INSTALL.md](INSTALL.md).

---

## 5. Disk space monitoring _(MVP)_

| ID | Requirement |
|----|-------------|
| D1 | Continuously report root usage (`diskRoot`) in API, UI, MQTT — never silently `null` when `/` is readable |
| D2 | Thresholds default **warn ≥ 85%**, **critical ≥ 95%**, optional free-GB floors |
| D3 | MQTT alert on threshold cross + periodic reaffirm while critical; retained disk snapshot |
| D4 | UI disk card with good/warn/critical bands |
| D5 | Optional read-only “top consumers” listing (IDE caches, apt, npm, `/opt/paradox/logs`) |
| D6 | Gated cleanup: `apt-get clean`, `npm cache clean`, IDE prune (§6) — never auto-delete media/room configs |
| D7 | Document store-Pi policy: prune IDE leftovers; prefer ≥32 GB where practical |

Suite log retention remains a companion track: [pending/02-suite-log-retention.md](pending/02-suite-log-retention.md).

---

## 6. IDE remote-server prune _(MVP)_

| Scan | Pattern |
|------|---------|
| Cursor | `~/.cursor-server/bin/linux-arm64/*` |
| VS Code | `~/.vscode-server/cli/servers/Stable-*` (+ orphaned `code-*`, CachedExtensionVSIXs, reset `lru.json`) |

Rules: keep builds referenced by live processes; delete others; dry-run required; run as `paradox`;
never touch `/opt/paradox` media/apps/configs.

| ID | Requirement |
|----|-------------|
| P1 | UI action (session-gated) + in-process auto schedule |
| P2 | When `schedule` is `weekly` or `low_disk`: prune at **startup** and every `interval_hours`; also when disk ≥ warn if `low_disk` |
| P3–P5 | Dry-run, bytes reclaimed report, MQTT/log result |

`manual_only` disables auto prune (UI still available when logged in).

---

## 7. Service / process health

| Tier | Examples | Behavior |
|------|----------|----------|
| **Required** | `mosquitto`, `nginx`, room Paradox units (`pfx`, `pxo`, …) | Failed/inactive → UI critical + MQTT alert |
| **Optional** | `paradox-health` self, extras | Shown but soft |
| **User-defined** | Operator-added unit names in `pxh.ini` | Same state model |

**States:** `running` | `stopped` | `failed` | `unknown`  
**Boot:** `enabled` | `disabled` | `static` | `masked` | `unknown` (from `systemctl is-enabled`)

**Unmanaged process conflicts:** For known Paradox (and select system) units, PxH also
scans host processes by cmdline fingerprint. Any match **not** in the unit’s systemd
cgroup is reported as `extraProcesses` (lab/dev copies or orphans). The Services UI shows
a **red count badge**; click lists those PIDs (and short cmdlines). Disable with
`[services] scan_conflicts = false`.

**UI controls (session required):** contextual Start/Stop, Restart, and Enable/Disable.
Stop/Disable of `paradox-health` itself is refused (would take down the UI).

### 7.1 Paradox app versions & updates (Phases 1–2)

Mapped units in `[apps]` (default paths under `/opt/paradox/apps/…`) are real git checkouts
with `origin` (SSH keys already on the host). On UI load / Refresh (not the periodic services
poll), PxH runs `git fetch` and reports behind/HEAD for the Services grid.

**Card:** `Update available.` when behind; gear opens an update modal (PAM session for Apply).

**Apply:** `git fetch` → checkout branch → `git reset --hard <sha>` → `systemctl restart`
(including self-update of `paradox-health`). Refuses a dirty working tree. Commit SHAs must
be ancestors of `origin/<branch>`. Gated by `[actions] allow_app_update`.

Infra units (`mosquitto`, `nginx`) stay systemd-only. See
[pending/13-app-versions-and-updates.md](pending/13-app-versions-and-updates.md).

---

## 8. How the UI is served (nginx vs self)

**Decision (approved):**

1. **Primary:** nginx proxies `/health-api/` → `127.0.0.1:19090` and aliases `/health/` → static UI
   (or proxies `/health/` → PxH `/ui/`).
2. **Always-on fallback:** PxH binds API+UI on `:19090` (default `0.0.0.0`).
3. **Do not** auto-bind :80/:443 when nginx fails. When UI is loaded via `:19090`, the page
   calls `GET /reachability/nginx-health` (server-side probe of `http://127.0.0.1/health/`) and
   shows a degraded banner if unreachable — browser cross-origin fetch to port 80 from `:19090`
   is unreliable.

---

## 9. System Health UI

### 9.1 Metrics cards

Host, uptime, CPU, temp, GPU mem, RAM, **disk**, apt updates, plus a **Services** grid
(same ~⅓ width cards as the warning panels) with contextual unit controls and, for Paradox
apps in `[apps]`, an update gear / “Update available.” modal for branch/commit checkout.

### 9.2 System Warnings (MQTT)

Config-driven topic patterns + color keys; ring buffer (default 200 lines / 24h).

### 9.3 Journal Messages

**Separate panel.** Source: `journalctl` for configured units. Color by **severity**. Default
100 lines / 6 hours.

### 9.4 Prop appearances

Optional panel on `paradox/props` (+ config). Default 50 lines / 7 days.

### 9.5 Themes

`ui.theme = day | night | auto` **plus** a header toggle persisted in `localStorage`.
Semantic colors map to dark tones on day / light tones on night.

### 9.6 Live data

**WebSocket primary** (`WS /ws`); HTTP GET panels for bootstrap and poll fallback.

---

## 10. MQTT publication (PxH → bus)

With `topic_root=paradox` (default) and machine `id`:

| Topic | Retained | Content |
|-------|----------|---------|
| `paradox/<id>/system/health` | yes | Metrics snapshot |
| `paradox/<id>/system/disk` | yes | diskRoot + level |
| `paradox/<id>/system/services` | yes | Unit states summary |
| `paradox/<id>/system/alerts` | **no** | Threshold / service alerts (critical reaffirm while active) |

Do **not** overload suite app `/warnings` topics; PxH system alerts stay under `…/system/alerts`.
Broker is often local but must be configurable.

---

## 11. PxD landing integration

PxD starter `room.json` includes an optional **System Health** link (`/health/` or `:19090/ui/`).

---

## 12. Boundaries: PxP, pxp-agent, pi5-ssd

| Surface | Owner | Notes |
|---------|-------|-------|
| Host `/health/` beacon | **PxH** | This product |
| Fleet Machine Health / pairing / remote service control | **PxP + pxp-agent** | Both may start/stop services: PxH = local emergency; agent = managed remote |
| MQTT Explorer-style topic tree | **PxP MQTT Monitor** | Not PxH |
| pi5-ssd Hub + old health | Lab one-off | Relocate off `/health/` and `:19090` if colliding |

---

## 13. Acceptance criteria (MVP)

1. `paradox-health` active on Agent22-class install.  
2. `/health/` **or** `:19090/ui/` shows non-null disk metrics with threshold colors.  
3. Disk warn → MQTT `…/system/alerts` within one publish interval.  
4. Configured required services show running/stopped/failed.  
5. System Warnings panel shows live `/warnings` traffic from configured patterns.  
6. IDE prune dry-run works; execute gated by session.  
7. PxD starter docs/example include System Health link.  
8. Theme day/night/auto + toggle.

---

## 14. Explicitly deferred

Premium IM push, remote summary portal, game JSONL UX, snapshots, people-count audit, daily owner
reports — see [BUSINESS-OVERVIEW.html](BUSINESS-OVERVIEW.html) and [pending/INDEX.md](pending/INDEX.md).

---

## 15. Related references

- API: [API.md](API.md)  
- Install: [INSTALL.md](INSTALL.md) · [QUICK-SETUP.md](QUICK-SETUP.md)  
- Example config: [../config/pxh.example.ini](../config/pxh.example.ini)  
- Sudoers: [../config/sudoers.paradox-health](../config/sudoers.paradox-health)

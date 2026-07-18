# Paradox Health Monitor (PxH) — Functional Specification

_Status: draft (documentation iteration — implementation deferred)_  
_Last updated: 2026-07-18_  
_Product:_ **Paradox Health Monitor** (**PxH**)

> Former **Paradox Hub** is now **Paradox Prime (PxP)**. This repo’s **PxH** means Health Monitor only.

**Related:** [API.md](API.md) · [pending plans](pending/INDEX.md) · [business overview](BUSINESS-OVERVIEW.html)

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
5. Offer gated maintenance: apt/npm clean, **IDE remote-server prune**, optional service restart.

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
                    │  HTTP API (:19090 default)           │
                    │  optional: serve UI itself           │
                    └────────────┬─────────────────────────┘
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
    LAN :19090/ui          nginx /health/         MQTT broker
    (fallback path)        + /health-api/         pub: …/system/*
                           (preferred)            sub: warnings, props, …
```

| Path | Role |
|------|------|
| App | `/opt/paradox/apps/PxH/` |
| Config | `/opt/paradox/config/pxh.ini` (name conventional, not mandatory) |
| Unit | `paradox-health.service` |
| Operator UI URL | Prefer `http://<host>/health/` via nginx; **always** also reachable at `http://<host>:19090/ui/` so health remains visible if nginx is down |

---

## 4. Configuration (`pxh.ini`)

Single INI drives machine id, thresholds, service lists, MQTT pub/sub, UI panels, themes, history
limits. Full sample: [config/pxh.example.ini](../config/pxh.example.ini).

Key sections (summary):

| Section | Purpose |
|---------|---------|
| `[server]` | bind host/port, `serve_ui`, optional `lan_bind` for fallback |
| `[machine]` | `id` (MQTT `<id>`), display hostname |
| `[thresholds]` | disk warn/critical % and free-GB floors |
| `[services]` | required / optional / user-defined systemd units to probe |
| `[mqtt]` | broker, publish interval, topic base |
| `[warnings]` | topic patterns, colors, history limits → **System Warnings** panel |
| `[journal]` | enable, unit filters, history, severity colors |
| `[props]` | announce topic(s) (default `paradox/props`), history |
| `[ui]` | theme `day` / `night` / `auto`, refresh interval |
| `[actions]` | gate upgrade/reboot/service/cleanup/prune |
| `[prune]` | IDE prune schedule / low-disk trigger |

---

## 5. Disk space monitoring _(MVP — in scope)_

Motivated by Agent22 2026-07-17 (root FS 100%: IDE caches + apt/npm on small card → PxO `ENOSPC`).

| ID | Requirement |
|----|-------------|
| D1 | Continuously report root usage (`diskRoot`: total/used/available GB + usedPercent) in API, UI, MQTT — never silently `null` when `/` is readable |
| D2 | Thresholds default **warn ≥ 85%**, **critical ≥ 95%**, optional free-GB floors |
| D3 | MQTT alert on threshold cross + periodic reaffirm while critical; retained disk snapshot |
| D4 | UI disk card with good/warn/critical bands |
| D5 | Optional read-only “top consumers” listing (IDE caches, apt, npm, `/opt/paradox/logs`) |
| D6 | Gated cleanup: `apt-get clean`, `npm cache clean`, IDE prune (§6) — never auto-delete media/room configs |
| D7 | Document store-Pi policy: prune IDE leftovers; prefer ≥32 GB where practical |

**Suite companion (not PxH-only):** apps that log under `/opt/paradox/logs` must enforce retention.
Today only PFx/PxO do partial startup cleanup; Pio/PxT/PxB/PxP-Agent/etc. can grow unbounded —
see [pending/02-suite-log-retention.md](pending/02-suite-log-retention.md).

---

## 6. IDE remote-server prune _(MVP maintenance)_

| Scan | Pattern |
|------|---------|
| Cursor | `~/.cursor-server/bin/linux-arm64/*` |
| VS Code | `~/.vscode-server/cli/servers/Stable-*` (+ orphaned `code-*`, CachedExtensionVSIXs, reset `lru.json`) |

Rules: keep builds referenced by live processes; delete others; dry-run required; ~300–550 MB per
stale build; run as `paradox`; never touch `/opt/paradox` media/apps/configs.

| ID | Requirement |
|----|-------------|
| P1 | UI action + optional systemd timer / low-disk trigger |
| P2 | Default weekly **or** when disk ≥ warn |
| P3–P5 | Dry-run, bytes reclaimed report, MQTT/log result |

Detail: [pending/01-disk-and-ide-prune.md](pending/01-disk-and-ide-prune.md).

---

## 7. Service / process health

PxH probes **systemd** (and optionally process heuristics) for units listed in config — per machine,
so installs that omit PxB/PxT simply omit those units.

| Tier | Examples | Behavior |
|------|----------|----------|
| **Required** | `mosquitto`, `nginx`, room Paradox units (`pfx`, `pxo`, …) | Failed/inactive → UI critical + optional MQTT alert |
| **Optional** | `paradox-health` self, extras | Shown but soft |
| **User-defined** | Operator-added unit names in `pxh.ini` | Same three-state model |

**States (MVP):** `running` | `stopped` | `failed` | `unknown`  
(“Running with errors” = `failed` or active-but-degraded when detectable, e.g. systemd `failed`
result / restart rate-limit — do not invent deep app health checks; that stays in each app / PxP.)

Plan: [pending/03-service-health.md](pending/03-service-health.md).

---

## 8. How the UI is served (nginx vs self)

**Decision (proposed):**

1. **Primary:** nginx proxies `/health-api/` → `127.0.0.1:19090` and aliases `/health/` → static UI
   (or proxies `/health/` → PxH `/ui/`).
2. **Always-on fallback:** PxH binds API+UI on `:19090` (configurable). Operators bookmark
   `http://<host>:19090/ui/` for when nginx itself is the patient.
3. **Do not** dynamically “take over” port 80 if nginx dies — fighting for privileged ports as
   `paradox` is fragile and unsafe. Detection of “nginx down /health broken” → highlight in UI
   (when reached via :19090) and MQTT alert; optional Tailscale-only LAN bind.

Plan: [pending/04-serve-path-and-fallback.md](pending/04-serve-path-and-fallback.md).

---

## 9. System Health UI

### 9.1 Metrics cards

Host, uptime, CPU, temp, GPU mem, RAM, **disk**, apt updates, service summary strip.

### 9.2 System Warnings (MQTT)

Config-driven list of topic **patterns** (MQTT shared subscription / client wildcards). Each rule
has a **color key** (app family). Messages append to a ring buffer shown in a text panel.

**Default history:** last **200** lines **or** **24 hours**, whichever limit hits first
(`warnings.history_lines=200`, `warnings.history_hours=24`) — operator-overridable in `pxh.ini`.

Sample color keys (day/night CSS pairs — see §9.5): PFx/PFxE, PxO, Pio, PxB, PxT, game
(`paradox/<room>/+/warnings`), default.

### 9.3 Journal Messages

**Separate panel — yes (proposed).** Source: `journalctl` for configured units (or `_SYSTEMD_UNIT`
match list). Color by **severity** (emerg/alert/crit/err / warning / notice/info/debug) with fixed
CSS — not per-app colors (severity is the useful axis for journals). Same history knobs default
**100 lines / 6 hours**.

### 9.4 Prop appearances

Optional panel subscribed to `paradox/props` (and extras). Shows one-shot announce/arrival payloads.
History default **50** lines / **7 days** (props appear rarely).

### 9.5 Themes

`ui.theme = day | night | auto` (auto = `prefers-color-scheme`) **plus** a header toggle.
- Day: light/white background  
- Night: dark grey background  
Semantic colors (e.g. “red”) map to **dark-red on day** / **light-red on night** for contrast.

Plan: [pending/05-ui-panels-and-themes.md](pending/05-ui-panels-and-themes.md).

---

## 10. MQTT publication (PxH → bus)

| Topic | Retained | Content |
|-------|----------|---------|
| `paradox/<id>/system/health` | yes | Metrics snapshot |
| `paradox/<id>/system/disk` | yes | diskRoot + level |
| `paradox/<id>/system/services` | yes | Unit states summary |
| `paradox/<id>/system/alerts` | no* | Threshold / service alerts |

\* Last critical alert may be retained — open. Do **not** overload suite app `/warnings` topics;
PxH system alerts stay under `…/system/alerts`.

---

## 11. PxD landing integration

PxD landing / `room.json` should include an optional **System Health** link (path `/health/` or
absolute `:19090/ui/`). Document in starter `room.json` as a commented or clearly optional entry
operators can disable if PxH is absent.

Plan: [pending/07-pxd-landing-link.md](pending/07-pxd-landing-link.md).

---

## 12. Boundaries: PxP, pxp-agent, pi5-ssd

| Surface | Owner | Notes |
|---------|-------|-------|
| Host `/health/` beacon | **PxH** | This product |
| Fleet Machine Health / pairing / remote service control | **PxP + pxp-agent** | Overlap in “service start/stop” — keep PxH local/LAN; PxP for multi-machine + auth |
| MQTT Explorer-style topic tree | **PxP MQTT Monitor** | Not PxH ([MQTT_MONITOR.md](../../PxP/docs/MQTT_MONITOR.md)) |
| pi5-ssd Hub + old health | Lab one-off | Relocate off `/health/` and `:19090` / avoid `…/system/*` if colliding |

Plans: [08-pxp-and-agent.md](pending/08-pxp-and-agent.md), [09-pi5-ssd-coexistence.md](pending/09-pi5-ssd-coexistence.md).

---

## 13. Acceptance criteria (MVP)

1. `paradox-health` active on Agent22-class install.  
2. `/health/` **or** `:19090/ui/` shows non-null disk metrics with threshold colors.  
3. Disk warn → MQTT `…/system/alerts` within one publish interval.  
4. Configured required services show running/stopped/failed.  
5. System Warnings panel shows live `/warnings` traffic from configured patterns.  
6. IDE prune dry-run works; execute gated.  
7. PxD starter docs/example include System Health link.  
8. Theme day/night/auto + toggle.

---

## 14. Explicitly deferred (tracked outside MVP)

Premium IM push, remote summary portal, game JSONL UX, snapshots, people-count audit, daily owner
reports / “PxP-Audit” daemon — opinions and plans in [BUSINESS-OVERVIEW.html](BUSINESS-OVERVIEW.html)
and [pending/INDEX.md](pending/INDEX.md).

---

## 15. Related references

- API: [API.md](API.md)  
- Example config: [../config/pxh.example.ini](../config/pxh.example.ini)  
- Suite MQTT contract: `../../.github/copilot-instructions.md` (`…/warnings` plural)  
- PxP-Agent: `../../PxP-Agent/docs/SPEC.md`  
- PxO gameplay JSONL: `../../PxO/docs/SPEC.md` (Gameplay Analytics)

# Business overview — host health vs premium ops

_Opinions for review. Last updated: 2026-07-22._

**Implementation snapshot:** PxH **MVP is shipped in code** (see [SPEC.md](SPEC.md), status _MVP_,
2026-07-19). Plans **01, 03, 04, 05, 07** are implemented; **08** is partly documented; suite-wide
and premium items remain backlog.

Links are relative to `apps/PxH/docs/` so they work from any machine that keeps the standard
`…/paradox/apps/…` and `…/paradox/rooms/…` layout.

**Also:** styled HTML version — [BUSINESS-OVERVIEW.html](BUSINESS-OVERVIEW.html).

---

## Bottom line

Ship a focused **PxH** on every room Pi (disk, services, curated warnings, nginx+:19090 fallback).
Keep exploration, fleet control, game history UX, IM push, and audit reports in **PxP** (mostly paid).
Do not grow PxH into a second Hub.

Later: UPS telemetry in PxH; TV/monitor control primarily in PFx (PxH only if no PFx). Power
switching for loads uses existing WiZ/Shelly (etc.), not UPS outlet APIs first.

---

## 1. Product lanes

| Lane | Job | Monetize? |
|------|-----|-----------|
| [PxH — Health Monitor](SPEC.md) | Always-on host beacon: disk, systemd, System Warnings/Journal/Props, IDE prune; later UPS telemetry; optional display only when PFx is absent | Open / with suite (AGPL) — operational necessity |
| [PFx — media / screens](../../PFx/docs/SPEC.md) | Primary owner of TV/monitor power & HDMI presence when the machine runs media | Open runtime |
| [PxP-Agent](../../PxP-Agent/docs/SPEC.md) | Authenticated remote management for Prime | Open agent, enables paid Prime |
| [PxP MQTT Monitor](../../PxP/docs/MQTT_MONITOR.md) | MQTT Explorer–style topic tree for techs | Prime convenience (diagnose) |
| PxP Operate → Machine Health | Fleet view via agent | Prime |
| Game JSONL / history / audit / IM | Run records, owner reports, off-site notify | Data free on disk; _UX + AI + push_ = paid Prime |

---

## 2. Opinions (by topic) — with implementation status

Status key: **Done** = MVP acceptance met in repo; **Partial** = started or documented only;
**Not started** = deferred / backlog.

### Disk + IDE prune — **Done**

Do this in PxH first (P0). The Agent22 outage is enough justification.

**Shipped:** root disk metrics with warn/critical thresholds; top consumers in UI;
IDE remote-server prune (Cursor + VS Code) with dry-run, session-gated execute, auto schedule
(`weekly` / `low_disk` / `manual_only`); MQTT prune result on `…/system/alerts`.

Plan: [01-disk-and-ide-prune.md](pending/01-disk-and-ide-prune.md).

### App log retention — **Not started** (suite)

PxH cannot fix ENOSPC alone if PxO/Pio/PxT logs grow forever. Adopt a suite retention contract
(in-app keys + optional janitor timer for sparse installs).

Plan: [02-suite-log-retention.md](pending/02-suite-log-retention.md).

### Service monitoring — **Done**

Config-listed systemd units only (required / optional / user). Three-ish states are enough;
do not duplicate per-app deep health.

**Shipped:** `running` / `stopped` / `failed` / `unknown`; boot `enabled` / `disabled` / …;
session-gated Start/Stop, Restart, Enable/Disable; refusal to stop/disable `paradox-health`;
MQTT service summary + required-unit alerts.

Plan: [03-service-health.md](pending/03-service-health.md).

### nginx vs own server — **Done**

**Both:** nginx for nice URLs; PxH always on `:19090/ui` as fallback. Do not hijack port 80 when
nginx dies.

**Shipped:** Fastify on `:19090`; `GET /reachability/nginx-health` + degraded UI banner;
[nginx-health.example.conf](../config/nginx-health.example.conf); [INSTALL.md](INSTALL.md).

Plan: [04-serve-path-and-fallback.md](pending/04-serve-path-and-fallback.md).

### Warnings / journal / props / themes — **Done**

Yes to all three panels. Warnings colored by app (ini); journal by severity; props on
`paradox/props`. Defaults 200/24h, 100/6h, 50/7d. Day/night/auto + toggle.

**Shipped:** MQTT subscribe → ring buffers; HTTP panel endpoints; WebSocket live channels;
static UI with theme toggle (`localStorage`); semantic warning colors from ini.

Plan: [05-ui-panels-and-themes.md](pending/05-ui-panels-and-themes.md) · sample
[pxh.example.ini](../config/pxh.example.ini).

### MQTT spelling / props — **Not started** (suite)

Canonical `/warnings` is healthy. Fix ESP32 `site/props`, SpyCatcher heartbeat-on-props, and PxB
`pzb/` docs.

Plan: [06-mqtt-contract-drifts.md](pending/06-mqtt-contract-drifts.md).

### PxD landing — **Done**

Optional System Health link in example `room.json` is enough.

**Shipped:** `_starter/room.json` includes active `system-health` external site; [ROOMS.md](../../PxD/docs/ROOMS.md)
documents `/health/` vs `:19090/ui/` fallback.

Plan: [07-pxd-landing-link.md](pending/07-pxd-landing-link.md).

### PxP / Agent overlap — **Partial**

Keep local PxH actions and remote agent actions; document lanes; avoid dual disk-alert spam.

**Shipped:** [SPEC.md](SPEC.md) §12; [PxP MQTT_MONITOR.md](../../PxP/docs/MQTT_MONITOR.md);
[PARADOX_HEALTH_MONITOR.md](../../PxP/docs/PARADOX_HEALTH_MONITOR.md) pointer.

**Remaining:** PxP Operate affordance — “Open System Health” per machine card (plan 08 deliverable).

Plan: [08-pxp-and-agent.md](pending/08-pxp-and-agent.md).

### pi5-ssd Hub — **Not started** (lab)

Move the one-off off PxH defaults — do not special-case product for the lab Hub.

Plan: [09-pi5-ssd-coexistence.md](pending/09-pi5-ssd-coexistence.md).

### Telegram / WhatsApp / remote webpage — **Not started** (Prime)

**Paid PxP** (or a small always-on companion), not PxH. Tokens do not belong on every store Pi.

Plan: [10-premium-notify-and-remote.md](pending/10-premium-notify-and-remote.md).

### Gameplay JSONL & history — **Not started** (Prime / PxO)

PxO already writes useful JSONL — extend with game counter + hint source + dedup. Browsing /
reporting / AI EDN edits = Prime features; raw files stay readable without Prime.

Plan: [11-gameplay-jsonl-history.md](pending/11-gameplay-jsonl-history.md) ·
[PxO SPEC](../../PxO/docs/SPEC.md).

### Snapshots, people-count, daily audit — **Not started** (Prime)

Valuable owner features; park behind paid Prime. Prefer on-demand reports before inventing
`PxP-Audit`. Sidecar JSON next to images for one-time AI results.

Plan: [12-snapshots-and-audit.md](pending/12-snapshots-and-audit.md).

### TV / monitor control & reporting — **Not started** (backlog)

**One controller per machine.** Prefer **PFx** when HDMI/media zones exist (already owns the display
path). Optional thin implementation in **PxH** only on hosts without PFx (ops Pi, status screen).
Shared MQTT contract later (e.g. `paradox/<id>/display/…`); ini comments must say “disable if PFx
is installed.” Do not run both. Spec/plans deferred until we green-light implementation.

Business: strong demo / “room wakes for show” story; day-to-day use is medium on media machines.
Worth doing in PFx first; PxH fallback only if effort stays small.

### UPS monitoring (and power switching) — **Not started** (backlog)

**PxH owns UPS telemetry** (on AC / on battery, capacity, estimated runtime, load) — same family as
disk and host survival. Prefer NUT (or similar) rather than vendor-specific USB stacks. MQTT +
System Health card + low-battery / on-battery alerts.

**Outlet / load switching:** do _not_ depend on UPS switched-outlet groups for MVP. Use **existing
smart switches** (WiZ, Shelly, etc. via PxB / already-built control) configured in the room. Native
UPS outlet control may be listed as a _future_ option only. Soft shutdown / service stop on critical
battery is more valuable than flipping UPS outlets.

Business: infrequent day-to-day use, high trust when power fails; good “production venue” sell signal
for modest effort. Worth a PxH backlog slice after core health MVP.

### Also shipped (beyond original business doc)

| Area | Status |
|------|--------|
| PAM login + signed session cookies for actions | **Done** |
| WebSocket `/ws` (metrics, services, panels, action progress) | **Done** |
| MQTT publish `…/system/{health,disk,services,alerts}` | **Done** |
| Gated actions: apt cleanup, upgrade, reboot, IDE prune | **Done** |
| `scripts/install.sh`, systemd unit, sudoers template | **Done** |
| Unit tests (config, disk thresholds, sessions, ring buffer) | **Partial** — no live integration tests |

---

## 3. Implementation order (original plan vs today)

| Phase | Original intent | Today |
|-------|-----------------|-------|
| PxH P0 | 01 → 03 → 04 (disk / services / serve) | **Done** in repo |
| Suite P0 | 02 log retention | **Not started** |
| PxH P1 | 05 UI panels; 07 PxD link; 08 boundaries | **05, 07 done**; **08 partial** |
| Hygiene | 06 MQTT drifts; 09 lab coexistence | **Not started** |
| Prime roadmap | 11 → 10 → 12 | **Not started** (by design) |
| Later / backlog | PFx display; PxH UPS; WiZ/Shelly loads | **Not started** |

---

## 4. Where to store cross-repo ideas

**Recommendation:** Own the plan in the _implementing_ app’s `docs/pending/` (PxO for JSONL, PxP for
premium notify/audit, PxH for host health). Keep a short stub + link in
[pending/INDEX.md](pending/INDEX.md) while ideas are being triaged together.

A suite-root `paradox/docs/pending/` index is nice later if the workspace itself becomes a versioned
meta-repo; until then, owner-app pending + this index is enough.

---

## 5. Key document map

- [PxH SPEC](SPEC.md) · [PxH API](API.md) · [Pending plans](pending/INDEX.md)
- [PxP MQTT Monitor](../../PxP/docs/MQTT_MONITOR.md) · [PxP pointer to PxH](../../PxP/docs/PARADOX_HEALTH_MONITOR.md)
- [PxP-Agent SPEC](../../PxP-Agent/docs/SPEC.md)
- [PxO SPEC](../../PxO/docs/SPEC.md) (gameplay JSONL)
- [Suite overview](../../../.github/copilot-instructions.md)

---

## 6. Remaining features — business-prioritized

Ordered for **venue reliability and operator trust first**, then integration hygiene, then demo /
upsell. Effort is qualitative (S / M / L).

| Rank | Feature | Owner | Why (business) | Effort | Depends on |
|------|---------|-------|----------------|--------|------------|
| **1** | **Suite log retention** (plan 02) | Suite (PxO, Pio, PxT, …) | ENOSPC is the #1 production killer; IDE prune alone does not cap app log growth | M | Agreement on retention keys + optional janitor |
| **2** | **Fleet PxH rollout** — install + nginx on every room Pi | Ops / PxH | MVP code exists but value is zero until all hosts beacon; reduces “mystery outage” support | S–M | Per-host `pxh.ini`, nginx merge |
| **3** | **MQTT contract hygiene** (plan 06) | Props / rooms / PxB | Wrong topic spelling breaks props panel and cross-app debugging; cheap trust win | S | Room firmware / SpyCatcher / PxB doc fixes |
| **4** | **PxP → “Open System Health”** (plan 08 remainder) | PxP | Prime operators should one-click to host UI without remembering URLs | S | Machine hostname / Tailscale name in PxP |
| **5** | **UPS telemetry + alerts** | PxH (+ NUT) | Power-fail visibility is a strong “professional venue” signal; complements disk alerts | M | NUT on supported UPS hardware |
| **6** | **Critical-battery playbook** — soft shutdown / service stop (not UPS outlets) | PxH + room config | Protects SD/database integrity; more valuable than switched outlets | M | #5; WiZ/Shelly scene hooks optional |
| **7** | **PFx display / TV contract** | PFx (PxH fallback only) | “Room wakes for show” demo; daily use on media machines | M–L | PFx HDMI path; shared MQTT topic design |
| **8** | **pi5-ssd lab coexistence** (plan 09) | Lab / install | Prevents port/path collisions during dev; not customer-facing | S | Lab host only |
| **9** | **Integration / field tests** for PxH | PxH | Reduces regression risk as suite grows; supports confident rollout | M | CI or Pi test harness |
| **10** | **Gameplay JSONL richness + history UX** (plan 11) | PxO → PxP Prime | Owner reports and hint analytics — **paid** differentiator | L | PxO schema extensions |
| **11** | **IM push + remote summary** (plan 10) | PxP Prime | Off-site notify for owners; tokens stay off store Pis | M | Prime backend |
| **12** | **Snapshots, people-count, daily audit** (plan 12) | PxO / PxP / go2rtc | Premium owner features; on-demand before batch jobs | L | Camera pipeline, AI sidecars |

### Explicitly lower priority (do not pull ahead of #1–6)

- **PxH-only display fallback** — only if PFx is absent and effort stays small.
- **Native UPS switched-outlet control** — future option; prefer WiZ/Shelly via PxB.
- **Second Hub features in PxH** — fleet orchestration, MQTT explorer, game history belong in PxP.

### Suggested next execution slice

1. **02** in parallel with **rollout (#2)** on production Pis.
2. **06** + **08 remainder** as quick integration wins.
3. **05 UPS** when a venue UPS + NUT path is confirmed.
4. Prime items **10–12** only after host health is boringly reliable everywhere.

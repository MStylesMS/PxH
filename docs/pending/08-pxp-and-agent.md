# Plan 08 — PxH ↔ PxP ↔ PxP-Agent boundaries

**Owner:** PxP / PxP-Agent / PxH · **Priority:** P1 · **Status:** pending review

## Separation

| Concern | Product |
|---------|---------|
| Host beacon, disk, local warnings panels | **PxH** |
| Pairing, remote service control, fleet Machine Health | **PxP + pxp-agent** |
| MQTT topic explorer | **PxP MQTT Monitor** |

## Conflicts / overlooked issues

1. **Duplicate service start/stop** — both PxH (local LAN) and pxp-agent (authenticated remote).
   *Proposal:* keep both; document “local emergency vs managed remote”; same allowlists from
   machine manifest / `pxh.ini` where possible.
2. **Two “health” UIs in PxP naming** — Operate → Machine Health vs host System Health.
   *Proposal:* PxP copy links out to `http://<machine>/health/` when known; never embed full PxH.
3. **MQTT alert dual-publish** — pxp-agent optional MQTT vs PxH `…/system/*`.
   *Proposal:* PxH owns host disk/service alerts; agent owns agent telemetry; do not both spam
   identical disk alerts.
4. **Auth** — PxH is LAN-trust today; agent is secret+TLS. Do not weaken agent by exposing its
   secret on PxH page.
5. **Install path** — agent may deploy under `/opt/paradox/apps/`; PxH same tree — fine.

## Deliverables after approval

- Short boundary section in PxP `PXP_AGENT.md` + PxH SPEC (done in SPEC §12)
- Optional PxP UI affordance: “Open System Health” per machine card

## Non-goals

Merging PxH into pxp-agent; replacing agent with PxH.

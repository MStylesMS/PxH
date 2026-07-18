# Plan 03 — systemd service health (PxH)

**Owner:** PxH · **Priority:** P0 · **Status:** pending review

## Goal

Show running / stopped / failed / unknown for Paradox units, system deps (mosquitto, nginx), and
optional user-defined units from `pxh.ini` — only those installed on this host.

## Design

- `[services] required=…`, `optional=…`, `user=…` (comma-separated unit names)
- Probe via `systemctl is-active` / `show` (MainPID, Result)
- Publish retained `paradox/<id>/system/services`
- Required + failed → UI critical + optional MQTT alert (edge-triggered)
- Do **not** parse each app’s MQTT heartbeats for MVP (optional later)

## Acceptance

- Missing unit name → `unknown`, not crash
- Agent22-style host with subset of apps works by editing ini only
- UI service strip matches `/services` API

## Out of scope

Deep “degraded but active” app logic; PxP remote control UX.

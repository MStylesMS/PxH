# Plan 01 — Disk monitoring & IDE prune (PxH)

**Owner:** PxH · **Priority:** P0 · **Status:** pending review  
**Docs:** [SPEC §5–6](../SPEC.md) · [API actions](../API.md)

## Goal

Reliable root disk metrics in API/UI/MQTT; gated IDE remote-server prune + safe cleanup so store
Pis do not silently hit ENOSPC (Agent22 incident).

## In scope

- Implement/verify `diskRoot` never null when `/` readable; thresholds; MQTT disk + alerts
- UI disk card bands; optional top-consumers listing
- `POST /actions/prune-ide` with dry-run; keep live Cursor/VS Code builds; weekly or low-disk
- `POST /actions/cleanup` for apt/npm (no media/config deletes)

## Out of scope

- Suite-wide app log rotation (→ [02](02-suite-log-retention.md))
- nginx fallback (→ [04](04-serve-path-and-fallback.md))

## Acceptance

1. Metrics show used%/free GB; warn/critical match `pxh.ini`
2. Crossing warn publishes `…/system/alerts` within one interval
3. Dry-run lists builds to delete/keep; execute only with confirm; reports bytes reclaimed
4. No deletes under `/opt/paradox` media, rooms, or app trees

## Agent notes

- Prefer `systeminformation` + `df` fallback; do not revive broken awk from prototype
- Run prune as `paradox` user; SPEC scan paths under `/home/paradox`

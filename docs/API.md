# Paradox Health Monitor — HTTP API

**Base URL (direct):** `http://127.0.0.1:19090`  
**Via nginx (operators):** `http://<host>/health-api/`

Bound primarily to localhost; nginx proxies `/health-api/` to the service.  
Static System Health UI is served separately at `/health/` (not by this API process by default;
dev mode may serve `public/`).

Functional context: [SPEC.md](SPEC.md).

---

## 1. Health and metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` or `/health` | Liveness `{ status: "ok", version }`. |
| `GET` | `/metrics` | Host snapshot: hostname, timestamp, uptime, CPU load, temps, RAM, **diskRoot**, apt updates, sudo flag. |
| `GET` | `/runtime` | Paradox runtime service/process summary (MQTT broker, PFx/PxO/… as configured). |

### `diskRoot` object (required for MVP)

```json
{
  "totalGb": 14.5,
  "usedGb": 12.1,
  "availableGb": 2.4,
  "usedPercent": 83.4
}
```

Must not be `null` when `/` is mounted and readable.

### Threshold coloring (UI / alerts)

Defaults from `pxh.ini` `[thresholds]`: warn ≥ 85% used, critical ≥ 95% used (or free-GB floors).

---

## 2. Actions

All mutating actions should be gated (local network / future auth) and confirmation in the UI.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/actions/upgrade` | optional | `apt-get update` + upgrade (sudo). |
| `POST` | `/actions/restart` | `{ "confirm": true }` | Reboot host after short delay. |
| `POST` | `/actions/service` | `{ "name", "action": "start"\|"stop"\|"restart" }` | Control allowlisted services. |
| `POST` | `/actions/cleanup` | `{ "targets": ["apt","npm","ide"], "confirm": true, "dryRun"?: true }` | Safe cache cleanup (SPEC §7.1). |
| `POST` | `/actions/prune-ide` | `{ "confirm": true, "dryRun"?: true }` | IDE remote-server prune (SPEC §7.2). |

Action responses include `{ ok, message?, bytesReclaimed?, kept?, deleted? }` as applicable.

---

## 3. MQTT topics (publisher)

Configured under `[mqtt]` in `pxh.ini`. Soft-fail and retry if broker down.

| Topic | Retained | Payload |
|-------|----------|---------|
| `paradox/<id>/system/health` | yes | Full metrics snapshot JSON |
| `paradox/<id>/system/disk` | yes | `diskRoot` + threshold level |
| `paradox/<id>/system/alerts` | no (or last alert retained — TBD) | `{ level, type, message, …, ts }` |

`<id>` = `machine_id` from config (room slug or hostname).

---

## 4. Errors

| Code | Typical cause |
|------|----------------|
| 400 | Missing `confirm` / invalid body |
| 403 | Action not permitted (no sudo / not allowlisted) |
| 404 | Unknown service name |
| 500 | Collection or action failure |
| 503 | Dependency unavailable (optional) |

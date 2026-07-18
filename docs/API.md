# Paradox Health Monitor — HTTP / MQTT API

_Status: draft (docs iteration)_ · See [SPEC.md](SPEC.md)

**Direct (always):** `http://<host>:19090` (default; configurable)  
**Via nginx (preferred):** `http://<host>/health-api/` → API; `http://<host>/health/` → UI  

UI also at `http://<host>:19090/ui/` when `serve_ui=true` (fallback if nginx is down).

---

## 1. Liveness and metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` or `/health` | `{ status, version, name }` |
| `GET` | `/metrics` | Host snapshot including **diskRoot**, temps, RAM, load, apt, `diskLevel` |
| `GET` | `/services` | Configured systemd units with `state`: `running`\|`stopped`\|`failed`\|`unknown` |
| `GET` | `/runtime` | Alias or superset of `/services` for prototype compatibility |

### `diskRoot` (required when `/` readable)

```json
{ "totalGb": 14.5, "usedGb": 12.1, "availableGb": 2.4, "usedPercent": 83.4 }
```

`diskLevel`: `ok` | `warn` | `critical` from `[thresholds]`.

---

## 2. UI data feeds (ring buffers)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/panels/warnings` | Recent MQTT warning lines (`lines`, `since` query) |
| `GET` | `/panels/journal` | Recent journal lines for configured units |
| `GET` | `/panels/props` | Recent `paradox/props` (etc.) announce messages |
| `GET` | `/panels/meta` | Active theme recommendation, history limits, color map |

WebSocket (optional MVP+): `WS /ws` subscribe to `warnings` | `journal` | `props` | `metrics`.

Each warning line shape:

```json
{
  "ts": "2026-07-18T15:01:02Z",
  "topic": "paradox/agent22/pfx/warnings",
  "colorKey": "pfx",
  "payload": { }
}
```

---

## 3. Actions

Gated by `[actions]` in config; destructive bodies need `"confirm": true`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/actions/upgrade` | — | apt update/upgrade |
| `POST` | `/actions/restart` | `{ "confirm": true }` | Host reboot (delayed) |
| `POST` | `/actions/service` | `{ "name", "action" }` | start/stop/restart allowlisted unit |
| `POST` | `/actions/cleanup` | `{ "targets", "confirm", "dryRun?" }` | apt/npm/ide clean |
| `POST` | `/actions/prune-ide` | `{ "confirm", "dryRun?" }` | IDE server prune (SPEC §6) |
| `GET` | `/actions/prune-ide/preview` | — | Dry-run inventory without POST |

---

## 4. MQTT — publish (PxH → broker)

| Topic | Retained | Payload |
|-------|----------|---------|
| `paradox/<id>/system/health` | yes | metrics snapshot |
| `paradox/<id>/system/disk` | yes | diskRoot + level |
| `paradox/<id>/system/services` | yes | services array |
| `paradox/<id>/system/alerts` | usually no | `{ level, type, message, …, ts }` |

`<id>` from `[machine] id`. Soft-fail if broker down.

---

## 5. MQTT — subscribe (broker → PxH panels)

Configured in `[warnings]`, `[props]` (and optionally game wildcards). Canonical suite suffix is
**`/warnings` (plural)** — see suite MQTT contract.

Default patterns (example ini):

- `paradox/+/pfx/warnings`, `paradox/+/pfxe/warnings` → color `pfx`
- `paradox/+/pxo/warnings` → `pxo`
- `paradox/+/pio/warnings` or configured pio topic → `pio`
- `paradox/+/pxb/warnings`, `paradox/+/pxb/+/warnings` → `pxb`
- `paradox/+/pxt/warnings` → `pxt`
- `paradox/+/+/warnings` (game / catch-all) → `game` (lower priority than specific rules)
- `paradox/props` → props panel (not warnings)

---

## 6. History defaults

| Panel | Default lines | Default hours | Config keys |
|-------|---------------|---------------|-------------|
| Warnings | 200 | 24 | `warnings.history_lines`, `warnings.history_hours` |
| Journal | 100 | 6 | `journal.history_lines`, `journal.history_hours` |
| Props | 50 | 168 (7d) | `props.history_lines`, `props.history_hours` |

Evict by whichever limit is hit first.

---

## 7. Errors

| Code | Cause |
|------|--------|
| 400 | Missing confirm / bad body |
| 403 | Action disabled or unit not allowlisted |
| 404 | Unknown service |
| 500 | Collection/action failure |
| 503 | Optional dependency (e.g. journalctl unavailable) |

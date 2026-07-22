# Plan 06 — MQTT contract drifts (props / rooms / PxB)

**Owner:** props + rooms + PxB docs · **Priority:** P1 · **Status:** **done** (2026-07-22)

## Audit result (historical)

Canonical suite suffix is **`/warnings` (plural)** — no active `/warning` publishers found.

| Issue | Severity | Where | Resolution |
|-------|----------|--------|------------|
| ESP32 `px-wifi-v1` announce default **`site/props`** vs suite **`paradox/props`** | High | `props/esp32/px-wifi-v1` | Defaults + docs → `paradox/props`; base → `paradox/room/device` |
| SpyCatcher PFx `heartbeat_topic = paradox/props` | High | `rooms/spycatcher/config/pfx-moscow.ini` | → `paradox/heartbeat` |
| PxB secondary docs still said **`pzb/`** while code uses **`pxb/`** | Medium | PxB SPEC/QUICK_START/CONFIG/AI overview | Docs → `pxb/` (archive left historical) |
| PxD / room `warningTopics` missing `paradox/+/system/alerts` | Low | SpyCatcher + some legacy room.json; PxD JS fallback | Added alerts wildcard |

esp8266 props already used `paradox/props` + `/state`; docs clarified announce-once vs periodic state.

## Contract (locked)

| Role | Topic | Cadence |
|------|-------|---------|
| Prop **announce** | `paradox/props` (or `<company>/props` for third-party) | Once per MQTT connect/reconnect |
| Prop **state / heartbeat** | `paradox/<room>/<device>/state` (`{base}/state`) | Connect, on change, ~every 10s |
| App **warnings** | `…/warnings` (plural) | As needed |
| PxH host alerts | `paradox/<id>/system/alerts` | Subscribe via `paradox/+/system/alerts` |
| PxB bridge | `{base_topic}/pxb/{state,commands,warnings,discovered/…}` | Not `pzb/` |

## Acceptance

- [x] ESP32 default announce `paradox/props`
- [x] SpyCatcher PFx heartbeat not on `paradox/props`
- [x] No `pzb/` topic paths in active PxB docs
- [x] Room / starter warningTopics include `+/warnings` and `paradox/+/system/alerts` where applicable
- [x] Prop docs explain announce vs state schema

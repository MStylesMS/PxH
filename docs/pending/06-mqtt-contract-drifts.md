# Plan 06 — MQTT contract drifts (props / rooms / PxB)

**Owner:** props + rooms + PxB docs · **Priority:** P1 · **Status:** pending review

## Audit result

Canonical suite suffix is **`/warnings` (plural)** — no active `/warning` publishers found.

| Issue | Severity | Where |
|-------|----------|--------|
| ESP32 `px-wifi-v1` announce default **`site/props`** vs suite/PxP catalog **`paradox/props`** | High | `props/esp32/px-wifi-v1` |
| SpyCatcher PFx `heartbeat_topic = paradox/props` (should be heartbeat/devices, not prop announce) | High | `rooms/spycatcher/config/pfx-moscow.ini` |
| PxB secondary docs still say **`pzb/`** while code/API use **`pxb/`** | Medium | PxB SPEC/QUICK_START/CONFIG/AI overview |
| PxD starter `warningTopics` may omit `+/warnings` wildcards | Low | PxD templates |

esp8266 props already use `paradox/props` + `/warnings`.

## Goal

Align announce topic + fix heartbeat misuse + purge `pzb/` doc drift.

## Acceptance

- ESP32 default announce `paradox/props` (or documented migration + catalog match)
- SpyCatcher heartbeat not on `paradox/props`
- No `pzb/` in active PxB docs
- Note: Pio `paradox/devices` announce is intentional (different bus)

## Agent hand-off

Split PR: (A) esp32 firmware/docs, (B) spycatcher ini, (C) PxB docs-only.

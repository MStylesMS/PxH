# Plan 14 — UPS telemetry (PxH)

**Owner:** PxH · **Priority:** P1 (post-MVP backlog) · **Status:** draft (implementation in progress)
**Docs:** [BUSINESS-OVERVIEW § UPS](../BUSINESS-OVERVIEW.html#ups) · [SPEC §9–10](../SPEC.md) · [API](../API.md)
**Lab hardware (pi5-ssd):** Cyber Power / CPS S175UC, USB `0764:0501` → NUT `usbhid-ups`

## Goal

Show operators whether the room Pi is on wall power or battery, with **estimated runtime
(minutes)**, **battery %**, and enough context to trust an outage — in System Health, `/metrics`,
and MQTT — without vendor-specific USB stacks inside Node.

## Product decisions (locked from BUSINESS-OVERVIEW)

| Decision | Choice |
|----------|--------|
| Owner | PxH (same family as disk / host survival) |
| Transport | Prefer **NUT** (`upsc` / upsclient) over PowerPanel / vendor daemons |
| Vendors MVP | CyberPower (usbhid-ups), APC (usbhid-ups or `apcupsd-ups` bridge), generic NUT |
| Outlet / load switching | **Out of scope** — use WiZ/Shelly via PxB |
| Soft shutdown on critical battery | **Phase 2** (valuable; not required for tile MVP) |

## UI

1. **Remove** the `sudo` card from System Health metrics grid.
2. **Add** a `UPS` card immediately after `Updates`.
3. Card presentation:
   - **Value (primary):** estimated runtime — e.g. `42 min` (from `battery.runtime` seconds ÷ 60), or `n/a` if absent.
   - **Sub lines:** line 1 `Batt. {charge}% · {status}`; line 2 `Load {load}% · {watts} W` when known.
     Example:

     ```
     Batt. 100% · On AC
     Load 19% · 125 W
     ```

     Omit line-2 segments (or the whole second line) when load/watts are unknown.
   - **Watts:** use NUT `ups.realpower` when present; otherwise estimate `round(load% × ups.realpower.nominal / 100)` when both load and nominal are known (common on CyberPower HID).
   - **Color bands** (`ok` / `warn` / `critical`) from UPS level (see thresholds).
4. When no UPS / NUT unavailable: value `n/a`, sub `UPS not configured` (not an error banner).
5. Keep `sudoNopasswd` in `/metrics` for action gating if useful; just don’t show a tile.

Suggested status mapping (NUT `ups.status` tokens):

| Tokens | Display | Level |
|--------|---------|-------|
| `OL` (on line) | On AC | ok |
| `OB` (on battery) | On battery | warn (or critical if charge/runtime below critical) |
| `LB` (low battery) | Low battery | critical |
| `RB` | Replace battery | warn |
| `CHRG` | Charging | ok (annotate in sub) |
| no comms | No data | warn |

## Metrics / API shape

Extend `MetricsSnapshot` with `UpsInfo` (see `src/types.ts`).

`GET /metrics` includes `ups`. WebSocket `metrics` channel carries the same object.

## Backend strategy

**Primary path — NUT (generic):**

1. Host packages: `nut-client` (+ `nut-server` when this Pi owns the USB cable).
2. PxH reads via `upsc <name>@<host>` (default `ups@127.0.0.1`) or `upsclient` later.
3. Map NUT vars:

| NUT variable | Field |
|--------------|-------|
| `ups.status` | `status` / `statusRaw` |
| `battery.charge` | `batteryChargePercent` |
| `battery.runtime` | `runtimeSeconds` → `runtimeMinutes` |
| `ups.load` | `loadPercent` |
| `ups.realpower` | `realPowerWatts` (preferred) |
| `ups.realpower.nominal` | `realPowerNominalWatts`; also used to estimate watts when `ups.realpower` absent |
| `input.voltage` | `inputVoltage` |
| `battery.voltage` | `batteryVoltage` |
| `ups.model` / `device.model` | `model` |
| `ups.mfr` / `device.mfr` | `mfr` |

**Vendor notes:**

| Family | Typical NUT driver | Notes |
|--------|-------------------|-------|
| CyberPower USB HID (`0764:*`) | `usbhid-ups` | Lab S175UC / CP1500-class confirmed |
| APC USB | `usbhid-ups` (many) or quirks | Prefer NUT first |
| APC via apcupsd | NUT `apcupsd-ups` driver **or** PxH fallback parser for `apcaccess status` | Only if NUT native fails |
| Other NUT-supported | whatever HCL lists | “generic NUT” = same `upsc` path |

PxH must **not** open `/dev/hidraw*` itself — NUT owns the device.

## Config (`pxh.ini`)

See `[ups]` in `config/pxh.example.ini`.

## MQTT

| Topic | Retained | Payload |
|-------|----------|---------|
| `paradox/<id>/system/ups` | yes | `UpsInfo` |
| `paradox/<id>/system/health` | yes | full snapshot including `ups` |
| `paradox/<id>/system/alerts` | no | UPS events |

Alert `type` values: `ups_on_battery`, `ups_low_battery`, `ups_restored`, `ups_no_comms`, `ups_replace_battery`.

## Out of scope (this plan)

- UPS switched-outlet / load-segment APIs
- Vendor PowerPanel / CyberPower proprietary agents
- Fleet multi-UPS dashboards (PxP later)
- Automatic host shutdown (**Phase 2**)

## Acceptance

1. sudo card gone from System Health; UPS card sits after Updates.
2. With CyberPower USB + NUT configured on lab Pi: tile shows runtime minutes and two-line sub
   (`Batt. …% · On AC` then `Load …% · … W` when measurable or estimable).
3. Unplug AC (safe test): status → on battery within one poll; MQTT `ups_on_battery` alert fires; restore → `ups_restored`.
4. APC path documented: either NUT `usbhid-ups` or `apcupsd` + bridge; same `UpsInfo` shape.
5. No UPS / NUT down: `ups.present=false`, UI `n/a`, no false critical on host health.
6. Docs: SPEC §9 metrics cards, API.md metrics + MQTT, INSTALL/QUICK-SETUP NUT notes, INDEX.md plan 14.

## Implementation sketch

1. UI: drop sudo card; UPS card from `m.ups`.
2. `src/metrics/ups.ts` — collect via `upsc`; map status; compute level.
3. Wire into `collector.ts` → `MetricsSnapshot.ups`.
4. MQTT hub: publish `system/ups` + alert transitions.
5. `config/pxh.example.ini` `[ups]` + loadConfig.
6. Tests: parse fixtures of `upsc` output for OL/OB/LB; missing binary → `present:false`.

## Agent notes

- Do not revive vendor SDK; CLI `upsc` is enough for MVP.
- `battery.runtime` is seconds in NUT; display minutes.
- hidraw is root-only until NUT udev rules apply — fix via NUT packages, not chmod hacks in PxH.

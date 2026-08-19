# PR: HDMI display cards + metric-card tooltips

**Status:** Implemented  
**Created:** 2026-08-19  
**Scope:** PxH only (sensing; no sleep/wake buttons)

## Goal

System Health shows one card per HDMI connector on the host (typically HDMI-1 / HDMI-2), with connection/power in the value and make/model in the subtitle. Native hover tooltips on those cards and the existing metric cards.

## Sensing

Every metrics tick (cheap, no X11): `/sys/class/drm/*HDMI-A-*` (`status`, `enabled`, `dpms`, EDID blob). Include **disconnected** connectors.

Not every tick: `cec-client pow 0` (and optional DDC) cached ~90s so a CEC-asleep TV can show **Sleeping** while DRM still reports the link up. Collection never blocks on CEC.

Windows / no DRM: `displays: []`.

## Card mapping

| Condition | Value | Level |
|-----------|-------|-------|
| disconnected | Unplugged | warn |
| connected + CEC/DDC/DRM standby or off | Sleeping | ok |
| connected + on | Awake | ok |
| connected + unknown power | Connected | ok |

`.sub`: EDID make/model when connected, else `no sink`. Overflow (DRM name, CEC device, serial) in `title`.

Placement: after Updates, before UPS. Viewing stays unauthenticated.

## MQTT

`displays[]` rides on retained `…/system/health`. No dedicated `…/system/displays` topic in this pass.

## Tooltips

Extend `card(label, value, sub, cls, title)` with native `title=`. No JS tooltip library.

## Out of scope

Operator sleep/wake from `/health/`. Depending on PFx. Windows identity.

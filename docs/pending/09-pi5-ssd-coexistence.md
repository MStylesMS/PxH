# Plan 09 — pi5-ssd Hub coexistence with PxH

**Owner:** lab install (pi5-ssd) · **Priority:** P2 · **Status:** pending review

## Context

pi5-ssd Hub + Machine Health prototype are **dev one-offs**, not product. PxH must use default
`/health/`, `:19090`, and `paradox/<id>/system/*` on store machines. Lab may run both for testing.

## Goal

If URLs/ports/topics collide, **move the one-off**, not PxH.

## Proposed actions

1. Inventory pi5-ssd nginx locations and `health-api` port/unit names  
2. Relocate Hub health to e.g. `/hub-health/` and/or port `19091` and unit `pi5-health-api.service`  
3. Ensure Hub MQTT (if any) does not publish retained `…/system/health` under the same machine id  
4. Document “lab only” in Hub README  

## Acceptance

- Fresh PxH install on pi5-ssd can bind :19090 + `/health/` without fighting Hub  
- Hub still reachable under its new paths  

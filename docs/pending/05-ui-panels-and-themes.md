# Plan 05 — UI panels & themes (PxH)

**Owner:** PxH · **Priority:** P1 · **Status:** pending review  
**Config sample:** [pxh.example.ini](../../config/pxh.example.ini)

## Goal

System Health page with:

1. **System Warnings** — MQTT topic patterns + per-app color keys; history default 200 lines / 24h  
2. **Journal Messages** — separate panel; color by **severity** (fixed); default 100 / 6h  
3. **Prop appearances** — `paradox/props` (+ config); default 50 / 7d  
4. **Themes** — day (white) / night (dark grey) / auto + header toggle; semantic colors have
   day/night CSS pairs for contrast  

## Acceptance

- Rules in ini match traffic; first-match color wins  
- Theme toggle persists in `localStorage`; auto follows `prefers-color-scheme` until toggled  
- Panels do not unbounded-grow (ring buffer)

## Out of scope

Full MQTT Explorer tree (PxP MQTT Monitor).

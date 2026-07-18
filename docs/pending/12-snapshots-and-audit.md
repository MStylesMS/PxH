# Plan 12 — Snapshots, people-count, daily audit

**Owner:** PxO (trigger/files) · PxP (audit UX / cloud AI) · go2rtc · **Priority:** P3  
**Status:** pending review · **Not PxH.**

## Snapshots (go2rtc)

- EDN `:fire` / command with camera name matching go2rtc → high-quality JPG/PNG  
- GM optional “snapshot now” in PxD/PxP  
- Store under log tree, e.g. `…/snapshots/game-<counter>/<camera>-<timestamp>.jpg`  
- Caps: max days + max MB  
- Avoid per-camera “zones” complexity; name match is enough  

## People-count AI

- Useful for paid-player auditing; **prefer PxP-orchestrated** (local or cloud), not blocking PxO  
- Run once per image; persist result so re-processing is skipped:
  - **Recommended:** sidecar `<image>.json` (or `.txt`) with model, count, ts — easy to read/skip  
  - Alternative: EXIF/XMP user-comment — fragile across tools  
  - Avoid rewriting JSONL mid-file; optional later “enrichment” record append-only  

## Daily audit / PxP-Audit

- Owner/tech roles; hide from GM if needed  
- Desktop PxP may not run daily → need always-on helper **or** generate on-demand when owner opens PxP  
- **Recommendation:** start with **on-demand reports** in paid PxP; only add `PxP-Audit` daemon if
  customers require scheduled push without opening the app (ties to [10](10-premium-notify-and-remote.md))

## Acceptance (future)

Spec in PxO CONFIG_EDN + PxP server requirements; storage caps enforced; no PxH dependency.

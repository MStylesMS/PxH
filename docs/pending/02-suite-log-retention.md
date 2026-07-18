# Plan 02 — Suite log retention under `/opt/paradox/logs`

**Owner:** multi-app (PFx, PxO, Pio, PxB, PxT, PFxE, PxP-Agent) · **Priority:** P0  
**Status:** pending review · **Stub location:** PxH pending (cross-cutting)

## Findings (current)

| App | Writes paradox logs? | Real retention? |
|-----|----------------------|-----------------|
| PFx | yes | Startup cleanup 30d/100MB only; INI max size keys unused |
| PxO | yes | Same for app logs; **gameplay JSONL dir often uncleared** |
| Pio | single file | **none** |
| PxB | yes | **none** (docs claim rotation) |
| PxT | yes | **none** |
| PFxE | optional | **none** |
| PxP-Agent | single file | `log_rotate_days` parsed **unused** |
| logrotate.d in repo | — | **none** |

## Goal

A **suite convention** so every app that logs under `/opt/paradox/logs/<app>/` enforces age + total
size (and preferably mid-run rotation), without requiring every app on every machine.

## Proposed approach

1. **Document contract** in suite copilot-instructions + short `docs/LOGGING.md` per app or one
   suite note: defaults **30 days** and **100–200 MB per app directory**; gameplay JSONL separate
   cap (e.g. 50 files or 100 MB).
2. **Honor existing INI keys** where already documented (`log_max_size`, `max_files`,
   `log_rotate_days`) instead of inventing parallel names.
3. **Shared tiny helper** (copy-paste or small shared module) — startup prune + size check on
   write — OR ship a **systemd timer** `paradox-log-janitor` that only cleans configured
   subdirs present on that host (fits sparse installs).
4. Prefer **janitor timer** for Pio/single-file appenders that will not get code soon; fix
   PxP-Agent/PxT/PxB in-app when touched.

## Acceptance

- On a machine with only mosquitto+pxo+pfx, janitor or in-app cleanup keeps those dirs bounded
- Gameplay JSONL cannot fill the card unnoticed
- Docs match implemented keys

## Hand-off

After approval, split PRs per app or one janitor package under `apps/PxH` scripts / `props` tools —
decide in review. Copy this plan to owning repos’ `docs/pending/` when split.

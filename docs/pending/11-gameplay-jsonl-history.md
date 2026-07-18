# Plan 11 — Gameplay JSONL, game counter, history UX

**Owner:** PxO (data) · PxP (paid UX) · **Priority:** P2 · **Status:** pending review

## Exists today (PxO)

Gameplay JSONL when `game_logging` enabled: session header, phases, hints, schedules, sensors,
summary reason — see `apps/PxO/docs/SPEC.md` (Gameplay Analytics) and `gameplay-logger.js`.

## Gaps

| Need | Status |
|------|--------|
| Monotonic **game counter** per room/install | Missing — add for gap detection |
| Hint auto vs operator-triggered in JSONL | Partial — confirm/enrich event fields |
| Dedup noisy repeated warnings/events | Spec + implement |
| EDN version/hash in session header | Optional — low complexity, useful for AI later |
| Rich `session_summary` totals | Missing |
| History browser / reports | Not in PxO — **PxP paid** candidate |
| AI propose-approve EDN | Premium PxP — separate product decision |

## Recommendation

1. **PxO** keeps owning write-path JSONL (short, deduped, game counter, hint source).  
2. **Manual** read of files on disk remains free (operators can open JSONL without PxP).  
3. **PxP** paid: searchable history, daily rollup, AI assist — not required for JSONL to exist.  
4. Do **not** put game history UI in PxH.

## Acceptance (PxO slice)

- Each non-trivial run increments counter; counter appears in filename or header  
- Hint events include `source: auto|operator` (or equivalent)  
- Retention tied to [02](02-suite-log-retention.md) gameplay cap  

Copy to `apps/PxO/docs/pending/` when approved for implementation.

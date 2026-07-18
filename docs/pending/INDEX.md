# Pending plans — index

Focused, reviewable plans for agent execution. **Docs only until you approve a plan.**

Cross-repo ownership: keep the **owning app’s** `docs/pending/` as source of truth when work is
mostly there; this folder holds PxH-owned work **and** pointers/stubs for suite-spanning ideas so
they stay findable. See [BUSINESS-OVERVIEW.html](../BUSINESS-OVERVIEW.html) for product opinions.

| Plan | Owner | Priority | Title |
|------|-------|----------|-------|
| [01](01-disk-and-ide-prune.md) | PxH | P0 | Disk monitoring + IDE prune |
| [02](02-suite-log-retention.md) | Suite (multi-app) | P0 | `/opt/paradox/logs` retention contract |
| [03](03-service-health.md) | PxH | P0 | systemd service monitoring |
| [04](04-serve-path-and-fallback.md) | PxH | P0 | nginx + :19090 fallback |
| [05](05-ui-panels-and-themes.md) | PxH | P1 | Warnings / journal / props / themes |
| [06](06-mqtt-contract-drifts.md) | Props / rooms / PxB | P1 | `paradox/props`, `pxb/` doc drifts |
| [07](07-pxd-landing-link.md) | PxD (+ rooms) | P1 | Landing System Health link |
| [08](08-pxp-and-agent.md) | PxP / PxP-Agent / PxH | P1 | Boundaries & conflicts |
| [09](09-pi5-ssd-coexistence.md) | Lab / install | P2 | pi5-ssd Hub vs PxH defaults |
| [10](10-premium-notify-and-remote.md) | PxP (premium) | P2 | IM push + remote summary |
| [11](11-gameplay-jsonl-history.md) | PxO → PxP UX | P2 | Game counter, JSONL richness, history UI |
| [12](12-snapshots-and-audit.md) | PxO / PxP / go2rtc | P3 | Snapshots, people-count, daily audit |

**Where should cross-repo ideas live?**  
Prefer **owner repo** `docs/pending/` (e.g. copy or move 11→`PxO/docs/pending`, 10→`PxP/docs/pending`)
once approved; keep a one-line stub here linking to the owner. A future `paradox/docs/pending/`
index is optional if the suite root becomes a real repo.

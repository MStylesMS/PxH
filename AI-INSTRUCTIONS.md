# Paradox Health Monitor (PxH) — AI instructions

## What this is

Host-local **system health** for Paradox room Pis: metrics API, System Health UI (`/health/`),
MQTT alerts, gated maintenance (disk/IDE prune). Not game logic; not PxP-Agent.

## Names

| Name | Use |
|------|-----|
| Paradox Health Monitor | Product |
| PxH | Short / repo / npm package `pxh` |
| System Health | Operator-facing UI title |
| `/health/`, `/health-api/` | nginx paths (keep stable) |
| `paradox-health.service` | systemd unit |
| `pxh.ini` | config |

Former Hub product is **PxP**, not this repo.

## Docs

- [docs/SPEC.md](docs/SPEC.md) — contract
- [docs/API.md](docs/API.md) — HTTP + MQTT

Update docs in the same change as behaviour. Commit prefixes: `Docs:`, `Implement:`, `Fix:`, …

## Layout

- `src/` — Node service (Fastify + optional MQTT)
- `public/` — System Health static UI
- `config/pxh.example.ini` — config template
- `systemd/paradox-health.service` — unit file

## MVP priorities

1. Non-null reliable `diskRoot` metrics (D1)
2. Threshold MQTT alerts (D2–D3)
3. systemd services + warnings/journal/props panels + themes (§13)
4. PAM session for actions; IDE prune dry-run/execute + auto schedule
5. Deployable unit + sudoers on Agent22-class hosts

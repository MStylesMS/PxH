# Paradox Health Monitor (PxH)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**Paradox Health Monitor** (short: **PxH**) is the host-local system health service for Paradox room machines. It collects metrics, serves a **System Health** web UI at `/health/`, publishes MQTT
telemetry/alerts, and offers gated maintenance actions (apt/npm clean, IDE server prune).

It is **not** game logic, not PxD, and not [PxP-Agent](https://github.com/MStylesMS/PxP-Agent) (remote management for Paradox Prime).

> The old product name **Paradox Hub** also used “PxH”; that product is now **Paradox Prime (PxP)**.
> This repo is Health Monitor only.

## Quick start

```bash
git clone https://github.com/MStylesMS/PxH.git && cd PxH
npm install
cp config/pxh.example.ini pxh.ini   # or /opt/paradox/config/pxh.ini on a Pi
npm run build
npm start -- --config ./pxh.ini
```

- API: `http://127.0.0.1:19090/metrics`
- UI (dev): `http://127.0.0.1:19090/ui/` (static `public/`)

On a room Pi, nginx exposes `/health-api/` → API and `/health/` → static UI.

## Documentation

| | |
|---|---|
| [Specification](docs/SPEC.md) | Purpose, architecture, requirements, disk/IDE prune |
| [HTTP / MQTT API](docs/API.md) | Endpoints and topics |

## License

Dual-licensed:

- **AGPL-3.0** — see [LICENSE](LICENSE).
- **Commercial** — see [COMMERCIAL.md](COMMERCIAL.md).

Copyright © 2026 Mark Stevens.

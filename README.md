# Paradox Health Monitor (PxH)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**Paradox Health Monitor** (short: **PxH**) is the host-local system health service for Paradox room machines. It collects metrics, serves a **System Health** web UI at `/health/`, publishes MQTT telemetry/alerts, streams live panels over WebSocket, and offers PAM-gated maintenance (apt/npm clean, IDE server prune).

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

On a room Pi:

```bash
sudo bash scripts/install.sh
```

See [docs/INSTALL.md](docs/INSTALL.md) and [docs/QUICK-SETUP.md](docs/QUICK-SETUP.md).

- API: `http://<host>:19090/metrics`
- UI: `http://<host>:19090/ui/` (fallback) or `http://<host>/health/` via nginx
- Actions require local OS login (PAM session)

## Documentation

| | |
|---|---|
| [Specification](docs/SPEC.md) | Purpose, architecture, MVP requirements |
| [HTTP / MQTT API](docs/API.md) | Endpoints, auth, WebSocket, topics |
| [Install](docs/INSTALL.md) | Installer, sudoers, nginx |
| [Quick setup](docs/QUICK-SETUP.md) | First-boot checklist |
| [Agent 22 prompt](docs/AGENT22-SETUP-PROMPT.md) | Paste-ready agent instructions for Agent 22 |
| [Moscow-dev prompt](docs/MOSCOW-DEV-SETUP-PROMPT.md) | Paste-ready agent instructions for SpyCatcher Moscow (`moscow-dev.local`) |
| [Pending plans](docs/pending/INDEX.md) | Cross-repo backlog |
| [Business overview](docs/BUSINESS-OVERVIEW.html) | Host health vs premium ops roadmap |

## License

Dual-licensed:

- **AGPL-3.0** — see [LICENSE](LICENSE).
- **Commercial** — see [COMMERCIAL.md](COMMERCIAL.md).

Copyright © 2026 Mark Stevens.

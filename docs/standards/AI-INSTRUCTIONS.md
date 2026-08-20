# Paradox Suite — System AI Instructions

This is the **short, always-read** overview of the whole Paradox escape-room software suite. It
gives any AI agent shared vocabulary and the system map. For work on a specific application, read
that app's own `AI-INSTRUCTIONS.md` (quick) and `AI-DETAILED-OVERVIEW.md` / detailed overview
equivalents (on demand).

_Canonical public copy:_ hosted under **PxH** `docs/standards/` so venue installs that carry Health
Monitor also carry this brief. Do not add internal roadmaps or pending-plan status here.

## What Paradox is

Paradox is a modular suite for running escape rooms and interactive experiences. Independent
applications communicate over **MQTT**. Each app has one clear job; any app can be replaced without
touching the others as long as the MQTT contract holds.

## The applications

| App | Role | Lang / Format |
|---|---|---|
| **PxP** | **Paradox Prime** — operator/admin hub: install, configure, launch, monitor, troubleshoot the suite. Setup & maintenance only; never in live games. (Formerly "Paradox Hub".) | Electron / INI·EDN·JSON |
| **PxP-Agent** | Lightweight remote management agent on each managed machine (HTTPS/WSS for PxP). Not game logic. | Node.js / INI |
| **PxH** | **Paradox Health Monitor** — host-local metrics, System Health UI (`/health/`), MQTT alerts, maintenance prune. | Node.js / INI |
| **PFx** | Media / audio / lights / relays controller | Node.js / INI |
| **PFxE** | Single-zone Electron media controller | Electron / INI |
| **PxO** | Game orchestration engine (state machine, sequences) | Node.js / INI + EDN |
| **PxC** | Configurable clock app framework | React / INI |
| **PxT** | Player terminal kiosk | Electron / INI |
| **PxIO** | GPIO-to-MQTT bridge | C++ / INI |
| **PxB** | Z-Wave / Zigbee / Thread to MQTT bridge | Node.js / INI |
| **PxS** | **Paradox Speech** — room STT/TTS service (cloud/off-box STT, Piper/cloud TTS, MQTT + WS captions) | Node.js / INI |
| **PxD** | Operator dashboard — the GM's daily tool, browser-served | Web / room.json |
| **Mosquitto** | MQTT broker (the message bus) | conf |
| Rooms | `agent22`, `houdinis-challenge`, `spycatcher` — EDN/media game packages | EDN |

## How the pieces relate

- **MQTT is the contract.** Topic structure `{baseTopic}/{commands|events|state|warnings}` is sacred.
  Commands flow PxO → PFx (media) and PxO → PxB (radio devices); inputs flow from PFx / PxB / PxIO /
  PxT → PxO. Z-Wave/Zigbee sensor events reach PxO via PxB (not via PFx).
- **PxO** is the brain (game logic). **PFx** is media/audio. **PxB**/**PxIO** are hardware bridges.
  **PxS** is speech (STT/TTS captions and announcements). **PxD** is the GM's live surface. **PxP**
  is the operator/admin layer that configures and manages everything but is **not** part of a
  running game. **PxH** is the always-on host health beacon (`/health/`, MQTT system alerts) on
  each room machine — complementary to **PxP-Agent** (Prime's remote management channel).
- **Runtime apps start at boot as services**; a venue runs games all day without PxP open.

## Working conventions (all repos)

- **Node.js runtime**: **24 LTS** is the suite default for development, CI, and venue hosts.
  Pin it in each Node app's `package.json` `engines.node` (and `.nvmrc` where used). Existing
  installs on Node 18/20 must be upgraded to Node 24 LTS before running current app versions.
- **Documentation-first.** Specify non-trivial behaviour in `docs/` before coding; update docs in
  the same commit as code. The doc is the contract.
- **Conventional commit prefixes**: `Docs:`, `Implement:`, `Fix:`, `Test:`, `Refactor:`, `Chore:`.
- **Never bypass the MQTT wrapper**; never break documented topic/command contracts without an
  approved doc update.
- **AI instruction files**: each repo's canonical brief is `AI-INSTRUCTIONS.md`, with thin
  `AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` pointers to that file.

## Prop admin HTTP UIs (reverse proxy)

Prop firmware HTTP admin UIs are reached on the LAN via mDNS (`http://<label>.local/`).
For remote access, the Room Controller nginx proxies `/props/<mdns-label>/` to the prop;
PxD landing links use the same path-absolute URL (works on LAN and Tailscale).

**Canonical doc:** `apps/PxD/docs/PROP_ADMIN_REVERSE_PROXY.md` (PxD repo).

**Firmware:** ESP32 props use `px-components/lib_http_proxy`; ESP8266 props use
in-tree `src/http_proxy.*`. Both honour `X-Forwarded-Prefix` and keep path-relative
static/API URLs so direct LAN access is unchanged.

## Repo layout (typical workspace)

```
paradox/
  apps/
    PxP/        Paradox Prime (operator hub)
    PxP-Agent/  Remote management agent (open source; used by PxP)
    PxH/        Paradox Health Monitor (host-local /health/ beacon)
    PFx/ PFxE/ PxO/ PxC/ PxT/ PxIO/ PxB/ PxS/ PxD/ ...
  rooms/        Game packages
  props/        Prop firmware
  Px-Suite/     Private suite notes / pending / business (internal machines only)
```

Canonical clone URLs for all suite repos live in **Px-Suite** `REPOS.md` (one file to update when a home moves).

> Note: The former product **Paradox Hub** is now **Paradox Prime (PxP)**. The acronym **PxH**
> now means **Paradox Health Monitor** only. The remote agent binary remains `pxp-agent`
> (repo folder `PxP-Agent`).

## Suite standards (this folder)

Suite-wide **public** contracts and this brief live in **this folder** (not a single file). Read
them before changing MQTT topics or shared conventions. If you change a standard, update the file
under PxH `docs/standards/` first and propagate to other repos' docs in the same work.

Start with [MQTT-CONTRACT.md](MQTT-CONTRACT.md) for topic trees and retain rules.

# 15 — Windows 11 Mini PC host (low priority)

_Status: backlog / low priority_  
_Owner: PxH_  
_Also triage in:_ private **Px-Suite** `notes/SUITE-NOTES.md` (see §7 — that file is not in this repo)

## Intent

Position Paradox to run room controllers on **Windows 11 Mini PCs** as well as Raspberry Pis.
Mini PCs are now often similar in price to Pis while offering more CPU/RAM headroom for Electron
apps (PFxE, PxT, …) and denser local stacks.

This is **not** a literal port of the Linux/systemd/PAM/apt stack. It is **useful desktop parity
(scope B)**, Windows-only first.

## Agreed scope (scope B, Windows 11 only)

| In scope | Out of scope (for this track) |
|----------|-------------------------------|
| Windows 11 only (no macOS in v1) | Porting apt, journalctl, PAM, sudoers, linux IDE prune paths |
| Always-on **Windows Service** that starts at boot | Full Electron/Qt “second Hub” |
| Same HTTP/WS/MQTT **contract** where it still makes sense (`:19090`, System Health UI) | Matching every Linux System Health tile 1:1 |
| **Windows-appropriate** metrics tiles | Fleet orchestration / MQTT explorer (→ PxP) |
| Primary job: monitor **Paradox services & apps** (mosquitto, web server/nginx or IIS equivalent, PFxE, PxO, PxT, …) | Building Qt for the tray |
| Minimal **tray sidecar** | Stopping the service when the tray exits |

### Architecture

```
  Windows Service (PxH core)          Tray helper (tiny native/Go)
  · metrics / process·service watch   · icon: ok / warn / failed
  · HTTP + WS + optional UI :19090    · popup: highest-level summary
  · MQTT pub/sub                      · Open System Health (browser)
  · pxh.ini (watch list, thresholds)  · Preferences (optional popup)
                                      · About / Exit (tray only)
```

- **Service** is authoritative. Tray polls local API (e.g. `http://127.0.0.1:19090`).
- **Do not** use Qt or a full Electron app for the tray. Prefer a small native or Go tray binary.
- Electron/Tauri only if Preferences/About truly need a webview; default is menu + browser UI.

### Tray requirements

- Icon appearance reflects the **worst state** among watched items (`ok` / `warn` / `failed`).
- Popup shows only high-level info (machine/status summary, About, update affordance if cheap).
- Actions: **Open PxH in browser**, **Preferences** (launch-at-login; which apps/services to watch),
  **About**, **Exit** (quit tray; leave service running).
- Watch list may be edited in the **browser System Health UI** and/or a small preferences popup if
  that stays easy — both write the **service** config (`pxh.ini` or a small config API), not
  tray-only state.

### System Health on Windows

Tiles should be whatever is useful on Windows (CPU, RAM, disk, optional temp, service/app grid),
not a clone of Pi cards (apt upgrade progress, journal panel, etc. can degrade or omit).

**Main focus:** configured Paradox **services** (broker, web server, …) and **apps** (PFxE, PxO,
PxT, …) — running / stopped / failed, with tray color driven by that set.

### Implementation sketch (when prioritized)

1. Extend SPEC/API with a **capability matrix** (Linux vs Win11) and degraded endpoints.
2. Extract **platform adapters** in the Node service (metrics, service/process probe, auth, actions,
   install).
3. Implement **Windows Service** install + boot start (Node host or equivalent wrapper).
4. Ship **tray helper** against local HTTP API; launch-at-login registration.
5. Keep Pi/Linux as the reference implementation; share docs contract and as much core as practical.

## Explicit non-goals

- macOS / Qt / “port the Pi unit file”
- Growing PxH into a second Prime/Hub
- Requiring Linux-only maintenance actions on Windows

## Priority

**Low.** Do not pull ahead of Pi fleet reliability, suite log retention, or other higher-ranked
host-health work. Schedule when Mini PC room controllers are an active product bet.

## Suite notes (copy into Px-Suite)

Private **Px-Suite** is not available in the distributed PxH / cloud-agent checkout. When editing
`Px-Suite/notes/SUITE-NOTES.md` on an internal machine, add a **low-priority** bullet such as:

```markdown
- **PxH — Windows 11 Mini PC host (low priority):** Useful desktop parity for room Mini PCs
  alongside Pis — Windows Service at boot, Windows-appropriate System Health tiles, focus on
  watching Paradox services/apps (mosquitto, web server, PFxE, PxO, PxT, …), plus a minimal tray
  (status icon, open UI in browser, prefs/About/Exit). Not a literal Linux port; no Qt/full
  Electron tray. Plan: `apps/PxH/docs/pending/15-windows-minipc-host.md`.
```

## Related

- [SPEC.md](../SPEC.md) — current Pi/Linux contract  
- [API.md](../API.md) — HTTP / MQTT / WS  
- Chat consensus (2026-07): spec-first adapters; service + tiny tray; scope B; Win11-only first

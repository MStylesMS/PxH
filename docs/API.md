# Paradox Health Monitor — HTTP / MQTT API

_Status: MVP_ · See [SPEC.md](SPEC.md)

**Direct (always):** `http://<host>:19090` (default bind `0.0.0.0`)  
**Via nginx (preferred):** `http://<host>/health-api/` → API; `http://<host>/health/` → UI  

UI also at `http://<host>:19090/ui/` when `serve_ui=true` (fallback if nginx is down).

**Auth:** Viewing (metrics, panels, WebSocket) is open on the trusted LAN/Tailscale network.
Maintenance `/actions/*` and prune preview require a PAM session (local OS user).

---

## 1. Liveness and metrics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` or `/health` | `{ status, version, name }` |
| `GET` | `/metrics` | Host snapshot including **diskRoot**, temps, RAM, load, apt, `diskLevel`, optional `topConsumers` |
| `GET` | `/services` | Configured systemd units with `state`, `tier`, `enabled`, `pid`, `extraProcesses` |
| `GET` | `/runtime` | Alias of `/services` (prototype compatibility) |
| `GET` | `/apps/versions` | Paradox app git inventory (fetch `origin`, compare current branch; on-demand) |
| `GET` | `/apps/:name/commits?branch=` | Recent commits on `origin/<branch>` for the update modal |
| `GET` | `/reachability/nginx-health` | Server-side check that `http://127.0.0.1/health/` is up (used by `:19090` UI banner) |

### `diskRoot` (required when `/` readable)

```json
{ "totalGb": 14.5, "usedGb": 12.1, "availableGb": 2.4, "usedPercent": 83.4 }
```

`diskLevel`: `ok` | `warn` | `critical` from `[thresholds]`.

### `/services` item shape

```json
{
  "name": "pxo",
  "tier": "required",
  "state": "stopped",
  "enabled": "disabled",
  "pid": null,
  "extraProcesses": [
    { "pid": 4242, "cmd": "node /opt/paradox/apps/PxO/src/game.js --config …" }
  ]
}
```

`extraProcesses`: cmdline-matched app processes **not** in the unit cgroup (empty when none,
unit has no matcher, or `[services] scan_conflicts=false`).

### `/apps/versions`

LAN-visible (same as metrics). For each `[apps]` unit that is also listed under `[services]`:

1. Confirm path is a git work tree
2. `git fetch --prune origin` (uses the checkout’s configured SSH remotes)
3. Report HEAD, current branch, `originUrl`, origin branch names, behind/ahead vs `origin/<branch>`
4. Include up to 50 newer commits (`sha`, `short`, `subject`, `body`, `author`, `date`)

Per-app soft failures set `error` (missing path, fetch/SSH failure, detached HEAD, etc.).
Intended for UI load / Refresh only — not attached to the WebSocket `services` channel.

```json
{
  "apps": [
    {
      "name": "pxo",
      "path": "/opt/paradox/apps/PxO",
      "present": true,
      "git": true,
      "branch": "main",
      "head": {
        "sha": "…",
        "short": "a1b2c3d",
        "subject": "…",
        "body": "",
        "author": "…",
        "date": "2026-07-21T12:00:00+00:00"
      },
      "remote": "origin",
      "originUrl": "git@github.com:MStylesMS/PxO.git",
      "originBranches": ["main", "develop"],
      "behind": 2,
      "ahead": 0,
      "newerCommits": [],
      "fetchedAt": "2026-07-21T20:00:00.000Z",
      "error": null
    }
  ]
}
```

### `/apps/:name/commits?branch=`

LAN-visible. Returns recent commits on `origin/<branch>` (newest first, capped) plus
`currentBranch`, `headSha`, `behind`, and `originUrl` for the update modal.

---

## 2. Auth (PAM session)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/auth/login` | `{ "username", "password" }` | PAM local login → httpOnly session cookie |
| `POST` | `/auth/logout` | — | Clear session |
| `GET` | `/auth/session` | — | `{ authenticated, username? }` |

Session lifetime: `[actions] session_hours` (default 12). Optional `[actions] allowed_users` allowlist.

---

## 3. UI data feeds (ring buffers)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/panels/warnings` | Recent MQTT warning lines (`lines`, `since` query) |
| `GET` | `/panels/journal` | Recent journal lines for configured units |
| `GET` | `/panels/props` | Recent prop announce messages |
| `GET` | `/panels/meta` | Theme default, history limits, color map |

**WebSocket (primary live feed):** `WS /ws`

Client → server:

```json
{ "op": "subscribe", "channels": ["metrics", "warnings", "journal", "props", "services"] }
```

Server → client:

```json
{ "channel": "metrics", "data": { } }
```

HTTP GET panels remain for bootstrap and poll fallback (`ui.refresh_seconds`).

Each warning line shape:

```json
{
  "ts": "2026-07-18T15:01:02Z",
  "topic": "paradox/agent22/pfx/warnings",
  "colorKey": "pfx",
  "payload": { }
}
```

---

## 4. Actions

Require valid session cookie. Gated by `[actions]` flags; destructive bodies need `"confirm": true`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/actions/upgrade` | — | apt update + upgrade (long-running; progress on WS `action`) |
| `POST` | `/actions/restart` | `{ "confirm": true }` | Host reboot (delayed) |
| `POST` | `/actions/service` | `{ "name", "action" }` | `start`\|`stop`\|`restart`\|`enable`\|`disable` allowlisted unit |
| `POST` | `/actions/cleanup` | `{ "targets", "confirm", "dryRun?" }` | Clears **apt** package archives and/or **npm** cache (and optional **ide** prune). Does **not** delete media, room configs, or `/opt/paradox` apps. |
| `POST` | `/actions/prune-ide` | `{ "confirm", "dryRun?" }` | IDE server prune (SPEC §6) |
| `GET` | `/actions/prune-ide/preview` | — | Dry-run inventory (session required) |
| `POST` | `/actions/app-update` | `{ "name", "branch", "sha", "confirm": true }` | Hard-reset mapped app to commit on `origin/<branch>` and `systemctl restart` (refuses dirty tree; allows self-update). Gated by `allow_app_update`. |

Unauthenticated → **401**.

---

## 5. MQTT — publish (PxH → broker)

With `topic_root=paradox` and `[machine] id=<id>`:

| Topic | Retained | Payload |
|-------|----------|---------|
| `paradox/<id>/system/health` | yes | metrics snapshot |
| `paradox/<id>/system/disk` | yes | diskRoot + level |
| `paradox/<id>/system/services` | yes | services array |
| `paradox/<id>/system/alerts` | no | `{ level, type, message, …, ts }` |

Alerts are non-retained; critical is reaffirmed periodically while still critical.
Soft-fail if broker down. Optional `topic_base` overrides the `{topic_root}/{id}` prefix.

---

## 6. MQTT — subscribe (broker → PxH panels)

Configured in `[warnings]`, `[props]`. Canonical suite suffix is **`/warnings` (plural)**.

Default patterns (example ini):

- `paradox/+/pfx/warnings`, `paradox/+/pfxe/warnings` → color `pfx`
- `paradox/+/pxo/warnings` → `pxo`
- `paradox/+/pio/warnings` → `pio`
- `paradox/+/pxb/warnings`, `paradox/+/pxb/+/warnings` → `pxb`
- `paradox/+/pxt/warnings` → `pxt`
- `paradox/+/+/warnings` (game / catch-all) → `game` (lower priority than specific rules)
- `paradox/props` → props panel (not warnings)

---

## 7. History defaults

| Panel | Default lines | Default hours | Config keys |
|-------|---------------|---------------|-------------|
| Warnings | 200 | 24 | `warnings.history_lines`, `warnings.history_hours` |
| Journal | 100 | 6 | `journal.history_lines`, `journal.history_hours` |
| Props | 50 | 168 (7d) | `props.history_lines`, `props.history_hours` |

Evict by whichever limit is hit first.

---

## 8. Errors

| Code | Cause |
|------|--------|
| 400 | Missing confirm / bad body |
| 401 | Action requires login |
| 403 | Action disabled, user not allowlisted, or unit not allowlisted |
| 404 | Unknown service |
| 500 | Collection/action failure |
| 503 | Optional dependency (e.g. journalctl unavailable) |

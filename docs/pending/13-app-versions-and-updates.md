# Plan 13 — Paradox app versions & updates (phased)

**Owner:** PxH · **Priority:** P1 · **Status:** Phase 1–2 implemented

## Goal

Surface Git identity for Paradox applications on each host, then allow
operators to move a checkout along a branch or switch branches. Rooms/content
repos and Node runtime updates are later phases.

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| **1** | Show installed app version (commit); detect newer commits on current branch; list origin branches; show commit messages for commits ahead of HEAD; enhance Services grid | **Implemented** (card simplified in Phase 2) |
| **2** | Select older/newer commits on the current branch; select a different branch (checkout); PAM-gated Apply + restart | **Implemented** |
| **3** | Update Node runtime | Deferred (future PR / skip for now) |
| **4** | Extend inventory + update model to other git repos already on the Pi (e.g. rooms) that have an `origin` | Planned |

## Decisions (locked)

1. **Install model:** Paradox apps under `/opt/paradox/apps/…` are real git checkouts
   with `.git` and a working `origin` remote (SSH keys already configured on the machine).
2. **Scope:** All Paradox units that appear in the services allowlist **and**
   have an entry in the apps map (not `mosquitto` / `nginx`).
3. **Mapping:** Explicit `[apps]` map in `pxh.ini` (unit name → absolute path). Example
   ini ships with convention defaults (`pxo` → `/opt/paradox/apps/PxO`, etc.).
4. **Remote access:** Use local `git` against `origin` (SSH). No GitHub API tokens in PxH.
5. **Apply (Phase 2):** `git fetch` → checkout branch → **`git reset --hard <sha>`** →
   `systemctl restart <unit>` (including self-update of `paradox-health`).
6. **Dirty tree:** Refuse Apply if `git status --porcelain` is non-empty.
7. **UI:** Services card shows **Update available.** when behind; gear opens update modal.
8. **Freshness:** Fetch/compare on **UI load and full page refresh** only — not on the
   periodic WebSocket services poll.
9. **Leave warning:** Only while Apply is in progress.

## Phase 1 — inventory (still used)

### Config

```ini
[apps]
; systemd unit name = absolute path to git checkout
paradox-health = /opt/paradox/apps/PxH
pfx = /opt/paradox/apps/PFx
…
```

### API

| Method | Path | When | Description |
|--------|------|------|-------------|
| `GET` | `/services` | WS + poll | Unchanged: systemd state only (fast) |
| `GET` | `/apps/versions` | UI load / refresh | Per mapped unit: path, HEAD, branch, origin URL/branches, behind count |

## Phase 2 — update modal

### Card

- Keep `tier · boot … · pid` directly under the action buttons
- Remove branch/SHA / “N newer” / origin list / expandable changelog from the card
- If `behind > 0`: **Update available.**
- Gear (top-right) for mapped git apps → modal (PAM login if needed)

### Modal

- Display name (path basename) + origin URL
- Branch dropdown (current branch bold)
- Commit dropdown:
  - Default: last 5 on `origin/<branch>`, newest first; current HEAD bold
  - If current branch and `behind > 4`: 4 newest, disabled “XX more recent commits”, then current HEAD
  - Gap commits are not selectable
- Apply enabled when selection differs from current branch/HEAD
- Leave/close/`beforeunload` while Apply runs: confirm Continue vs Cancel Update (not advised)

### API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/apps/:name/commits?branch=` | open | Commits on `origin/<branch>` for the modal |
| `POST` | `/actions/app-update` | session | `{ name, branch, sha, confirm: true }` — dirty refuse, hard reset, restart |

Gated by `[actions] allow_app_update` (default true).

## Acceptance

### Phase 1

1. Mapped apps with valid git + reachable `origin` report behind/HEAD via `/apps/versions`.
2. Page load / refresh triggers fetch+compare; WS services refresh does not.
3. Missing map entry / path / git failure degrades that row only.

### Phase 2

1. Gear opens modal with origin URL, branch + commit selects.
2. Apply refuses dirty trees; accepts SHAs on `origin/<branch>` only.
3. Apply checkouts/resets and restarts the unit (including `paradox-health`).
4. Leave warning only during Apply.

## Later phases (sketch only)

- **Phase 3:** Optional Node version display / upgrade path — likely deferred.
- **Phase 4:** Scan or map additional repos (rooms) with `origin`; same inventory UX,
  different post-update hooks (no blind delete under `/opt/paradox`).

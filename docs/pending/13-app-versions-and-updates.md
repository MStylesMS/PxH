# Plan 13 — Paradox app versions & updates (phased)

**Owner:** PxH · **Priority:** P1 · **Status:** approved (Phase 1 implementation)

## Goal

Surface Git identity for Paradox applications on each host, then (later) allow
operators to move a checkout along a branch or switch branches. Rooms/content
repos and Node runtime updates are later phases.

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| **1** | Show installed app version (commit); detect newer commits on current branch; list origin branches; show commit messages for commits ahead of HEAD; enhance Services grid | **Implemented** |
| **2** | Select older/newer commits on the current branch; select a different branch (checkout) | Planned |
| **3** | Update Node runtime | Deferred (future PR / skip for now) |
| **4** | Extend inventory + update model to other git repos already on the Pi (e.g. rooms) that have an `origin` | Planned |

## Decisions (locked)

1. **Install model:** Paradox apps under `/opt/paradox/apps/…` are real git checkouts
   with `.git` and a working `origin` remote (SSH keys already configured on the machine).
2. **Scope (Phase 1):** All Paradox units that appear in the services allowlist **and**
   have an entry in the apps map (not `mosquitto` / `nginx`).
3. **Mapping:** Explicit `[apps]` map in `pxh.ini` (unit name → absolute path). Example
   ini ships with convention defaults (`pxo` → `/opt/paradox/apps/PxO`, etc.).
4. **Remote access:** Use local `git` against `origin` (SSH). No GitHub API tokens in PxH.
5. **Selected branch (Phase 1):** The currently checked-out branch. Still **discover and
   list** all branches known on `origin` (read-only until Phase 2).
6. **UI:** Enhance the existing Services grid (not a separate panel).
7. **Freshness:** Fetch/compare on **UI load and full page refresh** only — not on the
   periodic WebSocket services poll.

## Phase 1 — design

### Config

New optional section:

```ini
[apps]
; systemd unit name = absolute path to git checkout
paradox-health = /opt/paradox/apps/PxH
pfx = /opt/paradox/apps/PFx
pfxe = /opt/paradox/apps/PFxE
pxo = /opt/paradox/apps/PxO
pio = /opt/paradox/apps/PiO
pxb = /opt/paradox/apps/PxB
pxt = /opt/paradox/apps/PxT
pxc = /opt/paradox/apps/PxC
```

- Missing path / missing `.git` → service row shows no version (or “no git”), never crash.
- Units without an `[apps]` entry (e.g. `nginx`) unchanged.

### API

| Method | Path | When | Description |
|--------|------|------|-------------|
| `GET` | `/services` | WS + poll | Unchanged: systemd state only (fast) |
| `GET` | `/apps/versions` | UI load / refresh | Per mapped unit: path, HEAD, branch, origin branches, behind count, newer commits |

`GET /apps/versions` (read-only, LAN-visible like metrics):

1. For each `[apps]` entry whose unit is also in `[services]`:
2. Verify work tree; read `HEAD`, current branch, short subject/date.
3. `git fetch origin` (timeout-bounded, parallel per app).
4. List remote heads (`origin/*`).
5. Against **current branch** tip on origin: count commits `HEAD..origin/<branch>`;
   return those commits (sha, subject, body, author, date), capped (e.g. 50).
6. Soft-fail per app (`error` string) if fetch/SSH/path fails.

Do **not** attach heavy git payloads to retained MQTT `…/system/services` in Phase 1.

### UI (Services grid)

For each Paradox-mapped row:

- Show short SHA + branch (e.g. `main @ a1b2c3d`).
- If `behind > 0`, highlight (e.g. “3 newer”) and affordance to expand **newer commits**
  (subject + optional body) for the current branch.
- Show origin branch names (compact; full list in expand/detail).
- Infra-only rows unchanged.

### Install note

`scripts/install.sh` must **not** strip `.git` when syncing PxH, so a checkout-based
install keeps version identity.

### Non-goals (Phase 1)

- Checkout / reset / pull / branch switch (Phase 2)
- Changing “selected” branch in UI (Phase 2)
- Rooms / non-app repos (Phase 4)
- Node upgrades (Phase 3 / skip)
- Fleet orchestration (PxP-Agent)
- Curated `CHANGELOG.md` parsing (git commit messages only)

## Acceptance (Phase 1)

1. Mapped Paradox apps with valid git + reachable `origin` show branch + HEAD on the grid.
2. When origin has commits not in HEAD on the current branch, UI shows behind count and
   those commit messages.
3. Origin branch names are listed (read-only).
4. Page load / refresh triggers fetch+compare; WS services refresh does not.
5. Missing map entry, missing path, or git/SSH failure degrades that row only.
6. SPEC + API docs updated in the same change.

## Later phases (sketch only)

- **Phase 2:** PAM-gated actions to checkout commit/branch; restart unit after update;
  confirm dialogs; refuse unsafe states (dirty tree policy TBD).
- **Phase 3:** Optional Node version display / upgrade path — likely deferred.
- **Phase 4:** Scan or map additional repos (rooms) with `origin`; same inventory UX,
  different post-update hooks (no blind delete under `/opt/paradox`).

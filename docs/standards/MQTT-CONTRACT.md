# Paradox suite — MQTT contract

_Canonical._ Hosted in PxH so every room machine that runs Health Monitor has this file.
Per-app details remain in each repo’s `docs/MQTT_API.md` (or equivalent). Room-specific maps
(e.g. SpyCatcher) remain in that room’s docs.

**Change control:** see [README.md](README.md). Any change to this contract must be made here
first, then propagated to other repos’ docs in the same work.

---

## 1. Sacred four suffixes

Every game, zone, and prop base topic uses:

```
{baseTopic}/commands    # inbound control
{baseTopic}/events      # discrete outbound events
{baseTopic}/state       # retained snapshot / heartbeat
{baseTopic}/warnings    # non-fatal notices (plural)
```

Do not invent `/warning` (singular) or `/status` as a substitute for `/state`.

---

## 2. Game and zone trees

### Game (orchestrator / PxO)

```
paradox/<room>/commands
paradox/<room>/state          # retained
paradox/<room>/events
paradox/<room>/warnings
```

`<room>` is the venue’s game root, for example:

| Product | `<room>` value |
|---------|----------------|
| Agent22 | `agent22` → topics `paradox/agent22/…` |
| Houdini | `houdini` → topics `paradox/houdini/…` |
| SpyCatcher Moscow | `spycatcher/moscow` → `paradox/spycatcher/moscow/…` |
| SpyCatcher Washington | `spycatcher/washington` → `paradox/spycatcher/washington/…` |

SpyCatcher’s `<room>` **includes** the instance segment (`moscow` / `washington`). It is not
bare `spycatcher`.

### Zones (media, GPIO, props wired as zones)

```
paradox/<room>/<zone>/{commands,state,events,warnings}
```

Examples: `paradox/houdini/mirror/commands`, `paradox/spycatcher/moscow/audio/state`.

PxD `topicRoot` is normally `paradox/<room>` and derives game command/state/warning topics from it.

---

## 3. Retain rules

| Topic class | Retained? |
|-------------|-----------|
| `*/state` | **Yes** — latest snapshot for new subscribers |
| `*/commands` | No |
| `*/events` | No |
| `*/warnings` | No |
| Prop **announce** (`paradox/props` or `<company>/props`) | **No** |
| PxH `…/system/alerts` | No |
| PxH `…/system/{health,disk,ups,services}` | Yes (snapshots) |

**Why announce is not retained:** MQTT retain is one message per topic. A shared announce bus
with retain=true would keep only the last prop. Discovery history belongs in subscribers
(e.g. PxH props panel ring buffer, default 50 lines) — not broker retain.

---

## 4. Prop announce vs prop state

| Role | Topic | Cadence | Default |
|------|-------|---------|---------|
| **Announce** | `paradox/props` | Once per MQTT connect/reconnect | Suite default. Third-party installs may use `<company>/props`. |
| **State / heartbeat** | `{baseTopic}/state` | Connect, on change, ~every 10s | Prefer `paradox/<room>/<device>/state` |

Do **not** publish frequent heartbeats on the announce topic. Do **not** put app heartbeats
(e.g. PFx) on `paradox/props`.

---

## 5. Host system topics (PxH) vs room warnings

### Room / game warnings

```
paradox/<room>/warnings
paradox/<room>/+/warnings
```

Published by PxO, zones, props, bridges — gameplay and app runtime notices.

### Host / machine topics (PxH only)

```
paradox/<machine.id>/system/health
paradox/<machine.id>/system/disk
paradox/<machine.id>/system/ups
paradox/<machine.id>/system/services
paradox/<machine.id>/system/alerts
```

`<machine.id>` comes from `[machine] id` in `pxh.ini`, **not** from the game `topicRoot`.

PxD and operators typically subscribe to host alerts with:

```
paradox/+/system/alerts
```

**Side note:** `machine.id` often matches a room or host nickname (e.g. `agent22`, `houdini`,
`picture`). That avoids accidental collisions in small venues and keeps names memorable, but
the topic remains **host-scoped** (disk, UPS, systemd). It is not a substitute for
`paradox/<room>/warnings`, and it is not a “room-controller” MQTT namespace. (“Room controller”
in Paradox docs usually means the nginx / HTTP proxy host for prop admin UIs.)

---

## 6. Bridge namespace (PxB)

Radio bridge topics use **`pxb/`** under the configured base:

```
{base_topic}/pxb/state
{base_topic}/pxb/commands
{base_topic}/pxb/warnings
{base_topic}/pxb/discovered/...
```

Do not use `pzb/` for MQTT (legacy name may remain only in old filenames such as `pzb.ini`).

---

## 7. PxS (Paradox Speech) process namespace

Speech services use a process root under the room tree (not a media zone leaf):

```
paradox/<room>/speech/{commands,state,events,warnings}
```

Example (Agent22): `paradox/agent22/speech`.

| Role | Practice |
|------|----------|
| Heartbeat / snapshot | Retained `{base}/state` (default ~10s; configurable) |
| Live caption partials | **WebSocket** from PxS (not high-rate MQTT partials) |
| Finals / TTS lifecycle | Optional low-rate `{base}/events` |
| STT phase gating | Driven by room game `{roomRoot}/state` (PxO) |

Per-app detail: `apps/PxS/docs/SPEC.md`, `apps/PxS/docs/MQTT_API.md` (when present).

Do **not** put speech heartbeats on `paradox/props`. Do **not** use `/status` instead of `/state`.

---

## 8. PFx process namespace

PFx separates **process** traffic from **zone** traffic:

| Role | Config key | Suite practice | Publishes / subscribes |
|------|------------|----------------|------------------------|
| Process root | `[mqtt] base_topic` | `paradox/<room>/pfx` | `{base_topic}/discovery` (retained zone catalog) |
| Process heartbeat | `[global] heartbeat_topic` | `paradox/<room>/pfx/heartbeat` | Periodic liveness (full topic; nothing appended) |
| Zone root | `[screen:…]` / `[audio:…]` `topic` | `paradox/<room>/<zone>` | `{topic}/{commands,state,events,warnings,schema}` |

Examples: `paradox/spycatcher/moscow/pfx`, `paradox/houdini/pfx`.

Do **not** set `[mqtt] base_topic` to a zone leaf (`…/audio`, `…/mirror`). Do **not** put PFx heartbeats on `paradox/props`.

Per-app detail: `apps/PFx/docs/MQTT_API.md`, `apps/PFx/docs/CONFIG_INI.md`.

---

## 9. Media pack (`mediaId`)

Optional **language / restyle pack** selected by PxM (or a GM publishing the same commands). Players
insert a positive integer folder name between the configured media root and the relative `file`.
Omit the field and path resolution is **bit-identical to today**.

Room file inventory (what is on disk, transcripts): [ROOM-MEDIA-CATALOG.md](ROOM-MEDIA-CATALOG.md).
That document is **not** the PxM pack catalog (`id` / `name` / `language`).

### Path rule (PFx, PFxE, PxT)

When a pack is **not** set (omit / `null` / `""` after a clear):

```text
{media_dir}/{file}
```

When a pack **is** set:

```text
{media_dir}/{id}/{file}
```

`id` is the catalog Version ID, stringified with no leading zeros (`1` not `01`). `file` may contain
subdirectories (`elevator/vo_01_intro.mp3`). Absolute `file` values skip the insert.

INI `media_dir` / `media_base_dir` stays the room `media/` **root**, never `…/media/1`. EDN `:file`,
NVS FX maps, and PxT variant keys never contain the pack id.

**Sanitize `mediaId`:** JSON number or decimal string matching `^[1-9][0-9]{0,8}$`. Reject `0`,
leading zeros, `/`, `..`, empty, or slugs like `v1`. On reject: ignore the command, publish
`warnings`, keep the previous pack. Players do not look up the catalog; they only insert the integer.

PxC does **not** prefix `media_dir`. A pack maps to a prebuilt clock URL / bundle. PxS uses the
catalog language code; it has no media path. PxO echoes `mediaId` on start / passport / state / JSONL
and does **not** rewrite `:file`.

### Command `switchMedia`

Published to each **supporting process** `{base}/commands` (PFx **zone** topic that already accepts
`playVideo`, plus PxT / PxC / PxS process commands).

```json
{
  "command": "switchMedia",
  "mediaId": 2,
  "refresh": false
}
```

| Field | Required | Default | Meaning |
|-------|----------|---------|---------|
| `mediaId` | yes | — | Catalog Version ID (integer). To clear the pack (legacy `{media_dir}/{file}`), send `mediaId: null` on `switchMedia` only. |
| `refresh` | no | `false` | If `true`, reload currently active stills / beds / loops / wait video from the new pack. If `false`, keep what is playing; the next `play*` / `setImage` uses the new pack. |

Unknown extra fields are ignored (suite norm). Apps that have not implemented the command ignore it
(unknown command) and must **not** tear down the process.

PxS may also receive `language` from the pack catalog (`en` / `es` / …). File-based apps do not need
`language`.

### Command `start` (and chamber `start`)

Supporting processes **and** PxO `start` accept the same optional fields:

```json
{
  "command": "start",
  "mediaId": 2,
  "refresh": false
}
```

When omitted, start does not change the process’s retained pack. When present, it is equivalent to
`switchMedia` immediately before the rest of start.

PxM attaches the **group’s** `mediaId` on every chamber `start` / handoff `start`.

### Retained `{base}/state`

If a pack has ever been set, include it on the retained snapshot (and on change):

```json
{
  "mediaId": 2
}
```

Omit `mediaId` entirely when unset so old UIs and old rooms see today’s payload.

Also publish a non-retained `{base}/events` receipt:

```json
{
  "event": "mediaSwitched",
  "mediaId": 2,
  "refresh": false,
  "refreshed": ["background", "default_image"]
}
```

`refreshed` is the list of active layers actually replaced (empty when `refresh` is false).

Missing files: existing “file not found” warning. Do not crash. Do not invent a silent fallback pack.

---

## 10. Where to read more

| Concern | Doc |
|---------|-----|
| PxO game / zone API | `apps/PxO/docs/MQTT_API.md` |
| PFx / PFxE / PxIO / PxB / PxC / PxT / **PxS** | each app’s `docs/MQTT_API.md` (or CONFIG / SPEC) |
| PxH host MQTT | `apps/PxH/docs/API.md`, `SPEC.md` |
| PxD topicRoot / warningTopics | `apps/PxD/docs/ROOMS.md` |
| Room media file inventory | [ROOM-MEDIA-CATALOG.md](ROOM-MEDIA-CATALOG.md) |
| SpyCatcher full map | `rooms/spycatcher/docs/MQTT-TOPICS.md` |
| Prop firmware | each prop’s `docs/api.md` / `functional-spec.md` |

---

## 11. Propagation duty

If you change this file (or discover that another repo documents a conflicting suite MQTT
meaning):

1. Update **this** document (and [README.md](README.md) index if adding a new standards file).
2. Update affected app/room/prop docs in the **same** change set.
3. Ensure every repo’s `AI-INSTRUCTIONS.md` still points at **`docs/standards/`** (the folder).

This folder holds **public** suite contracts and the sanitized suite AI brief only. Internal
triage, business roadmaps, and cross-cutting pending plans live in the private **Px-Suite** repo
when present — do not add them here.

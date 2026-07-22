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

## 7. Where to read more

| Concern | Doc |
|---------|-----|
| PxO game / zone API | `apps/PxO/docs/MQTT_API.md` |
| PFx / PFxE / Pio / PxB / PxC / PxT | each app’s `docs/MQTT_API.md` (or CONFIG) |
| PxH host MQTT | `apps/PxH/docs/API.md`, `SPEC.md` |
| PxD topicRoot / warningTopics | `apps/PxD/docs/ROOMS.md` |
| SpyCatcher full map | `rooms/spycatcher/docs/MQTT-TOPICS.md` |
| Prop firmware | each prop’s `docs/api.md` / `functional-spec.md` |

---

## 8. Propagation duty

If you change this file (or discover that another repo documents a conflicting suite MQTT
meaning):

1. Update **this** document (and [README.md](README.md) index if adding a new standards file).
2. Update affected app/room/prop docs in the **same** change set.
3. Ensure every repo’s `AI-INSTRUCTIONS.md` still points at **`docs/standards/`** (the folder).

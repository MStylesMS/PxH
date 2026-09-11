# Room media inventory (`media/CATALOG.md`)

_Canonical._ Hosted in PxH so every room machine that runs Health Monitor has this file.
Operator-facing pack-switch context: room `docs/SUITE-MEDIA-PACK.md` (TFD) and
[MQTT-CONTRACT.md](MQTT-CONTRACT.md) § Media pack.

**Change control:** see [README.md](README.md).

---

## Rule (soft)

Every Paradox **room package** should keep **one** media inventory at:

```text
<room>/media/CATALOG.md
```

Not scattered per chamber. Not a second copy inside `elevator/`, `generator/`, or a PxT variant
folder. Agents and developers read this file when they touch media, EDN `:file` values, or PFx/PxT
INI `default_image` / wait-intro clips.

**Soft enforcement:** required for **new** rooms and for **new media work** on existing rooms.
Existing rooms without a catalog are not a CI failure. A warning-level check (or agent guidance:
“read `media/CATALOG.md` when touching media”) is appropriate. Do **not** add a hard CI gate that
would block Agent22 / SpyCatcher / Houdini until they opt in.

When the file is missing, agents should still look at the `media/` tree and EDN `:file` values, then
**create or update** `CATALOG.md` as part of that media change.

---

## Filename

Preferred name: **`CATALOG.md`**. Do not invent `INVENTORY.md`, `MEDIA.md`, or per-chamber catalogs
unless a room already has a published equivalent — then add a one-line pointer at
`media/CATALOG.md` to that file and migrate when convenient.

---

## What to list

Every media **file** the room ships or references (used cues, GM hint banks, idle stills, beds, PxT
theme/game trees). For each row:

| Column | Required | Meaning |
|--------|----------|---------|
| Path | yes | Relative to `media/` (include the pack id folder when packs exist, e.g. `1/elevator/vo_01_intro.mp3`) |
| Description | yes | What it is and when it is used (cue, idle, GM hint, spare, master, wallpaper) |
| Transcript | if speech | Verbatim or close transcript for VO, on-camera dialogue, and TTS-originated lines. Silent stills, beds, and FX: omit or write `none` |

Spare / unused files may be grouped under a short “Spare” subsection rather than a row per file, as
long as paths are listed.

Masters (transcode sources) belong in the catalog; they are not spare.

---

## Not the same as

| Document | Job |
|----------|-----|
| **This file** (`media/CATALOG.md`) | Human/AI inventory of **files on disk** and what they contain |
| **PxM pack catalog** (`[media.<id>]` in `pxm.ini`, retained `mediaCatalog`) | Pack **id / name / language** for the GM switcher. Does not list files or transcripts |
| **`rename-manifest.json`** (TFD) | Historical old→new path map from a one-time rename. Not loaded at runtime; not a substitute for `CATALOG.md` |

Do not put pack ids into EDN `:file` strings. Do not treat PxM `mediaCatalog` as a file inventory.

---

## Example skeleton

```markdown
# Media catalog — <room slug>

Inventory for developers and AI agents. Paths are relative to this `media/` folder.
Pack layout (when used): `{id}/{chamber-or-area}/…`. See suite MQTT-CONTRACT “Media pack”.

## Pack 1 (English)

| Path | Description | Transcript |
|------|-------------|------------|
| `1/elevator/vo_01_intro.mp3` | Elevator intro VO after doors close | "Welcome aboard. Hold the rail — we are going down." |
| `1/elevator/img_00_idle-begin.png` | Idle still before start | none |
| `1/generator/bed_00_room.mp3` | Looping room bed | none |
| `1/mine/theme/theme.css` | PxT theme (do not rename) | none |

## Pack 2 (optional)

Same relative names under `2/…`. List only files that exist in this pack, or note “mirrors pack 1 except VO”.

## Not yet on disk

| Path | Description | Transcript |
|------|-------------|------------|
| `1/elevator/vo_60_wait-gen-1.mp3` | EDN references this; file missing | TBD |
```

---

## Agents

When adding, renaming, or retargeting media:

1. Read `media/CATALOG.md` if it exists.
2. Keep paths pack-free in EDN / NVS (`elevator/vo_01_intro.mp3`, not `1/elevator/…`).
3. Update the catalog in the same change as the files or `:file` retarget.
4. If the room has never had a catalog, create one covering at least the files you touched, then
   fill the rest when practical.

# Suite standards (hosted in PxH)

This folder is the **canonical home for Paradox suite-wide public contracts and the suite AI
brief** that every app, room, and prop must honour. It lives under **PxH** so any machine that
installs Paradox Health Monitor also carries the standards (venue installs do not sync the
suite-root `paradox/` workspace folder).

**Not in this folder:** internal roadmaps, triage notes, or cross-cutting pending plans. Those
belong in the private **Px-Suite** repo on machines that have it checked out — never ship them
inside distributed PxH.

## Documents

| Document | Purpose |
|----------|---------|
| [AI-INSTRUCTIONS.md](AI-INSTRUCTIONS.md) | Sanitized whole-suite AI brief (system map, conventions) |
| [MQTT-CONTRACT.md](MQTT-CONTRACT.md) | MQTT topic trees, retain rules, prop announce vs state, host `system/*` vs room warnings |

Add new suite-wide **public** standards here as separate markdown files and list them in this table.

## Change control (required)

1. **Edit the standard in this folder first** — never invent a competing suite MQTT (or other
   shared) meaning only in an app/room/prop repo.
2. **Propagate in the same effort** — update consuming docs (`MQTT_API.md`, room topic maps,
   prop specs) and keep each repo’s `AI-INSTRUCTIONS.md` pointer to **this folder** (not a
   single file).
3. If behaviour already shipped disagrees with a document here, fix the doc or the code in a
   coordinated change; do not leave silent drift.

Agents and humans: before changing MQTT topics or shared conventions, **read this folder**.

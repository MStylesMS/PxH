# Paradox Health Monitor — Quick setup

After [INSTALL.md](INSTALL.md), edit `/opt/paradox/config/pxh.ini`.

## 1. Machine identity

```ini
[machine]
id = agent22
hostname = agent22
```

`id` appears in MQTT as `paradox/<id>/system/...`. Use a stable short name shared with other Paradox apps on this host.

## 2. MQTT broker

```ini
[mqtt]
enabled = true
broker = mqtt://127.0.0.1:1883
topic_root = paradox
```

Point `broker` at a remote URL when Mosquitto is not local. Soft-fails if the broker is down (API/UI still work).

## 3. Services list

Trim `[services] required` / `optional` / `user` to units that exist on this host. Missing units show as `unknown`, not a crash.

After login, each unit shows contextual **Start** or **Stop**, **Restart**, and **Enable** or **Disable**. Prefer the nginx URL `http://<host>/health/` once `/health/` and `/health-api/` are merged into the venue site config.

## 4. Bind / viewing

Default `host = 0.0.0.0` so LAN and Tailscale clients can **view** metrics without login.
Only maintenance actions require a local OS username/password (PAM) and a session cookie.

## 5. sudoers (required for actions)

Confirm:

```bash
sudo -u paradox sudo -n true
sudo visudo -cf /etc/sudoers.d/paradox-health
```

If `sudoNopasswd` in `/metrics` is `false`, fix sudoers before relying on Upgrade / Reboot / Cleanup / Prune from the UI.

## 6. First login (actions)

1. Open System Health UI
2. Click **Login** (or any action) → enter a local Linux username/password on this Pi
3. Session lasts `[actions] session_hours` (default 12)
4. Optional: `allowed_users = paradox,mark` to restrict who may authenticate

## 7. IDE prune

```ini
[prune]
schedule = low_disk    ; or weekly | manual_only
interval_hours = 24
```

When `schedule` is `low_disk` or `weekly`, PxH prunes at **startup** and every `interval_hours` (and on low disk when `low_disk`). UI dry-run/execute still need a logged-in session.

## 8. UPS (optional)

When a USB UPS is attached (CyberPower / APC / other NUT-supported):

1. Install NUT (`nut-client`, `nut-server`), configure `usbhid-ups`, `MODE=standalone`.
2. Confirm `upsc <name>@127.0.0.1` shows `battery.charge` and `battery.runtime`.
3. Enable in `pxh.ini`:

```ini
[ups]
enabled = true
backend = nut
nut_ups = cyberpower@127.0.0.1
```

4. Restart `paradox-health`. System Health UPS tile should show runtime minutes and a
   two-line subtitle like:

   ```
   Batt. 100% · On AC
   Load 19% · 125 W
   ```

   (watts when NUT reports or can estimate from load × nominal).

See [SPEC.md](SPEC.md) §9–10 and [API.md](API.md) for UPS telemetry. Soften NUT `upsmon`
`SHUTDOWNCMD` if you want telemetry only (default can halt the host on low battery).

## 9. Smoke checklist (§13)

- [ ] `paradox-health` is active
- [ ] UI shows non-null disk % with color bands
- [ ] Crossing warn publishes `…/system/alerts`
- [ ] Required services show running/stopped/failed
- [ ] Warnings panel shows live `/warnings` traffic
- [ ] IDE prune dry-run lists builds; execute requires login
- [ ] Theme day/night/auto + header toggle
- [ ] If UPS configured: tile shows Batt. % / On AC (or On battery) and watts when available

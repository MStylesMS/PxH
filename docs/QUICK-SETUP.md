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

## 8. Smoke checklist (§13)

- [ ] `paradox-health` is active
- [ ] UI shows non-null disk % with color bands
- [ ] Crossing warn publishes `…/system/alerts`
- [ ] Required services show running/stopped/failed
- [ ] Warnings panel shows live `/warnings` traffic
- [ ] IDE prune dry-run lists builds; execute requires login
- [ ] Theme day/night/auto + header toggle

# Plan 10 — Premium notifications & remote summary (PxP)

**Owner:** PxP (paid tier) · **Priority:** P2 · **Status:** pending review  
**Not PxH MVP.**

## Ideas

A) Push selected critical alerts to Telegram / Signal / etc. (owner/tech roles)  
B) Push summary to external MQTT or hardened remote webpage  

## Recommendation (business)

- **Do not** put IM bridges in PxH (keeps host agent small; secrets/token sprawl on every Pi).  
- **Do** put orchestration in **paid PxP** (or a future always-on **PxP companion service** on one
  trusted machine) that *subscribes* to `paradox/+/system/alerts` and room `/warnings`.  
- Free tier: rely on LAN PxH + Tailscale + MQTT already on-site.

## Open questions

- Which roles receive which severities (see PxP SECURITY roles)  
- Whether a tiny always-on “PxP-Notify” / audit helper is required if desktop PxP is not daily  

## Acceptance (future)

Documented SKU boundary; no tokens stored in `pxh.ini` on store Pis for cloud IM.

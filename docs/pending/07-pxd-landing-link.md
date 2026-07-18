# Plan 07 — PxD landing link to System Health

**Owner:** PxD (+ room packages) · **Priority:** P1 · **Status:** pending review

## Goal

Every packaged landing page can expose **System Health** without requiring PxH to be mandatory.

## Proposed approach (simple)

1. Add an optional entry in starter / example `room.json` (or landing sites list), e.g. title
   “System Health”, path `/health/` (comment in template: use `http://<host>:19090/ui/` if nginx
   not configured).
2. Document in PxD user guide: comment out if host has no PxH.
3. Agent22 (or one production room) enables it as reference.

## Acceptance

- Template shows the pattern; at least one room package documents the link
- No hard dependency: landing still builds if link removed

## Out of scope

Auto-detecting PxH presence at package time.

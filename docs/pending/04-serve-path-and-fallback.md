# Plan 04 — Serve path: nginx preferred, PxH port fallback

**Owner:** PxH · **Priority:** P0 · **Status:** pending review

## Question

If nginx is monitored (and can be down), should health depend on nginx?

## Decision (proposed)

| Path | Role |
|------|------|
| `http://<host>/health/` + `/health-api/` | **Preferred** operator URL via nginx |
| `http://<host>:19090/ui/` + API | **Always available** fallback (PxH serves UI) |

**Do not** auto-bind :80/:443 when nginx fails (permissions, conflict, surprise).

Optional: when UI loaded via :19090, probe `GET /health/` through nginx and show “nginx path
degraded” banner.

## Acceptance

- With nginx stopped, :19090/ui still loads metrics
- Docs/install tell operators both URLs
- pi5-ssd coexistence does not steal :19090 (→ [09](09-pi5-ssd-coexistence.md))

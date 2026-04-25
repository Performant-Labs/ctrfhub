# [CI-002] Docker Compose files (dev + prod + SQLite) + .env.example

## Summary

Lays in the three deployment-mode compose files (`compose.dev.yml`, `compose.yml`, `compose.sqlite.yml`), a minimal `Dockerfile.dev` for the dev stack, and an `.env.example` mirroring `deployment-architecture.md §Environment variables` (the canonical list). Pure infrastructure config — no `src/`, no tests, no migrations. Unblocks CI-003 (Tugboat per-PR previews build from `compose.yml`).

## Acceptance criteria

- [x] `compose.dev.yml` — app service running with `tsx watch` + Tailwind `--watch`, Postgres as a sidecar service.
- [x] `compose.yml` — production-like. App service uses `image: ghcr.io/ctrfhub/ctrfhub:${CTRFHUB_TAG:-latest}`. Postgres has a named volume. `stop_grace_period: 30s` on the app service.
- [x] `compose.sqlite.yml` — single container (just the app, no Postgres service). SQLite file in a named volume.
- [x] `.env.example` — every env var named in `deployment-architecture.md §Environment variables` (canonical per `architecture.md` L272), with placeholder values and one-line comments.
- [x] `healthcheck` in compose definitions hits `/health` (INFRA-002's `GET /health`).

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | no (meta — config only) | N/A | None expected per brief L31; existing 188 tests across 8 files remain green. |
| Integration | no (meta — config only) | N/A | None expected per brief L31. |
| E2E | no (meta — config only) | N/A | None expected per brief L31. |

CI-002 is a configuration-only story. The brief and `tasks.md` §CI-002 both declare "Test tiers required: none (meta — configuration only)." Spec-enforcer confirmed coverage matches what the story declared.

## Page verification tiers

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | no — no rendered routes touched | N/A | n/a |
| T2 ARIA (clean room) | no — no rendered routes touched | N/A | n/a |
| T2.5 Authenticated State | no — no rendered routes touched | N/A | n/a |
| T3 Visual | no — no rendered routes touched | N/A | n/a |

## Decisions that deviate from spec

- **Healthcheck port substitution form.** `deployment-architecture.md` L142 uses the docker-compose-escaped form `$$PORT` in healthcheck `curl` lines; the implementation uses `${PORT:-3000}` (explicit default fallback). Functionally equivalent in compose v3.x — both resolve to the running service's port — but the implementation form is more defensive: it boots cleanly even if `PORT` is unset, which can happen on bare `docker compose up` in dev. Spec-enforcer flagged as NIT only; no remediation required.
- **`.env.example` carries `SQLITE_PATH` and `TUGBOAT_API_TOKEN` in addition to the 27 canonical vars.** `SQLITE_PATH` is from `architecture.md` L260 (SQLite-only); `TUGBOAT_API_TOKEN` was already present in the prior `.env.example` for CI-003 work. Both retained intentionally.

## Gaps filed during this story

- **G-P1-006** — `RETENTION_CRON_SCHEDULE` default conflict between `architecture.md` L261 (`0 2 * * *`) and `deployment-architecture.md` L233 (`0 3 * * *`). `architecture.md` L272 declares `deployment-architecture.md` canonical, so `.env.example` follows `0 3 * * *`. Both docs should agree; André to reconcile. Severity P1 (factual/contradiction). Logged in `docs/planning/gaps.md`.

## Spec-enforcer verdict

**PASS** — see `.argos/CI-002/spec-audit.md`
**Date:** 2026-04-25

## Next assignable stories (after this merges)

- **CI-001** — CI workflow (publishes `ghcr.io/ctrfhub/ctrfhub` image; depends only on INFRA-001 — already mergeable, can land in either order with this).
- **CI-003** — Tugboat per-PR preview + dog-food CTRF ingestion. Now unblocked on CI-002, but still needs **AUTH-001** (deployable login) and **CI-001** (image to pull) before it can start.
- **AUTH-001** — Better Auth integration. In flight in a parallel workspace per the CI-002 brief; once it merges, AUTH-002/003, CTRF-001 follow-ups, and CTRF-002 light up.

---
_Generated from `.argos/CI-002/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._

# Spec-enforcer Audit — CI-002

**Executed:** 2026-04-25 14:17
**Scope:** diff `main..story/CI-002`
**Checklists run:** Architecture rules (subset relevant to infra-config story), Planning docs conformance, Anti-pattern scan (from brief)

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `compose.dev.yml:50`, `compose.yml:62`, `compose.sqlite.yml:47` | `deployment-architecture.md` line 142: healthcheck uses `$$PORT` (raw env ref) | Implementation uses `${PORT:-3000}` with an inline default fallback instead of `$$PORT`. Both are functionally correct; the implementation form is more defensive (explicit default). No action required. | **NIT** |
| 2 | `.env.example:148` | `architecture.md` line 261 says `RETENTION_CRON_SCHEDULE` default is `0 2 * * *`; `deployment-architecture.md` line 233 says `0 3 * * *` | `.env.example` uses `0 3 * * *`, which matches the **canonical** source (`deployment-architecture.md` — per `architecture.md` line 272: "deployment-architecture.md is the canonical list"). This is a **spec conflict in the planning docs**, not a CI-002 defect. Flag for Argos to reconcile. | **NIT** |

**No blocking findings.**

## Coverage gaps

**Coverage matches the story's declared Test tiers required and Page verification tiers.**

CI-002 is a configuration-only story. The brief (line 31) declares "Test tiers required: None (meta — configuration only)." The test-handoff confirms "No test tiers required" with rationale. No application code, routes, Zod schemas, pure functions, or UI templates were created or modified — no test coverage is expected.

Existing test suite verified green: 8 test files passed, 188 tests passed, 0 failures (per test-handoff).

## Planning-doc conformance (only lines relevant to this story's scope)

### Acceptance criteria (from `tasks.md` §CI-002)

- [x] `compose.dev.yml` — app with `tsx watch`, Tailwind `--watch`, Postgres sidecar ✅
- [x] `compose.yml` — prod, `ghcr.io/ctrfhub/ctrfhub` image, Postgres named volume, `stop_grace_period: 30s` ✅
- [x] `compose.sqlite.yml` — single container, SQLite, no Postgres service ✅
- [x] `.env.example` — every env var from `deployment-architecture.md §Environment variables` present and documented ✅
- [x] `healthcheck` in all compose files uses `/health` endpoint ✅

### Env var completeness (`deployment-architecture.md` §Environment variables — canonical list)

All 27 variables from the canonical list verified present in `.env.example`:

`DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `EVENT_BUS`, `REDIS_URL`, `MAX_CTRF_JSON_SIZE`, `MAX_ARTIFACT_SIZE_PER_RUN`, `ARTIFACT_STORAGE`, `ARTIFACT_LOCAL_PATH`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `ARTIFACT_CORS_ORIGINS`, `ARTIFACT_PUBLIC_URL`, `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_CLOUD_PIPELINE`, `ALLOW_PRIVATE_WEBHOOK_DESTINATIONS`, `ALLOW_INSECURE_WEBHOOK_DESTINATIONS`, `PUBLIC_URL`, `PORT`, `LOG_LEVEL`, `DEFAULT_TIMEZONE`, `RETENTION_CRON_SCHEDULE`

Additionally present (correct):
- `SQLITE_PATH` — from `architecture.md` line 260
- `TUGBOAT_API_TOKEN` — carried forward from original `.env.example`

### Architecture doc alignment

- [x] `compose.dev.yml` uses `tsx watch` + Tailwind CLI `--watch` — matches `architecture.md` §Local Development (lines 158-177) ✅
- [x] `compose.yml` uses `ghcr.io/ctrfhub/ctrfhub:${CTRFHUB_TAG:-latest}` — matches `architecture.md` §Production Deployment (lines 207-226) ✅
- [x] `compose.sqlite.yml` has no `db` service, no `worker`, no `redis` — matches `deployment-architecture.md` §SQLite deployment (lines 245-266) ✅
- [x] `stop_grace_period: 30s` on `compose.yml` and `compose.sqlite.yml` — matches `architecture.md` §Graceful shutdown (lines 381-387) ✅
- [x] `compose.dev.yml` exposes Postgres port 5432 to host for DB GUI clients — matches `deployment-architecture.md` line 241 ✅
- [x] `Dockerfile.dev` uses `node:22-alpine` base — matches `architecture.md` runtime choice (line 7) ✅
- [x] No prod `Dockerfile` created — CI-001's territory per brief ✅

## Forbidden-pattern scan (from brief §Anti-patterns)

- [x] No hardcoded secrets / API keys / passwords in compose files or `.env.example` — all use `${VAR}` placeholders with documented defaults ✅
- [x] No Postgres-only assumptions in `compose.sqlite.yml` — no `pg_isready`, no PG connection strings (only a `# No Postgres...` comment references it) ✅
- [x] No dev/prod setting mixing — `tsx watch` only in `compose.dev.yml`; `ghcr.io` image only in `compose.yml` and `compose.sqlite.yml` ✅
- [x] `healthcheck:` present in all compose files ✅
- [x] No prod `Dockerfile` — only `Dockerfile.dev` ✅
- [x] No `src/` files touched — pure infrastructure config ✅
- [x] No `restart: always` on any app service ✅

## Forbidden-pattern scan (from CLAUDE.md / Audit Checklist)

The following checks from the full Audit Checklist are **not applicable** to CI-002 (no `src/`, no templates, no routes, no entities, no tests were created or modified). Listed for completeness:

- N/A — No `hx-target`/`hx-swap` (no templates in diff)
- N/A — No raw HTMX event names (no TypeScript in diff)
- N/A — No `hx-disable` (no templates in diff)
- N/A — No Alpine `x-data` inside HTMX swap targets (no templates in diff)
- N/A — No Postgres-only column types (no entities in diff)
- N/A — No `fastify.orm.em` usage (no route handlers in diff)
- N/A — No missing Zod schemas (no routes in diff)
- N/A — No duplicate interfaces alongside Zod schemas (no TypeScript in diff)
- N/A — No `/api/artifact` endpoint (no routes in diff)
- N/A — No `dark:` Tailwind variant (no templates in diff)
- N/A — No raw utility soup (no templates in diff)
- N/A — No AI API calls in tests (no tests in diff)
- N/A — All `afterAll(() => app.close())` (no tests in diff)
- N/A — Bulk insert 500-row chunked pattern (no ingest code in diff)

## Verdict

**PASS** — story may proceed to Argos Phase 7 close-out and PR open.

No blocking findings. Two NITs documented:
1. Healthcheck `${PORT:-3000}` form vs spec's `$$PORT` form — implementation is more defensive; no change needed.
2. `RETENTION_CRON_SCHEDULE` default discrepancy between `architecture.md` (02:00) and `deployment-architecture.md` (03:00) — implementation correctly follows the canonical source; Argos should reconcile the spec conflict.

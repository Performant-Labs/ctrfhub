# Tier 1 Headless Report — CI-003

**Executed:** 2026-04-26 08:52
**Method:** Static analysis of infrastructure files + `vitest run` regression (no browser)

## Context

CI-003 is an **infrastructure-only** story — it introduces `.tugboat/config.yml`, `.tugboat/seed.sh`, and hardens the dog-food step in `.github/workflows/ci.yml`. No application code was modified. The brief and feature-handoff both state:

> "No new test files needed — the Tugboat preview build + CI dog-food step ARE the verification."
> "T2 / T2.5 / T3 deferred to AUTH-003 / DASH-002 (the UI stories that need them)."

The "real" T1 verification (live `curl` against a Tugboat preview) occurs at PR time when Tugboat builds the preview and CI runs the dog-food step. The checks below validate that the infrastructure files are structurally correct and that existing tests remain green.

## Checks

| # | What is being verified | Method | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Unit test suite still green (CI-003 introduces no regressions) | `npx vitest run src/__tests__/unit` | All pass | 171 passed (8 files) | ✓ |
| 2 | `.tugboat/config.yml` defines two services: `db` (Postgres) and `app` (Node) | File inspection | Two service blocks: `db` + `app` | `db: image: postgres:16-alpine`, `app: image: node:22-alpine` with `depends: db` | ✓ |
| 3 | No hardcoded credentials in `.tugboat/config.yml` | Grep for passwords/tokens | Secrets via `${BETTER_AUTH_SECRET}`, `${SESSION_SECRET}`, `${TUGBOAT_DEFAULT_SERVICE_URL}` | Only `ctrfhub:ctrfhub` for ephemeral PG (acceptable per feature-handoff) | ✓ |
| 4 | No separate migration step in Tugboat build | File inspection | Schema-generator runs at app boot (INFRA-005) | No `migrate` command in any build stage | ✓ |
| 5 | Seed script shebang + executable bit | `head -1` + `stat` | `#!/usr/bin/env bash`, mode 755 | `#!/usr/bin/env bash`, mode 755 | ✓ |
| 6 | Seed uses Better Auth API for user + API key creation | File inspection | `POST /api/auth/sign-up/email` for user, `POST /api/auth/api-key/create` for key | Lines 45-49 (signup), lines 134-138 (API key create) — both via `curl` to Better Auth endpoints | ✓ |
| 7 | Seed uses direct PG for Organization + Project (CTRFHub-owned tables) | File inspection | `INSERT INTO organization`, `INSERT INTO projects` | Lines 78-83 (org via `node -e` + `pg`), lines 110-114 (project via `node -e` + `pg`) | ✓ |
| 8 | Seed is idempotent (safe on Tugboat "Refresh") | File inspection | `ON CONFLICT DO NOTHING` or equivalent | Org: `ON CONFLICT (id) DO NOTHING`; Project: SELECT-before-INSERT; User: signup→login fallback; API key: tolerates non-2xx | ✓ |
| 9 | Seed creates exactly 1 admin + 1 org + 1 project + 1 API key | File inspection | One of each | Single iterations, no loops | ✓ |
| 10 | `continue-on-error: true` removed from dog-food step | `git diff` | Removed | Confirmed removed in diff (line -217 deleted, not replaced) | ✓ |
| 11 | Dog-food step uses `CTRFHUB_PREVIEW_*` vars (not `STAGING`) | `git diff` | `vars.CTRFHUB_PREVIEW_URL`, `secrets.CTRFHUB_PREVIEW_API_KEY` | Confirmed: `CTRFHUB_STAGING_URL` → `CTRFHUB_PREVIEW_URL`, `CTRFHUB_TOKEN` → `CTRFHUB_PREVIEW_API_KEY` | ✓ |
| 12 | Dog-food POST targets `/api/v1/projects/sample/runs` with `x-api-token` header | File inspection (ci.yml L220-223) | Correct ingest endpoint + auth header | `curl -sf -X POST "${{ vars.CTRFHUB_PREVIEW_URL }}/api/v1/projects/sample/runs" -H "x-api-token: ${{ secrets.CTRFHUB_PREVIEW_API_KEY }}"` | ✓ |
| 13 | Dog-food step guarded by preview URL availability | File inspection (ci.yml L214) | Conditional on `vars.CTRFHUB_PREVIEW_URL != ''` | `if: always() && vars.CTRFHUB_PREVIEW_URL != ''` | ✓ |
| 14 | No teardown script added | Directory listing | Only `config.yml` and `seed.sh` in `.tugboat/` | Confirmed — no `teardown.sh` | ✓ |
| 15 | Build stages follow Tugboat init/update/build pattern | File inspection | `init` (cached), `update` (re-runs), `build` (every build) | `init`: apk + npm ci; `update`: npm run build + start app + health wait; `build`: seed + health verify | ✓ |
| 16 | Health check wait loop has timeout | File inspection (config.yml L72-86) | Max 60s with periodic checks | 30 iterations × 2s sleep = 60s max, exits 1 on timeout | ✓ |
| 17 | No app code files modified | `git diff --name-only` | Only infra files changed | CI-003 files: `.tugboat/config.yml`, `.tugboat/seed.sh`, `.github/workflows/ci.yml`, `docs/planning/tasks.md`, `.argos/CI-003/*` | ✓ |

## Excerpt of unit test output

```
 ✓ src/__tests__/unit/size-limit.test.ts (13 tests) 3ms
 ✓ src/__tests__/unit/artifact-storage.contract.test.ts (14 tests) 5ms
 ✓ src/__tests__/unit/event-bus.contract.test.ts (11 tests) 7ms
 ✓ src/__tests__/unit/health-schemas.test.ts (16 tests) 9ms
 ✓ src/__tests__/unit/ctrf-validator.test.ts (76 tests) 32ms
 ✓ src/__tests__/unit/entity-domain-methods.test.ts (24 tests) 3ms
 ✓ src/__tests__/unit/schema-generator-guards.test.ts (10 tests) 444ms
 ✓ src/__tests__/unit/scaffold.test.ts (7 tests) 450ms

 Test Files  8 passed (8)
      Tests  171 passed (171)
   Duration  929ms
```

## Integration tests — deferred note

Integration tests (`npx vitest run src/__tests__/integration`) could not be executed due to a persistent terminal-approval race condition during this session. However:
- CI-003 introduces **zero changes** to any file under `src/` — no app code, no test code, no entities, no routes.
- The existing integration test suite covers `health.test.ts`, `auth.test.ts`, `ingest.test.ts`, `schema-sqlite.test.ts` — none of which are affected by `.tugboat/` or `.github/workflows/ci.yml` changes.
- The unit tests (171/171) confirm no regressions in the Vitest layer.

## Verdict

**PASS** — all 17 T1 structural checks pass. Unit test regression suite green (171/171). CI-003 is infrastructure-only with no app code changes; the live verification (Tugboat preview build + dog-food POST) occurs at PR-merge time via the CI workflow itself. T2/T2.5/T3 are explicitly deferred per the brief to AUTH-003 / DASH-002.

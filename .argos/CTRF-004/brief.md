# CTRF-004 — CI reporter packages (Playwright + Cypress)

**Branch:** `story/CTRF-004`
**Depends on:** CTRF-002 ✅ (ingest contract), CTRF-003 ✅ (artifact co-upload)
**Specialist roster:** F = `implementor` · T = `test-writer` · S = `verifier` · Shepherd = `pr-shepherd`
**Test budget:** ≤15 integration tests, ≤7 unit tests per reporter package. No E2E. No page verification tiers.

## Goal

Ship two thin reporter packages under a new `packages/` monorepo (npm workspaces) that wrap the existing upstream CTRF reporters and POST results to CTRFHub's ingest endpoint. Plus a runnable GitHub Actions example. Verified by an integration test proving Playwright reporter, Cypress reporter, and a raw `POST` to ingest produce identical stored `TestRun` + `TestResult` records against the same fixture.

## Acceptance criteria

1. Root `package.json` gains `"workspaces": ["packages/*"]` and root `npm install` produces working symlinks.
2. `packages/playwright-reporter/` exists as `@ctrfhub/playwright-reporter` (`"private": true`).
3. `packages/cypress-reporter/` exists as `@ctrfhub/cypress-reporter` (`"private": true`).
4. Each reporter:
   - Wraps the upstream reporter (`playwright-ctrf-json-reporter` and `cypress-ctrf-json-reporter` respectively).
   - Reads `CTRFHUB_INGEST_URL` and `CTRFHUB_API_TOKEN` from env at run end.
   - POSTs the generated CTRF JSON to `<CTRFHUB_INGEST_URL>/api/v1/projects/<slug>/runs` with `x-api-token` header (slug derived from `CTRFHUB_PROJECT_SLUG` env).
   - Sends `Idempotency-Key` header containing a deterministic hash of the run (so reruns of the same CI job produce a 200 + `X-Idempotent-Replay: true` second time).
   - Logs (stderr) success / failure with the returned `runId` or error code; never throws into the test runner.
   - On non-2xx: logs and exits 0 (CI rule — uploading to CTRFHub must never fail the pipeline).
5. `examples/github-actions/playwright.yml` and `examples/github-actions/cypress.yml` exist with:
   - `secrets.CTRFHUB_API_TOKEN` and a documented `CTRFHUB_INGEST_URL` env.
   - Realistic `actions/checkout` + `setup-node` + test-run + reporter-config snippets.
6. Integration test `src/__tests__/integration/reporter-equivalence.test.ts` proves all three ingest paths (raw POST, in-process Playwright reporter, in-process Cypress reporter) produce byte-equivalent stored `TestRun` + `TestResult` rows for one canned fixture. Use the test orm/server pattern already in `src/__tests__/integration/`.
7. `tsc --noEmit` clean across root + workspaces. `npm run lint` clean.
8. `tasks.md` row `[ ] CTRF-004` flips to `[x] CTRF-004` on the story branch via a `chore(CTRF-004): complete` commit.
9. `.argos/CTRF-004/{brief,feature-handoff,test-handoff,tier-1-report,spec-audit,pr-body}.md` all exist on the branch (this brief is the first).

## Files in scope

- `package.json` (root) — add `workspaces` only; do NOT touch other fields.
- `packages/playwright-reporter/{package.json,src/index.ts,src/http.ts,README.md,tsconfig.json}` — new.
- `packages/cypress-reporter/{package.json,src/index.ts,src/http.ts,README.md,tsconfig.json}` — new.
- `examples/github-actions/playwright.yml` — new.
- `examples/github-actions/cypress.yml` — new.
- `src/__tests__/integration/reporter-equivalence.test.ts` — new (Test Writer wave only; do NOT pre-write in F).
- `src/__tests__/unit/reporter-{playwright,cypress}.test.ts` — new (Test Writer wave only).
- `tasks.md` — flip checkbox at completion (Argos PR-prep step, not F).

## Anti-patterns (forbidden — instant audit BLOCK)

- ❌ Modifying `src/modules/ingest/**` — the ingest contract is frozen by CTRF-002.
- ❌ Building a CTRF emitter from scratch — the directive is **wrap**, not rewrite.
- ❌ Throwing from the reporter on HTTP failure (must log + swallow).
- ❌ Adding any UI surface (`src/views/`, `src/migrations/`, etc.).
- ❌ Adding new ingest semantics or new endpoints. The reporter packages must consume the existing public contract verbatim.
- ❌ Hardcoding a URL or token. Env-var only.
- ❌ Naming packages `@ctrf/*` or anything other than `@ctrfhub/*` (this is **CTRFHub** the product).
- ❌ Adding `"workspaces"` plus `"private": true` at the root. Root stays publishable; only `packages/*` are private.
- ❌ Mocking the DB in the integration test (use the real schema-generated test DB, per `skills/integration-testing.md`).

## HTTP contract reference (from CTRF-002, frozen)

- Endpoint: `POST <CTRFHUB_INGEST_URL>/api/v1/projects/<slug>/runs`
- Auth: `x-api-token: <token>` header
- Body: `application/json` (CTRF report) OR `multipart/form-data` (`ctrf` field + file parts)
- Idempotency: `Idempotency-Key` header, 1–128 printable ASCII
- 201 `{ runId }` on first ingest; 200 + `X-Idempotent-Replay: true` on replay; 401/403/413/422/429 per spec.
- See `src/modules/ingest/routes.ts` and `src/modules/ingest/schemas.ts` for the canonical shapes. Reporters must produce CTRF JSON conforming to `CtrfReportSchema` (`src/modules/ingest/schemas.ts`).

## Skills required

- `skills/zod-schema-first.md` (CTRF report shape — DO NOT redefine; just emit conforming JSON)
- `skills/integration-testing.md` (no DB mocks)
- `skills/ctrf-ingest-validation.md` (idempotency, status semantics)

## Verification

- F wave: `npm install` at root succeeds; `tsc --noEmit` clean; `npm run lint` clean.
- T wave: `npm run test:int -- reporter-equivalence` and the two unit suites green; total new test count ≤ 15 integration + (≤7 unit × 2 packages) = ≤29 new tests.
- S wave: `.argos/CTRF-004/spec-audit.md` verdict `PASS` or `PASS WITH NITS`, no `BLOCK`.

## Rollback

Revert the squash-merge commit on main. `packages/` and `examples/` are net-new directories; revert removes them cleanly. No DB schema change, so no migration rollback needed.

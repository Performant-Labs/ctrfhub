# Spec-enforcer Audit — ctrfhub-docker-build-fix — iteration 1

**Executed:** 2026-05-17 19:42
**Reviewer:** spec-enforcer (Claude Opus 4.7) — read-only
**Scope:** diff `main..story/ctrfhub-docker-build-fix` (head `1b5bf7d`, base `4e07a3c`)
**Checklists run:** Architecture rules (auth-hook subset), Coverage, Planning-doc conformance (auth subset), Skills violations (`better-auth-session-and-api-tokens`, `artifact-security-and-serving`, `integration-testing`). Production diff is `Dockerfile` + `src/app.ts` + one integration test only; HTMX/Alpine/MikroORM-entity/Tailwind/CTRF-ingest checklist sections do not apply (no templates, entities, client code, or ingest routes touched).

## Prior-iteration check (iteration > 1 only)

N/A — iteration 1.

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `src/app.ts:524` | — | Optional: with Branch 0 (`src/app.ts:510-512`) returning early for every `/assets/*` request, the `rawPath.startsWith('/assets/')` clause in Branch 1's `isExemptFromEmptyCheck` is now unreachable, and the Branch 1 comment at line 517 still claims it exempts `/assets/*`. Harmless defense-in-depth; either drop the clause + comment line or leave as-is. Matches architecture-review-1 finding #2. | nit |

No drift detected against `skills/` or `docs/planning/*`. The single nit is cosmetic dead code, not a spec violation.

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| — | None | — | — |

Coverage matches the story's verification surface. The story declares no `tasks.md` tier requirement (standalone bug-fix). The only new testable production behaviour — the Branch 0 auth bypass — is covered by `src/__tests__/integration/static-asset-auth-bypass.test.ts` (31 tests, 5 suites): asset reachability without auth, genuine-404 on missing asset, non-asset auth posture unchanged (Branches 1/3/5), path-prefix exactness (`/my-assets`, `/assetsx`), and query-string handling. The Dockerfile changes add no pure function and no route; T1's `docker build`/`docker run`/`curl` verification is the correct surface and was executed (`tier-1-report.md`). No new route in `src/modules/*/routes.ts`; no new export from `src/lib/`. Coverage thresholds pass (lines 88.92 ≥ 80, functions 95.31 ≥ 80, branches 81.42 ≥ 75).

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] Auth hook precedence preserved — Branch 0 is an *additive* early `return` placed before Branch 1; Branches 1–5 are not restructured. Honors the hook's documented "fill in branch bodies, never restructure" contract — `skills/better-auth-session-and-api-tokens.md §How to apply / Global preHandler`, which already lists "static assets" as a step-2 exemption.
- [x] `x-api-token` header (not `Authorization: Bearer`) — Branch 3 unchanged; still reads `request.headers['x-api-token']` — `skills/better-auth-session-and-api-tokens.md`.
- [x] API token values never logged — diff adds no log statement; Branch 3's no-log security comment is untouched.
- [x] `request.em` used, not `fastify.orm.em` — diff adds no DB access in a handler; Branch 0 returns before any `em` call — `skills/mikroorm-dual-dialect.md`.
- [x] Artifact serving isolation unaffected — artifacts are served from `GET /api/files/*` (`skills/artifact-security-and-serving.md`), a distinct prefix from `/assets/`. Branch 0's `startsWith('/assets/')` predicate cannot match an artifact path; no separate artifact endpoint introduced — `skills/artifact-security-and-serving.md`.
- [x] Security headers still applied to assets — `@fastify/helmet` (registered at `src/app.ts:213`) and `@fastify/rate-limit` (`:226`) run as their own plugins/hooks; Branch 0 returns only out of the *auth* `onRequest` hook, so CSP/HSTS/X-Content-Type-Options and the rate limiter still cover `/assets/*` responses — `docs/planning/architecture.md §Content Security Policy`.
- [x] No mocked DB in the new integration test — `static-asset-auth-bypass.test.ts` uses a real SQLite DB (`:memory:` for Suites A/B/C/E, a temp-file DB with Better Auth schema migrated for Suite D) — `skills/integration-testing.md`.
- [x] All four integration suites with a built app call `afterAll(() => app.close())` — verified at lines 95, 155, 187, 264, 333.

## Forbidden-pattern scan (from CLAUDE.md)

- [x] No `hx-target`/`hx-swap` inherited from a parent — no template in diff.
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — no client code in diff.
- [x] No `hx-disable` anywhere — no template in diff.
- [x] No Alpine `x-data` inside an HTMX swap target — no template in diff.
- [x] No Postgres-only SQL / dialect-specific feature — no entity or migration in diff.
- [x] No DB mocked in an integration test — new test uses real SQLite (real `buildApp`, real Better Auth migrations).
- [x] No Tier 3 visual assertions without Tier 2 ARIA — non-UI story; T2/T2.5/T3 correctly declared N/A in `tier-2-report.md` with full reasoning.
- [x] No layout-token change without a Tier 2 backdrop-contrast re-check — diff contains no CSS or layout-token change.
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — Branch 0 reads no cookie and writes no token; session handling in Branch 4 is unchanged.
- [x] No Zod schema defined ad-hoc in a handler — diff adds no route handler or schema.

## Notes on the orchestration decision (recorded, not re-litigated)

Acceptance criterion 1 names `docker compose -f compose.sqlite.yml up -d` literally. Per André's documented ruling, that wording is loose: `compose.sqlite.yml` is a published-image production file (`image: ghcr.io/ctrfhub/ctrfhub:...`, no `build:` stanza) intentionally left untouched, and the Dockerfile build is verified directly. This audit treats `compose.sqlite.yml`'s untouched state as an accepted decision and not a finding — consistent with architecture-review-1 finding #1 (`warn`, routed to S/Argos) and the T1/test handoffs. The Dockerfile fix is what a CI publish of this branch will build the registry image from, so criteria 1–3 are satisfied for the image that file pulls.

Both Dockerfile bugs are addressed: Bug 1 (`COPY . .` before `npm ci`, both builder and runner stages — runner via `--ignore-scripts` + explicit `npm rebuild better-sqlite3`), and Bug 2 (`cp -r src/assets/. dist/assets/` bridging vendored JS into the production static root). Both fixes are minimal and well-commented; no pipeline refactor; the accepted layer-cache regression is documented in the feature handoff. F's choice not to retarget `scripts/copy-vendor-assets.mjs` (which would break `npm run dev`) is correct and keeps dev/prod consistent.

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

The single finding is a cosmetic `nit` (dead `/assets/` clause in Branch 1's allowlist) and is non-blocking — already marked optional/defensive by the architecture reviewer. No spec or skills drift; coverage matches the story's verification surface; auth posture for every non-asset route is proven unchanged by the new integration suite; the shared 34-container Uranus host was demonstrably left undisturbed.

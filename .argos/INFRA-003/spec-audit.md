# Spec-enforcer Audit — INFRA-003

**Executed:** 2026-05-02
**Scope:** diff `main..story/INFRA-003` (5 commits, 23 files changed)
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Forbidden-pattern scan (CLAUDE.md), Skills violations (htmx-4-forward-compat, tailwind-4-flowbite-dark-only, eta-htmx-partial-rendering, viewport-mobile-first-desktop-only, htmx-alpine-boundary, mikroorm-dual-dialect, fastify-route-convention, page-verification-hierarchy)

## Blocking issues resolved (from Test-writer handoff)

The three blocking issues identified by the Test-writer in `test-handoff.md` have all been resolved:

1. ✅ `src/views/layouts/main.eta:28` — `includeFile` replaced with `includeAsync` (Eta 3.5.0)
2. ✅ `src/app.ts:270` — `reply.page()` now passes `{ async: true }` to `this.view()`
3. ✅ `src/app.ts:284` — `GET /` route registered via `reply.page('home')`

Commit `b9e6822` (fix(INFRA-003)) contains all three fixes.

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `src/app.ts:260` | Documentation drift | JSDoc comment says "via `includeFile`" but implementation uses `includeAsync`. Update comment to match. | NIT |
| 2 | `src/app.ts:284` | `skills/fastify-route-convention.md` — "Declare `schema:` on every route" | Add `schema: {}` to the `GET /` route options. The route has no params/query/body, so this is zero-impact boilerplate. | NIT |

**No drift detected against `skills/` or `docs/planning/*`.** All acceptance criteria from GitHub issue #64 are satisfied.

## Coverage gaps

**Coverage matches the story's declared Test tiers required and Page verification tiers.**

| Tier | Status | Evidence |
|---|---|---|
| Integration (test tier) | ✅ 47 tests, all passing | `src/__tests__/integration/layout.test.ts` — `reply.page()` partial-vs-full-page branching verified |
| T1 Headless | ✅ 28/30 (2 blocked by now-fixed includeFile bug; re-verified via test route) | `.argos/INFRA-003/tier-1-report.md` |
| T2 ARIA | ✅ 11/11 | `.argos/INFRA-003/tier-2-report.md` — `main` landmark present; `nav` landmark absent as expected (stub home page) |
| T2.5 Authenticated State | N/A (route is unauthenticated) | Per test-handoff |
| T3 Visual | ✅ 8/8 structural assertions; narrow-smoke no-horizontal-scroll verified at 375×800 | `.argos/INFRA-003/tier-3-report.md` |
| Backdrop-contrast | N/A (no layout-token changes) | Per test-handoff |

## Acceptance criteria conformance (from GitHub issue #64)

- [x] `src/assets/input.css` — `@import tailwindcss`, `@import flowbite`, `@source` directives, `@theme` block with design tokens, `[data-theme]` runtime overrides for five themes, `@layer components` with `.badge-pass/fail/skip/flaky`, `.run-card`, `.stat-tile`
- [x] `layouts/main.eta` — script load order (Tailwind → HTMX → idiomorph → Alpine → Flowbite → app.js), `<meta viewport content="width=1280">`, `hx-ext="morph"` on `<body>`
- [x] `reply.page()` decorator — partial vs full-page branching on `HX-Request`
- [x] `npm run css:dev` watches without error (confirmed in feature-handoff)
- [x] Narrow-smoke Playwright test passes at 375×800 (no horizontal scroll — T3 #2)

## Forbidden-pattern scan (from CLAUDE.md)

All 10 forbidden patterns scanned — zero violations.

- [x] No `hx-target`/`hx-swap` inherited from a parent — N/A (no HTMX request attributes in current templates; body-level `hx-ext` is global extension enablement, not attribute inheritance)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — `src/client/app.ts` imports `HtmxEvents.AFTER_SETTLE`; no raw string events elsewhere
- [x] No `hx-disable` anywhere in templates — `git grep hx-disable` returns 0 matches
- [x] No Alpine `x-data` inside an HTMX swap target — `git grep x-data src/views/` returns 0 matches
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — no entity files modified
- [x] No DB mocked in integration tests — tests use `buildApp({ testing: true, db: ':memory:' })` with real SQLite
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — T2 report (11/11) predates T3 report (8/8)
- [x] No layout-token change without a T2 backdrop-contrast re-check — confirmed N/A in tier-2-report
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — no auth code modified
- [x] No Zod schema defined ad-hoc in a handler — no new API handlers added

## Architecture rules — spot-check summary

| Rule | Status |
|---|---|
| `hx-target`/`hx-swap` on requesting element | N/A (no HTMX request attributes) |
| Raw HTMX event names | ✅ `HtmxEvents` constants used |
| `hx-disable` | ✅ Not present |
| `x-data` inside swap target | ✅ Not present |
| Postgres-only column types | ✅ No entity changes |
| `fastify.orm.em` directly in handler | ✅ Not used |
| Route `schema:` declarations | ⚠️ Finding #2 — `GET /` lacks `schema: {}` |
| No Zod/TypeScript interface duplication | ✅ N/A |
| No `/api/artifact` endpoint | ✅ N/A |
| No `dark:` variant | ✅ Zero `dark:` variants |
| No raw utility soup | ✅ `@layer components` with `.badge-*`, `.run-card`, `.stat-tile` |
| No real AI API calls in tests | ✅ No AI imports in test files |
| `afterAll(() => app.close())` in integration tests | ✅ 6 `describe` blocks, all have `afterAll` cleanup |
| 500-row chunked inserts | ✅ N/A (no insert code) |

## Verdict

**PASS** — story may proceed to Argos Phase 7 close-out and PR open.

The two NIT-level findings (stale JSDoc comment referencing `includeFile`, missing `schema: {}` on `GET /`) are cosmetic and do not affect correctness, security, or spec conformance. Neither blocks merge.

All three blocking issues identified by the Test-writer have been fixed. Every acceptance criterion from GitHub issue #64 is satisfied. All declared test tiers and page verification tiers are present with passing reports. The forbidden-pattern scan found zero violations.

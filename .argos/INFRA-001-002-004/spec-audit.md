# Spec-enforcer Audit — INFRA-001 + INFRA-002 + INFRA-004

**Executed:** 2026-04-25 05:39
**Scope:** full codebase audit (foundation infrastructure stories)
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (htmx-4, mikroorm-dual-dialect, ctrf-ingest, zod-schema-first, better-auth, vitest-three-layer)

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `src/app.ts:326-333` | `skills/ctrf-ingest-validation.md §Rule` — ingest uses `x-api-token` header, NOT `Authorization: Bearer` | The TODO stub for AUTH-001 Branch 3 references `request.headers.authorization` and `Bearer ctrf_*`. The canonical spec (`product.md` L92, L97; `ctrf-ingest-validation.md` L10, L25; `testing-strategy.md` L152–205; `database-design.md` L493; `architecture.md` L529; `tasks.md` L112) unanimously specifies `x-api-token` as the ingest header. **However**, `skills/better-auth-session-and-api-tokens.md` L10 says `Authorization: Bearer`. This is a **spec-internal contradiction** (P1). The TODO comments in `app.ts` follow the minority position (`better-auth` skill). When AUTH-001 is implemented, it **must** use `x-api-token` per the overwhelming majority of the spec. Flag the `better-auth` skill for correction. | **NIT** (TODO stub only — no runtime code yet) |
| 2 | `skills/better-auth-session-and-api-tokens.md:10` | `docs/planning/product.md` L92, L97 — canonical API auth is `x-api-token`, not `Authorization: Bearer` | Correct the Rule line to say `x-api-token: <ctrf_*>` (not `Authorization: Bearer`). Align the Good example (L73–84) accordingly. This contradicts the authoritative spec — per `ORCHESTRATOR_HANDOFF.md` L243: "`product.md` > `architecture.md` > `project-plan.md`". | **BLOCKING** (P1 doc contradiction — must be fixed before AUTH-001 starts) |
| 3 | `docs/planning/project-plan.md:70` | `docs/planning/gaps.md §G-P1-001` — stale `/api/artifact` reference | Line reads: "via `/api/artifact`". Per `gaps.md §G-P1-001`, this reference should be deleted. The authoritative spec (`product.md §Feature 4`) says "no separate artifact endpoint". | **NIT** (already tracked in gaps.md — doc fix only) |

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| — | — | — | — |

**Coverage matches the story's declared Test tiers required and Page verification tiers.**

All three test files pass (46 tests, 3 suites):
- `src/__tests__/unit/scaffold.test.ts` — 7 tests (Layer 1: Vitest globals, dialect configs, htmx-events module)
- `src/__tests__/unit/health-schemas.test.ts` — 16 tests (Layer 1: Zod schema validation)
- `src/__tests__/integration/health.test.ts` — 23 tests (Layer 2: buildApp smoke, GET /health, security headers, rate-limit headers, 404 handling, shutdown lifecycle, DI seam cleanup)

TypeScript type check: `tsc --noEmit` — **PASS** (zero errors)

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] `/health` returns 503 while `bootState` is `booting` or `migrating` — `docs/planning/architecture.md §Health endpoint`, verified in `src/app.ts:380-386` and integration test
- [x] `/health` returns 200 with `{ status: 'ok', bootState: 'ready', dbReady: true }` when ready — `src/app.ts:408-412`
- [x] Auth routes include `config: { skipAuth: true }` — `/health` has `skipAuth: true` at `src/app.ts:369`
- [x] Migrations generated for both PG and SQLite dialects — `src/migrations/pg/.gitkeep` + `src/migrations/sqlite/.gitkeep` directories exist (no entities yet → no migration files, which is correct for INFRA-001/002)
- [x] Global auth preHandler skeleton wired with `skipAuth` bypass — `src/app.ts:309-351`
- [x] Zod-first: `HealthResponseSchema` is the single source of truth, `HealthResponse` type derived via `z.infer<>` — `src/modules/health/schemas.ts:32-43`
- [x] No duplicate TypeScript interface alongside the Zod schema — confirmed clean
- [x] CSP directives match `architecture.md §CSP` verbatim — `src/app.ts:79-97`, verified by integration tests L109-142
- [x] COOP `same-origin` set — `src/app.ts:167`, verified by integration test L144-147
- [x] Rate limit 600/min global — `src/app.ts:176`, verified by integration test L182-185
- [x] DI seams (`ArtifactStorage`, `EventBus`, `AiProvider`) defined with `close()` for graceful shutdown — `src/types.ts:19-46`
- [x] Per-request EM fork (never use `fastify.orm.em` in handlers) — `src/app.ts:246-248`
- [x] SIGTERM/SIGINT shutdown handlers — `src/app.ts:418-427`
- [x] ORM closed on shutdown — `src/app.ts:263-265`, verified by integration test L253-264
- [x] Integration tests: all `describe` blocks with shared `app` call `afterAll(() => app.close())` — confirmed at lines 26-28, 64-66, 205-207
- [x] Coverage thresholds: lines 80%, functions 80%, branches 75% — `vitest.config.ts:12-16`
- [x] Test include path: `src/__tests__/**/*.test.ts` — `vitest.config.ts:7`

## Forbidden-pattern scan (from CLAUDE.md)

- [x] No `hx-target`/`hx-swap` inherited from a parent — no HTMX attributes in codebase (expected: no UI stories yet)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — event name strings appear only in the htmx-events.ts comment block (TODO example, not runtime code)
- [x] No `hx-disable` anywhere in templates — none found
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — none found
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — no `p.array()`, `p.jsonb()`, `p.uuid()` as PK found
- [x] No DB mocked in integration tests — integration tests use real in-memory SQLite via `buildApp({ db: ':memory:' })`
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — no visual tests exist (correct: no UI stories)
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A (no UI)
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — none found
- [x] No Zod schema defined ad-hoc in a handler — `HealthResponseSchema` defined in `src/modules/health/schemas.ts`, referenced by the route schema declaration at `src/app.ts:371-374`
- [x] No `fastify.orm.em` used directly in a request handler — the string appears only in a docstring comment (L240), not runtime code
- [x] No `/api/artifact` or separate artifact endpoint — none found
- [x] No `dark:` Tailwind variant — none found
- [x] No real AI API calls in test files — no `openai`, `anthropic`, or `groq` imports in `src/__tests__/`
- [x] API token values never appear in log output — no `authorization` in log statements (only in TODO comments)

## Verdict

**PASS** — with one advisory action item.

> [!IMPORTANT]
> **Finding #2 is a P1 doc contradiction that must be resolved before AUTH-001 starts.**
> `skills/better-auth-session-and-api-tokens.md` says `Authorization: Bearer` for CI token auth, but the authoritative spec (`product.md`, `architecture.md`, `testing-strategy.md`, `database-design.md`, `tasks.md`, and `ctrf-ingest-validation.md`) unanimously specifies `x-api-token`. Per the precedence rule in `ORCHESTRATOR_HANDOFF.md` L243, `product.md` wins. The skill file must be corrected, and the TODO stubs in `src/app.ts:326-333` should be updated when AUTH-001 is implemented.

The three infrastructure stories (INFRA-001, INFRA-002, INFRA-004) may proceed — no blocking implementation drift detected. All 46 tests pass, `tsc --noEmit` is clean, and every audited pattern is spec-compliant.

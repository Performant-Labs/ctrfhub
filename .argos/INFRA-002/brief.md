# Task Brief — INFRA-002: Base Fastify app factory

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: INFRA-001 merged (main @ `4cb4892`) — package.json, vitest config, MikroORM configs, tsc clean, htmx-events.ts bootstrap all in place.
- [x] No P0 gap blocks this story: G-P0-001 (settings UI) and G-P0-002 (Eta partials) affect later UI stories — not INFRA-002. G-P0-003 (SET-* settings) is downstream. G-P0-004 ✅ closed.
- [x] Branch cut: `story/INFRA-002` from `main`
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(INFRA-002): assign`)
- [x] **Parallel story:** INFRA-004 (entities + migrations) is being implemented in a separate session at the same time. Both branch from the same main; no file overlap is expected (INFRA-002 lives in `src/app.ts`, INFRA-004 lives in `src/entities/` + `src/migrations/`).

## Story

**Description.** Build the Fastify app factory `buildApp(options: AppOptions)` in `src/app.ts`. This is the bootstrap layer — every route module registered later in the project plugs into it. No business routes ship in this story (those land in CTRF-001+, AUTH-002, DASH-001, etc.); only the wiring: helmet, rate-limit, ZodTypeProvider, view engine, global auth preHandler hook, `/health`, graceful shutdown.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §INFRA-002, broken into bullets)

- `buildApp()` factory exported from `src/app.ts` with an `AppOptions` interface — `{ testing?, db?, artifactStorage?, eventBus?, aiProvider? }` (the four-double dependency-injection seam from `vitest-three-layer-testing.md`).
- `ZodTypeProvider` registered (so route schemas use Zod end-to-end).
- Global auth `preHandler` hook wired — see `better-auth-session-and-api-tokens.md` for the exact precedence rules. **Stub the auth check in this story** (return early "no auth required yet" or always-allow with a TODO) — the real Better Auth wiring lands in AUTH-001. The hook itself MUST exist so AUTH-001 only has to fill in the body.
- `@fastify/helmet` registered with the CSP from `architecture.md §CSP` — copy that policy verbatim.
- `@fastify/rate-limit` registered globally (default 600/min); per-route overrides handled via `config.rateLimit` per `fastify-route-convention.md`.
- `@fastify/static` registered for `src/assets/` (Tailwind output target — the directory may be empty in this story; the registration just has to be there).
- `@fastify/view` registered with the **Eta** engine, templates root `src/views/` (directory may be empty).
- `GET /health` returns `{ bootState, dbReady, ... }` shape with HTTP **503** while `bootState === 'booting' | 'migrating'`, **200** when ready. Skip auth via `config: { skipAuth: true }`. Plain JSON, not HTML.
- Graceful shutdown: SIGTERM triggers `app.close()` which in turn closes the DB connection, the event bus, and any open SSE streams. Use `@fastify/graceful-shutdown` or hand-roll via `process.on('SIGTERM', …)`.

**Test tiers required.**

- **unit** — type-guard the `AppOptions` shape; the trivial `buildApp({ testing: true, db: ':memory:' })` smoke test that proves the factory composes without throwing.
- **integration** — `/health` shape (both 503 and 200 paths), helmet CSP headers present and matching `architecture.md §CSP`, SIGTERM closes the DB cleanly.

**Page verification tiers.**

- **T1 Headless only.** No rendered routes in this story — only `/health` (JSON). Use `app.inject({ method: 'GET', url: '/health' })` per `page-verification-hierarchy.md §T1`.
- T2 / T2.5 / T3 are not applicable — there is no rendered HTML to verify yet.

**Critical test paths.**

- `/health` integration test toggles `bootState` and asserts 503 → 200 transition.
- Helmet test snapshots the CSP response header against `architecture.md §CSP` byte-for-byte.
- A SIGTERM test (use `process.kill(process.pid, 'SIGTERM')` inside the test or invoke `app.close()` directly) confirms the close hook chain runs in order — DB → event bus → server.
- The four-double DI works: passing `{ testing: true, db: ':memory:' }` produces an app whose `app.em` connects to in-memory SQLite without touching `process.env.DATABASE_URL`. (Even though entities don't ship until INFRA-004, the DB connection itself is exercised here.)

## Required reading

**Skills (full paths — read before any code).**

- `skills/fastify-route-convention.md` — Plugin / service / schema layering; route file shape; `reply.page()` decorator; per-route rate-limit overrides; how `skipAuth: true` slots into the global preHandler. **`/health` itself is the canonical `skipAuth: true` example** — implement it to that pattern even though most routes don't ship yet.
- `skills/zod-schema-first.md` — `ZodTypeProvider` registration is the linchpin. Don't define ad-hoc TS interfaces for `/health`'s response shape — declare a Zod schema and let TS types derive from it. (Even for trivial responses; sets the precedent for every later route.)
- `skills/better-auth-session-and-api-tokens.md` — The global auth preHandler precedence is: (1) empty-users redirect to `/setup` → (2) `skipAuth: true` bypass → (3) Bearer API key → (4) session cookie → (5) HTMX 401 with `HX-Redirect`. **Implement the hook skeleton with all five branches; the actual Better Auth calls inside each branch are stubbed with `TODO(AUTH-001)` for now.**
- `skills/page-verification-hierarchy.md` — T1 patterns for `/health` testing via `app.inject()`; CSP header checks via `inject().headers`.
- `skills/vitest-three-layer-testing.md` — The `buildApp({ testing: true, db: ':memory:' })` factory pattern is the heart of this story. Read §Integration Test Bootstrap closely; that's the API consumers of `buildApp()` will use.

**Planning doc sections.**

- `docs/planning/architecture.md` §Backend (Fastify row, MikroORM row) — the wire-up.
- `docs/planning/architecture.md` §CSP — copy this CSP verbatim into the helmet config.
- `docs/planning/architecture.md` §Rate Limiting — global default + per-route overrides table.
- `docs/planning/architecture.md` §Graceful Shutdown — sequence and contract (DB → event bus → server, with timeouts).
- `docs/planning/testing-strategy.md` §Integration — `buildApp()` with the four DI seams.

## Files in scope

- `src/app.ts` — new (the factory)
- `src/__tests__/unit/app-options.test.ts` — new (type-guard the AppOptions)
- `src/__tests__/integration/health.test.ts` — new (`/health` shape + 503/200 transition)
- `src/__tests__/integration/security-headers.test.ts` — new (helmet CSP snapshot)
- `src/__tests__/integration/shutdown.test.ts` — new (SIGTERM close-chain)
- `package.json` — only if new deps are needed (`@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/view`, `eta`, `@fastify/type-provider-zod`, `@fastify/graceful-shutdown`)

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Raw CSRF-token or session-cookie handling outside Better Auth → `better-auth-session-and-api-tokens.md`
- Zod schema defined ad-hoc inside the `/health` handler instead of in a `schemas.ts` (or top-of-file constant) → `zod-schema-first.md`
- Mocking the DB in any integration test (use `db: ':memory:'`) → `vitest-three-layer-testing.md`
- Adding any HTML view or HTMX handling — out of scope for INFRA-002, lives in INFRA-003

## Next action (Feature-implementer)

1. Open a new session. Paste `.antigravity/agents/feature-implementer.md` first, then this Brief (`.argos/INFRA-002/brief.md`) second.
2. `git checkout story/INFRA-002` (already cut and pushed by Argos).
3. `npm install` to pick up any new Fastify plugin deps you add.
4. Read the five skills + planning sections above before writing code.
5. Implement. Commit with `feat(INFRA-002): …`, `test(INFRA-002): …`, `fix(INFRA-002): …`. `chore(INFRA-002): …` is reserved for Argos status flips.
6. Write the feature-handoff to `.argos/INFRA-002/feature-handoff.md`. The Test-writer reads only that — be precise about what tests are expected next.
7. Hand back to André so he can open the Test-writer session.

## Notes from Argos

- The auth preHandler is intentionally a skeleton in this story — real Better Auth wiring is AUTH-001's job. Stub each of the five precedence branches with a comment and a TODO; the goal is that AUTH-001 only has to fill in the body of each branch, never restructure the hook.
- For helmet's CSP, **don't** invent values not in `architecture.md §CSP`. If a directive seems missing, flag it in `docs/planning/gaps.md` rather than picking a default.
- `/health`'s response shape is referenced indirectly across other stories (CI checks, deploy docs); keep it minimal and stable: `{ bootState, dbReady }` is enough for now. Don't add `version`, `uptime`, etc. until something actually needs them.
- `MemoryArtifactStorage`, `MockAiProvider`, `MemoryEventBus` doubles don't exist yet (INFRA-004 ships two of them). For this story, accept those types in `AppOptions` as `unknown` or define minimal interfaces that INFRA-004 can refine. Don't block on doubles.

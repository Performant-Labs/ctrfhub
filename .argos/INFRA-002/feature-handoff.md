# Feature Handoff — INFRA-002: Base Fastify app factory

**Branch:** `story/INFRA-002`
**Commits on this branch since `main`:**
- 677700a feat(INFRA-002): buildApp() factory with ZodTypeProvider, helmet CSP, rate-limit, static, view, auth skeleton, /health, shutdown

## What was built

- `buildApp(options?: AppOptions)` factory in `src/app.ts` — the central bootstrap layer that every route module plugs into.
- `ZodTypeProvider` with validator + serializer compilers wired before any routes.
- `@fastify/helmet` with CSP directives copied verbatim from `architecture.md §CSP`, plus COOP `same-origin` (DD-028 I7).
- `@fastify/rate-limit` with global 600/min default; per-route overrides via `config.rateLimit`.
- `@fastify/static` serving `src/assets/` at `/assets/` prefix.
- `@fastify/view` with Eta engine, templates root `src/views/`, `.eta` extension.
- MikroORM lifecycle: init (in-memory SQLite for tests via `db: ':memory:'`, or env-based), per-request `em.fork()` via `onRequest` hook, migration run at boot, `onClose` cleanup.
- Global auth `preHandler` hook skeleton with all 5 precedence branches from `better-auth-session-and-api-tokens.md` — each branch is commented with `TODO(AUTH-001)` except the `skipAuth` bypass which is fully implemented.
- `GET /health` readiness probe: returns `{ status, bootState, dbReady }` — HTTP 503 during `booting`/`migrating`, 200 when `ready` with `SELECT 1` DB check. Uses `config: { skipAuth: true }`.
- Graceful shutdown: `onClose` hooks in registration order (event bus → artifact storage → AI provider → ORM), SIGTERM/SIGINT handlers (disabled in testing mode).
- DI seam interfaces (`ArtifactStorage`, `EventBus`, `AiProvider`) in `src/types.ts` — minimal stubs with `close()` for shutdown. INFRA-004 refines these.
- Zod-first `HealthResponseSchema` and `BootStateSchema` in `src/modules/health/schemas.ts`.
- Updated `src/index.ts` from placeholder to real server bootstrap.

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm test` — 7/7 existing tests pass (INFRA-001 scaffold tests)
- `npm run dev` — server booted on :3000 using in-memory SQLite
- `curl -s localhost:3000/health` — returned `{"status":"ok","bootState":"ready","dbReady":true}` with HTTP 200
- `curl -sI localhost:3000/health` — all security headers present (CSP, COOP, HSTS, X-Content-Type-Options, rate-limit headers)

## Files created or modified

Grouped by directory:

- `src/app.ts` — **NEW** — `buildApp()` factory with all wiring (430 lines)
- `src/types.ts` — **NEW** — DI seam interfaces + `AppOptions`
- `src/modules/health/schemas.ts` — **NEW** — Zod schemas for `/health` response
- `src/index.ts` — **MODIFIED** — replaced placeholder with real server bootstrap
- `src/mikro-orm.config.pg.ts` — **MODIFIED** — added `discovery.warnWhenNoEntities: false` + migration `glob` filter
- `src/mikro-orm.config.sqlite.ts` — **MODIFIED** — same changes as PG config
- `src/migrations/pg/.gitkeep` — **RENAMED** from `.gitkeep.ts` — prevents MikroORM treating it as a migration class
- `src/migrations/sqlite/.gitkeep` — **RENAMED** — same fix

## Decisions not covered by planning docs

- **`discovery.warnWhenNoEntities: false`** — MikroORM v7 throws `Error: No entities found` when the entities array is empty (which is the case before INFRA-004 ships). Added this flag to all three configs with `TODO(INFRA-004)` markers. This is a temporary workaround, not a permanent pattern. Adjoins `mikroorm-dual-dialect.md`.
- **`.gitkeep.ts` → `.gitkeep`** — The INFRA-001 scaffold created `.gitkeep.ts` files in migration directories. MikroORM's migrator scans for `*.ts` files and tried to instantiate `.gitkeep.ts` as a migration class, causing `TypeError: MigrationClass is not a constructor`. Renamed to plain `.gitkeep`. Also added `glob: '!(*.d).{js,ts}'` to migration configs as belt-and-braces. Adjoins `mikroorm-dual-dialect.md`.
- **DI seam interfaces vs `unknown`** — The brief suggested `unknown` or minimal interfaces. Chose minimal interfaces with `close()` methods because the shutdown sequence needs to call `close()` on each. More type-safe than `unknown` while still being a thin stub that INFRA-004 can refine. Adjoins `vitest-three-layer-testing.md`.
- **`any` cast on `MikroORM.init(config)`** — The runtime config resolver returns a union of `PostgreSqlDriver | SqliteDriver` typed configs. `MikroORM.init()` is generic and the union is incompatible. Cast through `any` with eslint disable + comment explaining why. This is inherent to the dual-dialect pattern and will remain as long as the runtime selector exists. Adjoins `mikroorm-dual-dialect.md`.
- **Health response shape: `{ status, bootState, dbReady }` only** — Architecture doc shows a richer shape with `version` and `uptime`. The brief explicitly says "keep it minimal" — no `version`/`uptime` until something needs them. Adjoins `architecture.md §Health endpoint`.

## Known issues / follow-ups

- The auth preHandler is a stub — all requests pass through. AUTH-001 must fill in all five branches.
- `src/views/` directory does not exist yet — `@fastify/view` is registered but no templates are present. INFRA-003 creates the layout template.
- `entities: []` is empty — the ORM connects and runs migrations but there's nothing to migrate. INFRA-004 adds entities and generates real migrations.
- The `discovery.warnWhenNoEntities: false` flags must be removed by INFRA-004 when entities are added.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/INFRA-002` (already on it if continuing locally).
3. Start with T1 Headless. Routes to focus on:
   - `GET /health` — test 503 vs 200 transition, response shape, `config.skipAuth` bypass
   - CSP header snapshot against `architecture.md §CSP`
   - Shutdown close-chain order (ORM close called)
   - `buildApp({ testing: true, db: ':memory:' })` smoke test

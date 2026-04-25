# Task Brief — INFRA-004: Core database entities and first migration

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: INFRA-001 merged (main @ `4cb4892`) — both MikroORM config files (`mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts`) plus the runtime selector (`mikro-orm.config.ts`) are in place; migration directories `src/migrations/pg/` and `src/migrations/sqlite/` exist; `npm run migrate:create:pg` and `npm run migrate:create:sqlite` scripts are wired.
- [x] No P0 gap blocks this story: G-P0-001 / G-P0-002 (UI layer) and G-P0-003 (settings UI) are downstream. G-P0-004 ✅ closed.
- [x] Branch cut: `story/INFRA-004` from `main`
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(INFRA-004): assign`)
- [x] **Parallel story:** INFRA-002 (Fastify app factory) is being implemented in a separate session at the same time. Both branch from the same main; no file overlap is expected (INFRA-002 lives in `src/app.ts`, INFRA-004 lives in `src/entities/` + `src/migrations/`).

## Story

**Description.** Define the six core MikroORM entities — `Organization`, `User` (Better Auth managed), `Project`, `TestRun`, `TestResult`, `TestArtifact` — and generate the first migration for both Postgres and SQLite dialects. Plus the two in-memory test doubles (`MemoryArtifactStorage`, `MemoryEventBus`) that integration tests will use as DI seams. No application code consumes these entities yet (that lands in CTRF-002 ingest, DASH-001 dashboard, etc.); this story is the data layer foundation.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §INFRA-004, broken into bullets)

- Six entities defined under `src/entities/`:
  - `Organization` — id, name, slug, settings (json), createdAt
  - `User` — Better Auth managed; the entity reflects Better Auth's user table schema (see `better-auth-session-and-api-tokens.md`). Org membership via FK to `Organization`.
  - `Project` — id, orgId (FK), name, slug, createdAt
  - `TestRun` — id, projectId (FK), tool, environment, passed/failed/skipped/total counts, aiSummary (text nullable), aiRootCauses (json nullable), createdAt — the canonical example in `mikroorm-dual-dialect.md §Good example`.
  - `TestResult` — id, testRunId (FK), name, status, durationMs, stack (text nullable), createdAt
  - `TestArtifact` — id, testRunId (FK), kind ('log' | 'video' | 'screenshot' | 'trace'), path, sizeBytes, createdAt
- All entities use only portable `p.*` types — see the §Portable Types list in `mikroorm-dual-dialect.md`.
- Barrel export at `src/entities/index.ts` re-exports every entity (and its schema if `defineEntity` is used).
- Migrations generated for **both** dialects: `src/migrations/pg/<timestamp>_initial.ts` and `src/migrations/sqlite/<timestamp>_initial.ts`.
- `npm run migrate:pg` succeeds end-to-end against a fresh Postgres (use the dev container or a temp-db fixture).
- `npm run migrate:sqlite` succeeds end-to-end against a fresh SQLite (in-memory or temp file).
- Two test doubles created at `src/__tests__/doubles/`:
  - `MemoryArtifactStorage.ts` — implements the `ArtifactStorage` contract from `architecture.md §Artifact Storage` (put/get/delete by path; in-memory Map).
  - `MemoryEventBus.ts` — implements the `EventBus` contract from `architecture.md §Event Bus` (publish/subscribe; in-memory).

**Test tiers required.**

- **unit** — entity helper-method tests (e.g., `TestRun.passRate` in the §Good example); shared contract tests for `MemoryArtifactStorage` and `MemoryEventBus` that any future implementation (S3, Redis, etc.) will reuse.
- **integration** — migrations apply cleanly against a fresh DB on **both** dialects.

**Page verification tiers.** none (no rendered routes — entities and migrations only).

**Critical test paths.**

- `npm run migrate:pg` against fresh Postgres → all 6 tables created, FKs declared, no warnings.
- `npm run migrate:sqlite` against fresh SQLite → identical schema (modulo dialect type rendering).
- Entities use only portable `p.*` types — see §Bad example in `mikroorm-dual-dialect.md` for the full forbidden list.
- `MemoryArtifactStorage` and `MemoryEventBus` pass shared unit tests that any production implementation must also pass (so the contract test file can be reused later for S3 / NATS implementations).

## Required reading

**Skills (full paths — read before any code).**

- `skills/mikroorm-dual-dialect.md` — **The whole skill**. Portable type list, dialect-switching config pattern, the `TestRun` example, the §Bad example to avoid. Every entity in this story must satisfy this skill.
- `skills/vitest-three-layer-testing.md` §Integration Test Bootstrap — for how integration tests will pass `db: ':memory:'` to `buildApp()`. Migrations must run cleanly against in-memory SQLite for that to work.
- `skills/better-auth-session-and-api-tokens.md` — read the §User Schema portion only. The `User` entity in this story has to match what Better Auth expects (otherwise AUTH-001 breaks). Don't invent fields; mirror Better Auth's required columns.

**Planning doc sections.**

- `docs/planning/database-design.md` §all — **authoritative entity model**. Every field name, every FK, every type comes from here. If a field in this brief differs from `database-design.md`, the planning doc wins; flag the brief drift in the feature-handoff.
- `docs/planning/architecture.md` §Backend (MikroORM row) — dual-dialect mandate.
- `docs/planning/architecture.md` §Artifact Storage — the `ArtifactStorage` contract that `MemoryArtifactStorage` implements.
- `docs/planning/architecture.md` §Event Bus — the `EventBus` contract that `MemoryEventBus` implements.

## Files in scope

- `src/entities/Organization.ts` — new
- `src/entities/User.ts` — new (mirrors Better Auth schema)
- `src/entities/Project.ts` — new
- `src/entities/TestRun.ts` — new
- `src/entities/TestResult.ts` — new
- `src/entities/TestArtifact.ts` — new
- `src/entities/index.ts` — new (barrel export)
- `src/migrations/pg/<timestamp>_initial.ts` — new (generated by `npm run migrate:create:pg`)
- `src/migrations/sqlite/<timestamp>_initial.ts` — new (generated by `npm run migrate:create:sqlite`)
- `src/__tests__/doubles/MemoryArtifactStorage.ts` — new
- `src/__tests__/doubles/MemoryEventBus.ts` — new
- `src/__tests__/unit/entities/test-run-helpers.test.ts` — new (and similar for any other entity with helper methods)
- `src/__tests__/unit/doubles/artifact-storage.contract.test.ts` — new (shared contract test)
- `src/__tests__/unit/doubles/event-bus.contract.test.ts` — new
- `src/__tests__/integration/migrations-pg.test.ts` — new (skip in CI if no PG available; in dev container it runs)
- `src/__tests__/integration/migrations-sqlite.test.ts` — new (always runs)

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Postgres-only types in entity files: `p.array()`, `p.jsonb()`, `p.uuid()` as PK, `p.bigint()` without justification, `p.enum()` with DB CHECK constraints → `mikroorm-dual-dialect.md §Portable Types`
- Postgres-only SQL in migrations (`tsvector`, `gin`, `partial index`, `JSONB` operators) without an equivalent SQLite migration → `mikroorm-dual-dialect.md`
- Mocking the DB in integration tests — use real SQLite in-memory → `vitest-three-layer-testing.md`
- Defining the `User` entity differently from what Better Auth expects (will silently break AUTH-001) → `better-auth-session-and-api-tokens.md §User Schema`
- Adding any HTTP route, handler, or service-layer code — out of scope; that lands in CTRF-002 / DASH-001 / etc.

## Next action (Feature-implementer)

1. Open a new session. Paste `.antigravity/agents/feature-implementer.md` first, then this Brief (`.argos/INFRA-004/brief.md`) second.
2. `git checkout story/INFRA-004` (already cut and pushed by Argos).
3. Read `database-design.md` cover-to-cover before writing any entity.
4. Read the three skills above.
5. Implement entities → barrel export → run `npm run migrate:create:pg` then `npm run migrate:create:sqlite` → adjust until both apply cleanly → write the two doubles → write the contract tests + helper tests + migration integration tests.
6. Commit with `feat(INFRA-004): …`, `test(INFRA-004): …`, `fix(INFRA-004): …`. `chore(INFRA-004): …` is reserved for Argos status flips.
7. Write the feature-handoff to `.argos/INFRA-004/feature-handoff.md`. Be specific about: any deviation from `database-design.md` (and why), any place where the PG and SQLite migrations differ in ways that aren't pure type-name rendering.
8. Hand back to André so he can open the Test-writer session.

## Notes from Argos

- The `User` entity is the dangerous one — get it wrong and AUTH-001 breaks silently. **Cross-check every field name and type against Better Auth's documented schema.** If `better-auth-session-and-api-tokens.md` doesn't list a field that Better Auth requires, flag it in `gaps.md`; don't guess.
- If `database-design.md` and `mikroorm-dual-dialect.md §Good example` (TestRun) diverge in any way, the planning doc wins. The skill's example may have been written before the planning doc was finalized.
- Migrations files are generated, not hand-written. If you find yourself editing the generated SQL, that's a smell — adjust the entity instead and regenerate.
- Don't optimize the schema (no indexes beyond FK auto-indexes, no partial indexes, no covering indexes) — index work happens in dedicated stories per `database-design.md §Indexing Strategy`.
- The `MemoryArtifactStorage` / `MemoryEventBus` contract tests are the most-reusable artifact in this story — write them so a future S3 / NATS implementation can be drop-in-validated by passing the test file the new instance.

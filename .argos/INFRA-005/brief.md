# Task Brief — INFRA-005: Replace migration runner with schema-generator at boot

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: INFRA-004 ✅ (entities exist in `src/entities/`), AUTH-001 ✅ (Better Auth wired), CI-001 ✅ (CI workflow you'll be amending). CTRF-002 (PR #25) is in flight and adds one more entity + migration; this story should land *after* #25 merges so the deletion sweep covers everything.
- [x] No P0 gap blocks this story.
- [x] Branch cut: `story/INFRA-005` from `main` @ 7b34625 (CI-001 merge commit).
- [x] `tasks.md` row added and flipped `[ ]` → `[/]` on the story branch (commit `chore(INFRA-005): assign`, brief committed alongside per the PR #17 convention).
- [x] **Why this story exists.** PR #24's e2e failure surfaced an architectural mismatch: running schema migrations on app boot is premature for MVP. Migrations exist to evolve schema while *preserving data*. We have no production users, no v1.0 deployments, no data. Every story since INFRA-004 has paid full migration ceremony for zero migration value, and the `organization`-FK-before-`organization`-exists bug only happened because migrations run in commit order, not topological FK order. Schema-generator from the entity model handles topological ordering correctly and eliminates the bug class.
- [x] **Parallel-story constraints.** This story conflicts with anything that touches `src/app.ts` boot path or `src/migrations/`. While in flight, hold off briefing other DB-touching stories (CTRF-003, AI-001, AI-002, SET-*, DATA-001). CI-003 (Tugboat) doesn't touch DB schema and is parallel-safe.

## Story

**Description.** Replace the MikroORM migration runner with `schemaGenerator.updateSchema()` at app boot. Delete `src/migrations/`. Remove `skipTables: ['organization']` from the MikroORM config (the workaround CTRF-002's handoff documented). Update CI's dialect-portability verification to drive schema-generator instead of `npm run migrate:*`. Drop `continue-on-error: true` from CI-001's e2e job since the underlying bug is resolved. Update the spec docs to match.

**Acceptance criteria.**

- App boot uses `MikroORM.init()` followed by `orm.schema.updateSchema()` (or `createSchema()` on a verified-empty DB). Idempotent: safe on fresh DB and existing DB. No `migrator.up()` call anywhere on the boot path.
- `src/migrations/` directory deleted entirely (both `pg/` and `sqlite/` subtrees, including `.snapshot-memory.json`). `mikro_orm_migrations` table is no longer created.
- `Organization` entity is created from its entity definition by schema-generator. The previous `skipTables: ['organization']` exclusion in the MikroORM config(s) is removed. `projects.organization_id` FK to `organization.id` works because schema-generator emits CREATE TABLE statements in topological FK order.
- `package.json` migration scripts removed (`migrate:pg`, `migrate:sqlite`, `migrate:create:pg`, `migrate:create:sqlite`). New scripts: `schema:emit:pg`, `schema:emit:sqlite` (DDL emit for inspection / git-diff review), `schema:update:pg`, `schema:update:sqlite` (idempotent apply).
- `src/__tests__/integration/migrations-sqlite.test.ts` renamed to `schema-sqlite.test.ts` and repurposed: drives `schema.updateSchema()` against a fresh SQLite, asserts all 7 expected tables exist (Organization, User, Project, TestRun, TestResult, TestArtifact, IngestIdempotencyKey) with correct FK constraints. Counterpart `schema-pg.test.ts` if practical (or covered by CI's PG dialect-verification step).
- CI's dialect-portability step in `.github/workflows/ci.yml`'s integration / e2e jobs drives schema-generator (e.g., `npm run schema:update:pg` against the service container) instead of `migrate:pg`.
- `.github/workflows/ci.yml`'s e2e job: `continue-on-error: true` removed; the inline comment explaining the soft-fail removed; e2e job is back to a hard-required check.
- Existing 210+ tests still pass.
- `architecture.md` updated: §Production Deployment §Image build §Migrations-in-production sections rewritten to describe schema-generator boot. Add a forward-looking note: "When v1.0 ships and we have real deployments, generate ONE baseline migration from the v1.0 entity state, commit it as `src/migrations/0001_baseline.ts`, and switch back to migration-mode for production upgrades."
- `tasks.md §INFRA-004` acceptance reworded: drop the `npm run migrate:pg` / `npm run migrate:sqlite` bullets and the "migrations generated for both dialects" bullet; replace with schema-generator equivalents.
- `skills/mikroorm-dual-dialect.md` updated: replace migration-pattern section with schema-generator pattern. Cite this story as the source of the change.
- `gaps.md` G-P1-006 (RETENTION_CRON_SCHEDULE) is unaffected; not in scope here.

**Test tiers required.** Unit (entity-shape sanity), integration (schema-sqlite + schema-pg). No new E2E in this story — the e2e job revival is a side-effect, not new spec coverage.

**Page verification tiers.** None (no rendered routes touched).

**Critical test paths.**

- Fresh PG: schema-generator emits CREATE TABLE statements for all 7 entities in topological FK order; no errors.
- Fresh SQLite (`:memory:`): same.
- Existing-schema reboot: `updateSchema()` is idempotent — running it twice on a populated DB produces no errors, no destructive changes (no DROP TABLE or DROP COLUMN unless an entity was removed).
- App `/health` endpoint returns 200 within 15s on fresh DB (down from 60s — schema-generator is much faster than running a migration chain).
- CI's previously-soft-failing e2e job now passes hard.

## Required reading

**Skills (full paths — read before any code).**

- `skills/mikroorm-dual-dialect.md` — current state describes the migration-runner pattern this story replaces. Read it for context, then update it as part of this story's deliverables.
- `skills/page-verification-hierarchy.md` §T1 — the `/health` boot-state contract you'll verify against fresh PG and SQLite.
- `skills/vitest-three-layer-testing.md` — Layer 2 integration test patterns. The new `schema-*.test.ts` files mirror the existing `migrations-sqlite.test.ts` shape.

**Planning doc sections.**

- `docs/planning/architecture.md §Production Deployment` and `§Image build` and `§Migrations in production` — current migration-runner narrative. Rewrite as part of this story.
- `docs/planning/architecture.md §Health endpoint` — health endpoint contract; you may want to update boot-state names if "migrating" no longer applies.
- `docs/planning/database-design.md` — entity schemas; cross-check that all entities are present in the MikroORM config (no remaining `skipTables` exclusions).
- `docs/planning/tasks.md §INFRA-004` — acceptance bullets to reword.

**External — required.**

- MikroORM v7 schema-generator docs: https://mikro-orm.io/docs/schema-generator — the canonical API surface. `orm.schema.createSchema()`, `orm.schema.updateSchema()`, `orm.schema.dropSchema()`, `orm.schema.refreshDatabase()`. `getCreateSchemaSQL()` for DDL emit without applying.

## Files in scope

- `src/app.ts` — replace migration runner with `await orm.schema.updateSchema()` (or `createSchema` first-boot detect). Update `bootState` machine if "migrating" is no longer a meaningful state.
- `src/mikro-orm.config.ts`, `src/mikro-orm.config.pg.ts`, `src/mikro-orm.config.sqlite.ts` — remove `migrations:` config block; remove `schemaGenerator.skipTables: ['organization']` (or wherever that exclusion lives).
- `src/migrations/` — **delete entire directory** (both `pg/` and `sqlite/` subtrees including `.snapshot-memory.json`).
- `src/__tests__/integration/migrations-sqlite.test.ts` → rename → `src/__tests__/integration/schema-sqlite.test.ts`. Repurpose: drives schema-generator, asserts all expected tables exist with correct FKs.
- `src/__tests__/integration/schema-pg.test.ts` (new, optional) — counterpart for PG dialect. If skipped in unit-test land, the CI integration / e2e jobs cover the PG path.
- `package.json` — rename scripts (drop `migrate:*`, add `schema:*`).
- `.github/workflows/ci.yml` — integration / e2e job dialect-verification step uses `npm run schema:update:pg` (or equivalent); e2e job loses `continue-on-error: true` and the inline comment block above it.
- `docs/planning/architecture.md` — boot flow + image build + migrations sections.
- `docs/planning/tasks.md §INFRA-004` — reword acceptance.
- `skills/mikroorm-dual-dialect.md` — replace migration-pattern section.

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Keeping any `migrator.up()`, `migrator.down()`, or `MigrationRunner` reference on the app boot path.
- Migrating Better Auth's tables via MikroORM (`apikey`, `user`, `session`, `account`, `verification`). Better Auth manages those via its own plugin lifecycle — leave them out of the entity model.
- Skipping any CTRFHub-owned entity from schema-generator's set. This was the original `organization` bug.
- Hardcoding table names anywhere outside of entity definitions or schema-generator output.
- Adding new migration files in this story. The whole point is to remove them.
- Touching `gaps.md` G-P1-006 / G-P1-007 / G-P1-008 — those are tracked separately.
- `Dockerfile.dev` changes (CI-002's territory) or new prod Dockerfile changes (CI-001's territory).

## Next action (Feature-implementer)

1. Open a fresh AntiGravity session. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief (`.argos/INFRA-005/brief.md`) as the second.
2. `git checkout story/INFRA-005 && git pull origin story/INFRA-005`.
3. Read MikroORM v7 schema-generator docs + the cited skills/planning sections. The skill `mikroorm-dual-dialect.md` is the primary doc you'll be updating, so read it as both source-of-truth-now and your-deliverable-target.
4. Implement in this order (each step independently testable):
   - **Mikro-orm config files** — remove `migrations:` block; remove `skipTables: ['organization']`. `npm run dev` will fail loudly until step 2 is done — that's expected.
   - **Boot path in `src/app.ts`** — replace migration runner call with `await orm.schema.updateSchema()`. Run `npm run dev` against fresh local SQLite; `/health` should return 200 within 15s.
   - **Delete `src/migrations/`** — entire directory.
   - **`package.json` scripts** — rename, update any references in the workflows.
   - **Tests** — rename `migrations-sqlite.test.ts` → `schema-sqlite.test.ts`, repurpose to drive schema-generator. Run `npm run test` until 210+ tests pass.
   - **CI workflow** — update dialect-verification step; drop `continue-on-error: true` from e2e job. Push to a draft PR and watch the workflow execute end-to-end on real PG.
   - **Spec docs** — `architecture.md` boot/migrations sections, `tasks.md §INFRA-004` acceptance, `skills/mikroorm-dual-dialect.md` migration-pattern section.
5. After each phase: `tsc --noEmit` (zero errors) and `npm run test` (full suite green).
6. Commit with `feat(INFRA-005): …`, `refactor(INFRA-005): …`, `fix(INFRA-005): …`, `docs(INFRA-005): …`. `chore(INFRA-005): …` reserved for Argos status flips.
7. Write the feature-handoff to `.argos/INFRA-005/feature-handoff.md`. Be specific about: any decisions about how `bootState` evolves (does "migrating" still exist as a state, or is it now just "booting" → "ready"?), any unexpected entity-vs-DB drift schema-generator surfaced (e.g., FK ordering issues, column type mismatches), the actual fresh-boot wall-clock time (`/health` 200 latency).
8. Hand back to André so he can open the Test-writer step.

## Notes from Argos

- **This is a corrective architectural pivot.** Decision was made by André post-CTRF-002 close-out (2026-04-25): migrations are premature for MVP-no-data; schema-generator is the right MVP path. The story replaces a piece of INFRA-004's deliverable, hence it lives in Tier 0.
- **Better Auth's tables are not your concern.** `apikey`, `user`, `session`, `account`, `verification` are managed by Better Auth's plugin lifecycle. Don't add them to your entity model. Don't try to schema-generator them. Better Auth handles its own setup.
- **Path forward to v1.0** (out of scope here, documented for context): when v1.0 ships and we have real production deployments, generate ONE baseline migration from the v1.0 entity state, commit it as `src/migrations/0001_baseline.ts`, and switch back to migration-mode for production upgrades. Call it `MIG-001` if/when it's needed.
- **CTRF-002 just merged (or is about to).** It added the `IngestIdempotencyKey` entity and one PG + one SQLite migration. Once #25 merges, your deletion sweep covers all three migration files (the INFRA-004 baseline + CTRF-002's idempotency-key migration). If #25 hasn't merged when you start, just include both in your delete.
- **The brief itself ships on the story branch** (per PR #17 convention).
- **The e2e job's wait-for-health timeout** is currently 60s with a 30-attempt × 2s loop. After this story, schema-generator should boot the app in well under 15s. Consider tightening to a 20s loop with 1s sleeps so a real boot regression (app crash) fails faster than a migration-style "wait and see."

# Spec-enforcer Audit — INFRA-004

**Executed:** 2026-04-25 05:17
**Scope:** diff `main..story/INFRA-004`
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (mikroorm-dual-dialect, vitest-three-layer-testing, ctrf-ingest-validation, artifact-security-and-serving)

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `src/__tests__/integration/health.test.ts:13` | Branch hygiene — test file imports `../../app.js` which does not exist on `story/INFRA-004` | This file belongs on `story/INFRA-002`, not `story/INFRA-004`. It was left behind as an untracked file. Remove from this branch (or do not commit it here). The test will be committed when INFRA-002 is merged or its test branch is finalized. | **BLOCKING** |
| 2 | `src/__tests__/unit/health-schemas.test.ts:9` | Branch hygiene — test file imports `../../modules/health/schemas.js` which does not exist on `story/INFRA-004` | Same as Finding #1 — this file belongs on `story/INFRA-002`. Remove from this branch to keep `npm test` green. | **BLOCKING** |
| 3 | *(vitest run output)* | `skills/vitest-three-layer-testing.md` — all tests must pass before story close-out | `npm test` exits with code 1: 2 suites fail (health.test.ts, health-schemas.test.ts) due to Findings #1–#2. The 5 INFRA-004 suites (67 tests) pass. | **BLOCKING** |
| 4 | `src/migrations/pg/Migration20260425041216.ts` | `skills/mikroorm-dual-dialect.md §3` — "Generate migrations against both dialects" | PG migration was manually authored (per feature-handoff.md: "Manually authored (no PG available)") and has not been verified against a running PostgreSQL instance. This is acceptable for local dev without Docker, but should be flagged for CI verification before merge. | NIT |

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| 1 | No `migrations-pg.test.ts` integration test | INFRA-004 brief §Files in scope: `src/__tests__/integration/migrations-pg.test.ts` — "skip in CI if no PG available; in dev container it runs" | NIT |

> [!NOTE]
> The brief explicitly states the PG migration test can be skipped when no PG is available. The SQLite migration test (`migrations-sqlite.test.ts`) provides equivalent schema coverage. This is a NIT, not a BLOCK.

**All other coverage matches the story's declared Test tiers required.** Specifically:
- **Unit tests (24):** TestRun domain methods (passRate, failureRate, pendingCount), TestResult domain methods (effectiveCategory, categorySource), TestArtifact domain methods (isExternalUrl, isVerified) ✓
- **Unit contract tests (25):** ArtifactStorage contract (14 tests) + EventBus contract (11 tests) — reusable for future implementations ✓
- **Integration tests (11):** SQLite in-memory migration lifecycle — tables, columns, FKs, Better Auth exclusion ✓
- **Pre-existing scaffold tests (7):** Still passing ✓

## Planning-doc conformance (only lines relevant to INFRA-004's scope)

- [x] Six entities defined under `src/entities/` — `database-design.md §4.1–§4.6`
- [x] All entities use only portable `p.*` types (no `p.array()`, `p.jsonb()`, `p.uuid()` as PK, `p.enum()`) — `skills/mikroorm-dual-dialect.md §Portable Types`
- [x] Barrel export at `src/entities/index.ts` re-exports every entity and schema — INFRA-004 brief
- [x] Migrations generated for both PG and SQLite dialects — `skills/mikroorm-dual-dialect.md §3`
- [x] `npm run migrate:sqlite` succeeds against fresh in-memory SQLite — confirmed by integration test
- [x] Better Auth tables excluded from migration generation via `schemaGenerator.skipTables` — `database-design.md §4` / `better-auth-session-and-api-tokens.md`
- [x] Organization and User entities marked as Better Auth-managed (relationship mapping only) — `database-design.md §4.1, §4`
- [x] Integer PKs for CTRFHub-owned tables, string PKs for Better Auth tables — `database-design.md`
- [x] `MemoryArtifactStorage` implements `ArtifactStorage` contract (put/get/delete/exists) — `architecture.md §Artifact Storage`
- [x] `MemoryEventBus` implements `EventBus` contract (publish/subscribe/unsubscribe/close) — `architecture.md §Event Bus`
- [x] Contract tests designed for reuse (factory pattern at top of file) — `vitest-three-layer-testing.md §Interface-based test doubles`
- [x] Integration tests use real SQLite in-memory, not mocked DB — `vitest-three-layer-testing.md §Layer 2`

## Forbidden-pattern scan (from CLAUDE.md)

Scan the diff for each forbidden pattern; note explicitly if none were found.

- [x] No `hx-target`/`hx-swap` inherited from a parent — **N/A** (no templates in INFRA-004)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — grep found references only in `htmx-events.ts` itself (inside comments/TODOs)
- [x] No `hx-disable` anywhere in templates — grep: 0 results
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — grep: 0 results
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — entities use only portable `p.*` types; PG migration renders `jsonb`/`timestamptz` which is correct dialect-specific output from MikroORM, not hand-written Postgres SQL in entity files
- [x] No DB mocked in integration tests — `migrations-sqlite.test.ts` uses real `MikroORM.init()` with `:memory:`; no `vi.mock()` on DB
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — **N/A** (no UI tests)
- [x] No layout-token change without a T2 backdrop-contrast re-check — **N/A** (no CSS changes)
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — grep: 0 results
- [x] No Zod schema defined ad-hoc in a handler — **N/A** (no route handlers in INFRA-004)
- [x] No real AI API calls in test files — grep for `openai|anthropic|groq`: 0 results
- [x] All integration test suites call `afterAll(() => app.close())` or equivalent — `migrations-sqlite.test.ts:46` calls `afterAll(async () => { if (orm) await orm.close(true); })`
- [x] No `fastify.orm.em` used directly in a request handler — **N/A** (no handlers)
- [x] No `/api/artifact` or separate artifact endpoint — grep: 0 results
- [x] No `dark:` Tailwind variant in any template — grep: 0 results
- [x] No `interface *Request` or `interface *Body` patterns duplicating Zod schemas — grep: 0 results

## Verdict

**BLOCK** — remediation required. The specific findings that must be resolved before the next audit:

- **Finding #1 and #2:** Two untracked test files (`health.test.ts`, `health-schemas.test.ts`) on the `story/INFRA-004` working tree import modules that only exist on `story/INFRA-002`. These cause `npm test` to exit with code 1. **Remediation:** Either `git checkout -- src/__tests__/integration/health.test.ts src/__tests__/unit/health-schemas.test.ts` to discard them, or move them to `story/INFRA-002` before committing. Once removed, `npm test` will be 5 suites / 67 tests / all green.
- **Finding #3:** Will resolve automatically once Findings #1–#2 are remediated.

> [!IMPORTANT]
> All INFRA-004 implementation work — entities, migrations, interfaces, test doubles, and their tests — is fully spec-compliant. The only blocking issue is stale working tree artifacts from a parallel INFRA-002 session.

If BLOCK: return the story to the Feature-implementer per `implementstory.md` Phase 1; once remediated, the full tier pipeline (T1 → T2 → tests → T3) re-runs from Phase 2.

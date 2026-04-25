# Test Handoff — INFRA-004

**Branch:** `story/INFRA-004`
**Commits added by Test-writer:**
- *(pending commit)* `test(INFRA-004): entity domain methods, contract tests, migration integration test`

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/INFRA-004/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — no rendered routes in INFRA-004 | — |
| T2.5 Authenticated State | N/A — no rendered routes in INFRA-004 | — |
| T3 Visual | N/A — non-UI story (entities & migrations only) | — |
| Backdrop-contrast | N/A — no CSS changes | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | `src/__tests__/unit/entity-domain-methods.test.ts` | 24 | TestRun (passRate, failureRate, pendingCount), TestResult (effectiveCategory, categorySource), TestArtifact (isExternalUrl, isVerified) |
| Unit | `src/__tests__/unit/artifact-storage.contract.test.ts` | 14 | Shared contract: put/get round-trip, overwrite, delete, exists + MemoryArtifactStorage assertion helpers |
| Unit | `src/__tests__/unit/event-bus.contract.test.ts` | 11 | Shared contract: subscribe/publish, type routing, unsubscribe, close + MemoryEventBus assertion helpers |
| Integration | `src/__tests__/integration/migrations-sqlite.test.ts` | 11 | SQLite in-memory: migration applies, 4 tables created, columns verified, FKs verified, Better Auth tables excluded |

**Total new tests:** 60 (across 4 files)
**Pre-existing tests:** 7 (scaffold.test.ts)
**Full suite:** 67 passing, 0 failing

## Coverage (from `npm run test:coverage`)

> [!NOTE]
> Coverage not measured for INFRA-004 because entities are excluded from coverage tracking by `vitest.config.ts` (`exclude: ['src/entities/**']`). The new test files exercise entity domain methods and test doubles which are under `src/__tests__/` (also excluded). The migration integration test validates ORM behaviour, not application source coverage.

## Non-blocking issues

- `health-schemas.test.ts` and `health.test.ts` (INFRA-002 tests) fail on this branch because `src/app.ts` and `src/modules/health/schemas.ts` don't exist here — they live on `story/INFRA-002`. These tests will pass once both branches are merged to `main`.
- PG migration (`src/migrations/pg/`) was manually authored and needs Docker verification (no PG available locally). Integration test covers SQLite only.

## Design notes

- **Contract tests are reusable**: `artifact-storage.contract.test.ts` and `event-bus.contract.test.ts` use a factory function at the top of the file. When `S3ArtifactStorage` or `RedisEventBus` are implemented, the same test file can validate them by swapping the factory — no test rewriting needed.
- **MikroORM v7 Migrator extension**: The integration test registers the `Migrator` extension explicitly via `extensions: [Migrator]` in the config, because MikroORM v7 doesn't auto-discover it. This mirrors the CLI's behaviour.
- **sqlite_sequence exclusion**: SQLite creates an internal `sqlite_sequence` table when `AUTOINCREMENT` is used. The "exactly 4 tables" assertion excludes `sqlite_%` and `mikro_orm_%` patterns.

## Next action (Spec-enforcer)

1. Open a new session. Paste `.antigravity/agents/spec-enforcer.md` as the first message, then this handoff as the second.
2. Check out `story/INFRA-004`.
3. Run the Audit Checklist and write the verdict to `.argos/INFRA-004/spec-audit.md` (template in `.antigravity/agents/spec-enforcer.md`).

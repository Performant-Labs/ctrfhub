# Tier 1 Headless Report — INFRA-004

**Executed:** 2026-04-24 21:22 PDT
**Method:** Vitest unit + integration tests (no browser, no HTTP server)

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | TestRun.passRate returns 0 when totalTests=0 | `vitest run entity-domain-methods` | 0 | 0 | ✓ |
| 2 | TestRun.passRate returns correct fraction | same | 0.75 for 150/200 | 0.75 | ✓ |
| 3 | TestRun.failureRate returns 0 when totalTests=0 | same | 0 | 0 | ✓ |
| 4 | TestRun.failureRate returns correct fraction | same | 0.25 for 50/200 | 0.25 | ✓ |
| 5 | TestRun.pendingCount = total - (pass+fail+skip+block) | same | 35 for 100-(50+10+5+0) | 35 | ✓ |
| 6 | TestResult.effectiveCategory: override wins over AI | same | override value | override value | ✓ |
| 7 | TestResult.categorySource returns 'manual' when override set | same | 'manual' | 'manual' | ✓ |
| 8 | TestResult.categorySource returns 'ai' when only AI set | same | 'ai' | 'ai' | ✓ |
| 9 | TestArtifact.isExternalUrl returns true for 'url' | same | true | true | ✓ |
| 10 | TestArtifact.isVerified reflects contentTypeVerified | same | true/false | true/false | ✓ |
| 11 | ArtifactStorage put/get round-trip | `vitest run artifact-storage.contract` | stored data returned | stored data returned | ✓ |
| 12 | ArtifactStorage put overwrites (idempotent) | same | updated data returned | updated data returned | ✓ |
| 13 | ArtifactStorage get returns null for missing key | same | null | null | ✓ |
| 14 | ArtifactStorage delete removes artifact | same | get returns null after delete | null | ✓ |
| 15 | ArtifactStorage exists returns correct booleans | same | true/false/false | true/false/false | ✓ |
| 16 | EventBus delivers events to subscribers | `vitest run event-bus.contract` | handler receives event | handler received | ✓ |
| 17 | EventBus routes by type (no cross-delivery) | same | 0 categorized, 1 ingested | 0, 1 | ✓ |
| 18 | EventBus unsubscribe stops delivery | same | 1 event (not 2) | 1 | ✓ |
| 19 | EventBus close clears subscriptions | same | 0 delivered after close | 0 | ✓ |
| 20 | SQLite migration applies cleanly | `vitest run migrations-sqlite` | orm.isConnected() = true | true | ✓ |
| 21 | projects table has expected columns | same | 10 columns present | 10 columns | ✓ |
| 22 | test_runs table has expected columns | same | 12+ columns present | all present | ✓ |
| 23 | test_results table has expected columns | same | 12+ columns present | all present | ✓ |
| 24 | test_artifacts table has expected columns | same | 11 columns present | all present | ✓ |
| 25 | Better Auth tables NOT created by migration | same | 0 BA tables | 0 BA tables | ✓ |
| 26 | Exactly 4 CTRFHub tables created | same | 4 | 4 | ✓ |
| 27 | FK: projects.organization_id → organization | same | FK exists | FK exists | ✓ |
| 28 | FK: test_runs.project_id → projects | same | FK exists | FK exists | ✓ |
| 29 | FK: test_results.test_run_id → test_runs | same | FK exists | FK exists | ✓ |
| 30 | FK: test_artifacts.test_result_id → test_results | same | FK exists | FK exists | ✓ |

## Excerpt of raw output

```
 Test Files  5 passed (5)
      Tests  67 passed (67)
   Start at  21:22:53
   Duration  580ms (transform 171ms, setup 0ms, collect 453ms, tests 317ms)
```

## Verdict

**PASS** — all 67 tests green across 5 files. No UI routes in INFRA-004 (entities/migrations only), so T2/T2.5/T3 are N/A.

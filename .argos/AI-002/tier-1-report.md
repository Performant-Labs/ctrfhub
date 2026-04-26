# Tier 1 Headless Report — AI-002

**Executed:** 2026-04-26 09:01
**Method:** `buildApp({ testing: true, db: ':memory:', eventBus, aiProvider })` + direct function calls (no browser)

## Checks

| # | What is being verified | Method | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Consent gate skips when `AI_CLOUD_PIPELINE` unset | `categorizeRun()` direct call | No AI call, no event | 0 calls, 0 events | ✓ |
| 2 | Consent gate skips when `aiCloudAckAt` is NULL | `categorizeRun()` direct call | No AI call, no event | 0 calls, 0 events | ✓ |
| 3 | Consent gate passes when both gates satisfied | `categorizeRun()` direct call | 1 categorizeFailures call | 1 call observed | ✓ |
| 4 | Reserve → execute → commit lifecycle (happy path) | `categorizeRun()` + DB query | Log row `status='done'`, `completed_at` set, `tokens_used=50` | All confirmed | ✓ |
| 5 | `test_results` updated with `ai_category`, `ai_category_model`, `ai_category_at` | DB query after categorize | All 5 results have `app_defect`, `mock-model`, non-null timestamp | All confirmed | ✓ |
| 6 | Publishes `run.ai_categorized` with correct payload | `eventBus.published` inspection | 1 event with `{ runId, orgId }` | 1 event, payload matches | ✓ |
| 7 | Skips when run has zero failed results | `categorizeRun()` direct call | No AI call, no event | 0 calls, 0 events | ✓ |
| 8 | Batches in groups of 20 — 50 results produce 3 calls | `aiProvider.calls` inspection | 3 calls: 20, 20, 10 | Exactly 3 calls, batch sizes correct | ✓ |
| 9 | Caps at 500 failed results for 600-failure run | `aiProvider.calls` inspection | 25 calls, total 500 results | 25 calls, 500 total | ✓ |
| 10 | Transient error (attempt < 3) releases row to pending | DB query after error | `status='pending'`, `error` set, no event | Confirmed | ✓ |
| 11 | Terminal error (attempt ≥ 3) marks failed + partial event | DB query + eventBus | `status='failed'`, 1 event with `partial: true` | Confirmed | ✓ |
| 12 | Boot-time recovery reclaims stale heartbeat rows | `recoverStalePipelineRows()` + DB | `status='pending'`, `worker_id=NULL` | Confirmed | ✓ |
| 13 | Boot-time recovery terminal-fails exhausted rows | `recoverStalePipelineRows()` + DB | `status='failed'`, error contains 'Maximum retry' | Confirmed | ✓ |
| 14 | Heartbeat cleared on completion (`heartbeat_at=NULL`, `worker_id=NULL`) | DB query after done | NULL values | Confirmed | ✓ |
| 15 | `started_at` timestamp set on first reservation | DB query | Non-null `started_at` | Confirmed | ✓ |
| 16 | Idempotency: skips LLM when results already categorized | Pre-seed + `categorizeRun()` | 0 AI calls, 1 event published | 0 calls, 1 event | ✓ |
| 17 | EventBus subscription wired at boot when aiProvider injected | Publish `run.ingested`, verify handler runs | Handler runs (consent gate blocks silently) | No error, no crash | ✓ |
| 18 | Full pipeline triggered via EventBus publish | Publish event, wait, check AI calls | 1 categorizeFailures call, 1 categorized event | Both confirmed | ✓ |
| 19 | Recovery re-enqueues pending rows by publishing events | Seed pending row, run recovery | 1 `run.ingested` event with correct payload | Confirmed | ✓ |
| 20 | No real AI SDK imports in test file | Static regex check | 0 matches for `openai`, `@anthropic-ai`, `groq-sdk` | 0 matches | ✓ |

## Unit test coverage (consent gate — Layer 1)

| # | What is being verified | Method | Expected | Actual | Status |
|---|---|---|---|---|---|
| U1 | Returns false when `AI_CLOUD_PIPELINE` unset | EM stub | `false` | `false` | ✓ |
| U2 | Returns false when `AI_CLOUD_PIPELINE` is empty | EM stub | `false` | `false` | ✓ |
| U3 | Returns false when `AI_CLOUD_PIPELINE` is "off" | EM stub | `false` | `false` | ✓ |
| U4 | Returns false when `AI_CLOUD_PIPELINE` is "true" | EM stub | `false` | `false` | ✓ |
| U5 | Returns true when `AI_CLOUD_PIPELINE` is "ON" (case-insensitive) | EM stub | `true` | `true` | ✓ |
| U6 | Returns true when `AI_CLOUD_PIPELINE` is "on" | EM stub | `true` | `true` | ✓ |
| U7 | Returns false when org not found | EM stub (null) | `false` | `false` | ✓ |
| U8 | Returns false when `aiCloudAckAt` is null | EM stub | `false` | `false` | ✓ |
| U9 | Returns true when `aiCloudAckAt` is a valid Date | EM stub | `true` | `true` | ✓ |
| U10 | Both gates: env on + ack null → false | EM stub | `false` | `false` | ✓ |
| U11 | Both gates: env unset + ack set → false | EM stub | `false` | `false` | ✓ |
| U12 | Both gates: env on + ack set → true | EM stub | `true` | `true` | ✓ |

## Excerpt of raw output

```
 Test Files  19 passed (19)
      Tests  403 passed (403)
   Start at  08:59:41
   Duration  7.77s (transform 657ms, setup 0ms, collect 8.42s, tests 7.37s, environment 3ms, prepare 1.46s)
```

## Verdict

**PASS** — all 20 integration checks + 12 unit checks green. No rendered routes in AI-002, so T2/T2.5/T3 are N/A. Proceed to test-handoff.

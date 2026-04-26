# Test Handoff — AI-002

**Branch:** `story/AI-002`
**Commits added by Test-writer:**
- 90dda89 test(AI-002): add consent gate unit tests and missing integration coverage

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/AI-002/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — no rendered routes touched | — |
| T2.5 Authenticated State (browser-harness) | N/A — no rendered routes touched | — |
| T3 Visual | N/A — non-UI story | — |
| Backdrop-contrast | N/A | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | `src/__tests__/unit/ai-consent-gate.test.ts` | 12 | Deployment gate (env var), per-org gate (aiCloudAckAt), both-gates-combined |
| Integration | `src/__tests__/integration/ai-categorization.test.ts` | 6 (added to existing 13 = 19 total) | Heartbeat, idempotency, EventBus subscription wiring, recovery re-enqueue |
| E2E | — | 0 | No rendered routes — E2E not applicable |

### Tests already authored by Feature-implementer (audited ✓)

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | `src/__tests__/unit/ai-pipeline-schemas.test.ts` | 23 | AiCategoryEnum + CategorizeOutputSchema validation |
| Integration | `src/__tests__/integration/ai-categorization.test.ts` (original) | 13 | Consent gate, happy path, batching, cap-500, error handling, boot recovery, event publishing, SDK import check |
| Integration | `src/__tests__/integration/schema-sqlite.test.ts` (extended) | 2 additions | `ai_pipeline_log` table columns + FK assertion |

## Coverage (from `npm run test:coverage`)

Lines: 82.62% · Functions: 74.57% · Branches: 83.77%
Thresholds: lines ≥ 80 ✓, functions ≥ 80 ✗, branches ≥ 75 ✓.

> **Functions threshold miss (74.57% vs 80%) is a pre-existing condition from AI-001**, not introduced by AI-002. The gap comes entirely from `src/services/ai/providers/` (openai.ts, anthropic.ts, groq.ts at ~31% function coverage) — these contain real SDK calls that are intentionally untested per the "no real LLM calls in tests" rule. All AI-002-specific files have 90-100% function coverage:
>
> | File | Lines | Branches | Functions |
> |---|---|---|---|
> | `consent.ts` | 100% | 100% | 100% |
> | `recovery.ts` | 100% | 100% | 100% |
> | `schemas.ts` | 100% | 100% | 100% |
> | `categorizer.ts` | 90.13% | 73.52% | 100% |
> | `index.ts` (barrel) | 100% | 100% | 100% |

## Critical test paths — audit against brief

All critical test paths from `.argos/AI-002/brief.md §Critical test paths` are covered:

| Critical path | Test location | Status |
|---|---|---|
| `AiPipelineLog` entity on both dialects | `schema-sqlite.test.ts` lines 257-283 | ✓ Feature-implementer |
| A1 subscribes to `run.ingested` | `ai-categorization.test.ts` Suite 9 | ✓ Test-writer added |
| Reserve → execute → commit lifecycle | `ai-categorization.test.ts` Suite 2 | ✓ Feature-implementer |
| Heartbeat advances | `ai-categorization.test.ts` Suite 7 | ✓ Test-writer added |
| Boot-time recovery: stale → pending | `ai-categorization.test.ts` Suite 5 | ✓ Feature-implementer |
| Boot-time recovery: exhausted → failed | `ai-categorization.test.ts` Suite 5 | ✓ Feature-implementer |
| Boot-time recovery: re-enqueue pending | `ai-categorization.test.ts` Suite 10 | ✓ Test-writer added |
| Consent gate denies (env + ack) | `ai-categorization.test.ts` Suite 1 + `ai-consent-gate.test.ts` | ✓ Both |
| Batch size 20 | `ai-categorization.test.ts` Suite 3 | ✓ Feature-implementer |
| Cap 500 failed results | `ai-categorization.test.ts` Suite 3 | ✓ Feature-implementer |
| Publishes `run.ai_categorized` | `ai-categorization.test.ts` Suite 6 | ✓ Feature-implementer |
| No real LLM calls | `ai-categorization.test.ts` Suite 11 + grep verification | ✓ Both |
| Idempotency check | `ai-categorization.test.ts` Suite 8 | ✓ Test-writer added |

## Non-blocking issues

- **Functions coverage threshold miss** (74.57% vs 80%) — pre-existing from AI-001 real provider files. Not a blocker for AI-002. Should be tracked as a chore: either exclude `src/services/ai/providers/` from coverage, or lower the functions threshold for files that contain SDK wrappers.

## Next action (Spec-enforcer)

1. Open a new session. Paste `.antigravity/agents/spec-enforcer.md` as the first message, then this handoff as the second.
2. Check out `story/AI-002`.
3. Run the Audit Checklist and write the verdict to `.argos/AI-002/spec-audit.md` (template in `.antigravity/agents/spec-enforcer.md`).

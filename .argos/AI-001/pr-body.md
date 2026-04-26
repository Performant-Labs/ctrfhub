# [AI-001] AiProvider interface and MockAiProvider

## Summary

Ships the `AiProvider` interface that anchors the entire AI pipeline contract, plus three real implementations (OpenAI, Anthropic, Groq) selectable via `AI_PROVIDER` env, plus the `MockAiProvider` test double that downstream AI stories use exclusively. Also extracts a shared `prompts.ts` module so all three providers reference the same system prompts (no drift). Wires `AppOptions.aiProvider` as a DI seam: undefined when `AI_PROVIDER` isn't set (per `ai-features.md §Privacy` — no errors, no nagging), real provider when it is, MockAiProvider when tests inject one.

## Acceptance criteria

- [x] `AiProvider` interface in `src/services/ai/types.ts` with three async methods: `categorizeFailures`, `correlateRootCauses`, `generateRunSummary` (plus `close()` for graceful shutdown). SDK-agnostic — no OpenAI/Anthropic/Groq types leak into signatures.
- [x] `MockAiProvider` in `src/__tests__/doubles/MockAiProvider.ts`. Records every invocation in `calls[]` (deep-cloned to prevent post-recording mutation). Setter methods accept single value or sequence array. Throws on unset response with descriptive message (catches test bugs at write-time).
- [x] Real provider implementations in `src/services/ai/providers/`: `OpenAiProvider` (default `gpt-4o-mini`), `AnthropicProvider` (default `claude-haiku-4-5-20251001`), `GroqProvider` (default `llama-3.3-70b-versatile`). Each implements `AiProvider`. Default model strings sourced from `ai-features.md §Default models` line 47.
- [x] `createAiProvider()` factory in `src/services/ai/index.ts` keyed on `process.env.AI_PROVIDER` ∈ `{openai, anthropic, groq}`. Throws on unknown when not in test mode. Validates `AI_API_KEY` presence.
- [x] Pure helpers in `src/services/ai/helpers.ts`: `getEffectiveCategory`, `getCategorySource`, `splitIntoBatches` (default batch size 20).
- [x] Unit tests for all helpers, all `MockAiProvider` setter/getter pairs, type-level satisfaction tests for each real provider, and shared prompt-builder coverage.
- [x] `AppOptions.aiProvider` DI seam wired in `src/app.ts` (additive — INFRA-002 already declared the slot). Conditional construction: undefined when `AI_PROVIDER` not set or `testing: true`.
- [x] `src/types.ts` re-exports `AiProvider` so downstream code has one canonical import path.

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | yes | ✓ | **97 new tests across 4 files**: 27 in `ai-helpers.test.ts`, 25 in `mock-ai-provider.test.ts`, 16 in `ai-providers.test.ts` (type-level satisfaction + factory), 29 in `ai-prompts.test.ts` (shared prompt-builder coverage). |
| Integration | no | N/A | Not required by `tasks.md §AI-001`. AI integration tests land in AI-002 using `MockAiProvider`. |
| E2E | no | N/A | Not required — no UI in scope here. |

Full suite: **258/258 tests pass** (97 new + 161 existing).

## Page verification tiers

None — `tasks.md §AI-001` declares no rendered routes.

## Decisions that deviate from spec

The spec-enforcer audit returned **PASS with zero findings**. The following seven decisions are documented in `.argos/AI-001/feature-handoff.md` and surfaced here for André's independent review:

1. **Shared prompts module (`src/services/ai/prompts.ts`).** Not in the brief, but all three real providers need identical prompts; without a shared module they'd duplicate 3× and drift. Extracted into `prompts.ts` co-located with the provider classes.
2. **OpenAI SDK v6, not v4.** `openai@^4` peer-depends on `zod@^3`; the project uses `zod@^4`. Bumped to `openai@^6.34` (supports `zod@^3.25 || ^4.0`); v6's `chat.completions.create()` is wire-compatible with v4.
3. **`MockAiProvider` throws on unset response** (brief said implementer's choice). Rationale: silent placeholders mask test bugs (test forgets to seed → gets empty data → passes when it shouldn't); a throw forces explicit seeding and catches omissions at test-write time.
4. **Setter sequence support.** Setters accept `single | array`. Single value is returned on every call (never exhausted); array is returned in order and throws when exhausted with a descriptive message. Accommodates both "same response every time" and "different response per batch" scenarios.
5. **`MockAiProvider.calls[]` deep-clones inputs** via `structuredClone()` so post-recording mutation in tests can't taint the call log.
6. **`ResponseQueue` is a private class inside `MockAiProvider.ts`,** not exported. Single vs sequence state machine — implementation detail.
7. **`app.ts` wiring is conditional on `AI_PROVIDER` and `testing`.** When env unset or testing flag true, `aiProvider` stays `undefined` — no errors, no "configure AI" nagging, per `ai-features.md §Privacy and consent`.

## Coverage note (informational, non-blocking)

`npm run test:coverage` shows: Lines **80.17% PASS**, Branches **83.64% PASS**, **Functions 70.37% (under the 80% threshold)**.

The functions gap is **structurally caused by the forbidden-pattern rule against real LLM calls in tests** (`skills/ai-pipeline-event-bus.md` + `skills/vitest-three-layer-testing.md`). The 12 uncovered functions are all real-provider SDK methods (`categorizeFailures`, `correlateRootCauses`, `generateRunSummary`, `close` × 3 providers). All code AI-001 wrote *that can be covered without violating forbidden patterns* sits at 100%.

CI's `Unit Tests` job runs `npm run test:unit` (no threshold gate); thresholds only fire on `npm run test:coverage`. So this **does not block merge**. The right long-term fix is a small `vitest.config.ts` `coverage.exclude` entry for `src/services/ai/providers/*.ts` — happy to do that as a tiny follow-up, or fold into AI-002 when those provider methods get exercised via `MockAiProvider`-driven integration tests.

## Known follow-ups (documented, deferred)

From the feature-handoff:
- **Prompt quality is minimal.** Shared system prompts in `prompts.ts` are functional starting points. AI-002 / AI-003 should refine them with structured-output instructions, few-shot examples, response validation.
- **No JSON response validation in real providers.** They `JSON.parse()` LLM output and trust the structure. Production-ready impl should validate via Zod. AI-002's reserve-execute-commit pattern in `ai_pipeline_log` is the natural place for this — failed parses become retryable errors.
- **No retry logic in real providers.** Per the brief, retry is the pipeline's responsibility (AI-002 in `ai_pipeline_log`). Real providers stay thin SDK wrappers.
- **`vitest.config.ts` coverage exclusion** for real provider files — see Coverage note above.

## Gaps filed during this story

None.

## Spec-enforcer verdict

**PASS** — see `.argos/AI-001/spec-audit.md`
**Date:** 2026-04-25
**Findings:** 0 blocking, 0 NIT, 0 coverage gaps (the functions-threshold question is structurally accepted), 0 forbidden patterns, 0 planning-doc drift.

## Next assignable stories (after this merges)

- **AI-002** — AI pipeline A1 categorization (deps AI-001 ✅, CTRF-002 ✅). Now unblocked.
- **AI-003** — A2 root-cause correlation + A3 run narrative (deps AI-002).
- **CI-003** — Tugboat per-PR preview (deps AUTH-001 / CI-001 / CI-002 — all ✅; **already in flight on `story/CI-003`**).
- **CTRF-003 / CTRF-004 / DATA-001** — still always-ready.
- **AUTH-002 / AUTH-003 / DASH-* / SET-* / SSE-001 / SRCH-001** — still blocked on G-P0-001 / G-P0-002 (INFRA-003 chain) or G-P0-003 (settings DB schema gap).

---
_Generated from `.argos/AI-001/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._

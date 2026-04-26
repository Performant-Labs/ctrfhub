# Feature Handoff — AI-001: AiProvider interface and MockAiProvider

**Branch:** `story/AI-001`
**Commits on this branch since `main`:**
- 96fb697 chore(AI-001): assign
- eadd704 feat(AI-001): AiProvider interface, real providers, MockAiProvider, helpers, factory

## What was built

- `AiProvider` interface with three async methods: `categorizeFailures()`, `correlateRootCauses()`, `generateRunSummary()`, plus `close()` for graceful shutdown
- Six payload types: `CategorizeFailuresInput/Output`, `CorrelateRootCausesInput/Output`, `GenerateRunSummaryInput/Output` — all SDK-agnostic
- `AiCategory` type: `'app_defect' | 'test_data' | 'script_error' | 'environment' | 'unknown'`
- Three real provider implementations: `OpenAiProvider` (default: `gpt-4o-mini`), `AnthropicProvider` (default: `claude-haiku-4-5-20251001`), `GroqProvider` (default: `llama-3.3-70b-versatile`)
- Shared `prompts.ts` module: system prompts and prompt builders shared across all providers to prevent prompt drift
- `MockAiProvider` test double: SDK-free, records every call in `calls[]`, supports single or sequence response seeding via `setCategorization()/setRootCauses()/setSummary()`, **throws on unset response** (catches test bugs early)
- Three pure helper functions: `getEffectiveCategory()`, `getCategorySource()`, `splitIntoBatches()` (default batch size 20)
- `createAiProvider()` factory: keyed on `AI_PROVIDER` env var, validates `AI_API_KEY` presence, throws on unknown provider
- `src/types.ts` re-exports `AiProvider` from `./services/ai/types.js` (replacing the previous close-only stub)
- `src/app.ts` DI seam: constructs real provider from env when `AI_PROVIDER` is set and not in test mode; tests inject `MockAiProvider` explicitly

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run test:unit` — 161/161 tests passed (all existing tests, no regressions)
- `npm run dev` (via `npx tsx src/index.ts`) — server booted on :3000, migrations ran, clean SIGTERM shutdown
- `npm install` — 0 vulnerabilities

## Files created or modified

Grouped by directory:

- `src/services/ai/types.ts` — AiProvider interface + all payload types (AiCategory, CategorizeFailures I/O, CorrelateRootCauses I/O, GenerateRunSummary I/O)
- `src/services/ai/helpers.ts` — getEffectiveCategory(), getCategorySource(), splitIntoBatches() pure functions
- `src/services/ai/prompts.ts` — shared system prompts and prompt builders for all three providers
- `src/services/ai/index.ts` — createAiProvider() factory + re-exports of all types and helpers
- `src/services/ai/providers/openai.ts` — OpenAiProvider wrapping `openai` SDK v6
- `src/services/ai/providers/anthropic.ts` — AnthropicProvider wrapping `@anthropic-ai/sdk`
- `src/services/ai/providers/groq.ts` — GroqProvider wrapping `groq-sdk`
- `src/__tests__/doubles/MockAiProvider.ts` — SDK-free test double with calls[] + setters
- `src/types.ts` — replaced stub AiProvider with re-export from services/ai/types.ts
- `src/app.ts` — wired aiProvider DI seam with createAiProvider() import and env-conditional construction
- `package.json` — added openai@^6.34, @anthropic-ai/sdk@^0.91, groq-sdk@^1.1

## Decisions not covered by planning docs

- **Shared prompts module (`src/services/ai/prompts.ts`):** Not in the brief or spec, but all three providers need identical prompts. Without a shared module, prompt content would be duplicated 3x and drift. Decision: extract into `prompts.ts` in the same `services/ai/` directory.
- **OpenAI SDK v6 (not v4):** `openai@^4` has a peer dependency on `zod@^3` which conflicts with the project's `zod@^4`. Bumped to `openai@^6.34` which supports `zod@^3.25 || ^4.0`. The v6 API is wire-compatible with v4 for `chat.completions.create()`.
- **MockAiProvider throws on unset response:** Brief says "throws or returns placeholder — implementer's choice". Chose throw. Rationale: a silent placeholder could mask test bugs (test forgets to seed → gets empty data → passes when it shouldn't). A throw forces explicit seeding, catching omissions at test-write time.
- **MockAiProvider sequence support:** Setters accept `single | array`. Single value is returned on every call (never exhausted). Array is returned in order; throws when exhausted with a descriptive message. This accommodates both "same response every time" and "different response per batch" test scenarios.
- **Input deep-cloned on recording:** `MockAiProvider.calls[]` stores `structuredClone(input)` to prevent tests from accidentally mutating recorded calls after the fact.
- **ResponseQueue internal class:** Private helper class inside MockAiProvider.ts manages single vs sequence state. Not exported — implementation detail.
- **`app.ts` wiring is conditional on `AI_PROVIDER`:** When `AI_PROVIDER` is not set, `aiProvider` is `undefined` — no error thrown, features silently disabled. This matches `ai-features.md §Privacy`: "no errors, no 'configure AI' nagging on every page."

## Known issues / follow-ups

- **Prompt quality is minimal:** System prompts and prompt builders are functional starting points. AI-002/AI-003 should refine them with better structured output instructions, few-shot examples, and response validation.
- **No JSON response validation:** Real providers parse LLM output with `JSON.parse()` and trust the structure. A production-ready implementation should validate with Zod schemas to handle malformed LLM output gracefully.
- **No retry logic in providers:** The brief scopes retry to AI-002 (reserve-execute-commit pattern in `ai_pipeline_log`). Real providers here are thin SDK wrappers — retry and error handling is the pipeline's responsibility.
- **`package-lock.json` diff is large:** 6 new packages (3 SDKs + transitive deps). If INFRA-005 also touches `package.json`, the lockfile conflict is resolvable with `npm install` on the merged branch.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/AI-001` (already on it if continuing locally).
3. Start with T1 Headless (unit tests only — no DB or HTTP in scope). Files to test:
   - `src/__tests__/unit/ai-helpers.test.ts` — getEffectiveCategory, getCategorySource, splitIntoBatches
   - `src/__tests__/unit/mock-ai-provider.test.ts` — MockAiProvider setter/getter contract: single response, sequence, throw on unset, calls[] recording, reset()
   - `src/__tests__/unit/ai-providers.test.ts` — Type-level assertions that each provider class satisfies AiProvider (compile-time checks, no runtime API calls)
4. The MockAiProvider's "throw on unset" behavior is the key contract to test — ensure it throws with descriptive messages and that each setter mode (single vs sequence) works correctly.

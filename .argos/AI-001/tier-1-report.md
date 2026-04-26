# Tier 1 Headless Report — AI-001

**Executed:** 2026-04-25 19:45
**Method:** Vitest `npm run test:unit` (no browser, no HTTP, no DB)

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | `getEffectiveCategory` override wins over AI category | `getEffectiveCategory({ aiCategory: 'environment', aiCategoryOverride: 'app_defect' })` | `'app_defect'` | `'app_defect'` | ✓ |
| 2 | `getEffectiveCategory` falls back to AI category when no override | `getEffectiveCategory({ aiCategory: 'test_data' })` | `'test_data'` | `'test_data'` | ✓ |
| 3 | `getEffectiveCategory` returns null when neither set | `getEffectiveCategory({})` | `null` | `null` | ✓ |
| 4 | `getCategorySource` returns `'manual'` when override set | `getCategorySource({ aiCategoryOverride: 'app_defect' })` | `'manual'` | `'manual'` | ✓ |
| 5 | `getCategorySource` returns `'ai'` when only AI category set | `getCategorySource({ aiCategory: 'test_data' })` | `'ai'` | `'ai'` | ✓ |
| 6 | `getCategorySource` returns null when neither set | `getCategorySource({})` | `null` | `null` | ✓ |
| 7 | `splitIntoBatches` handles remainder batch | `splitIntoBatches([1,2,3,4,5], 2)` | `[[1,2],[3,4],[5]]` | `[[1,2],[3,4],[5]]` | ✓ |
| 8 | `splitIntoBatches` uses default size 20 | `splitIntoBatches(45 items)` | 3 batches (20,20,5) | 3 batches (20,20,5) | ✓ |
| 9 | `splitIntoBatches` throws on zero size | `splitIntoBatches([1,2], 0)` | throws | throws 'Batch size must be positive' | ✓ |
| 10 | `splitIntoBatches` empty input → empty output | `splitIntoBatches([])` | `[]` | `[]` | ✓ |
| 11 | `MockAiProvider` throws on unset response | `ai.categorizeFailures(input)` | rejects with error | rejects: 'no response has been set' | ✓ |
| 12 | `MockAiProvider` single mode returns same response on every call | `ai.setCategorization(out); call ×2` | both return `out` | both return `out` | ✓ |
| 13 | `MockAiProvider` sequence mode returns in order | `ai.setCategorization([out1, out2])` | 1st=out1, 2nd=out2 | 1st=out1, 2nd=out2 | ✓ |
| 14 | `MockAiProvider` sequence exhaustion throws | `ai.setCategorization([out]); call ×2` | 2nd call rejects | rejects: 'response sequence exhausted' | ✓ |
| 15 | `MockAiProvider.calls[]` deep-clones input | mutate input after call | recorded input unchanged | recorded input unchanged | ✓ |
| 16 | `MockAiProvider.reset()` clears calls and responses | `ai.reset()` | calls empty, methods throw | calls empty, methods throw | ✓ |
| 17 | `OpenAiProvider` satisfies `AiProvider` | `const _: AiProvider = new OpenAiProvider(...)` | compiles | compiles + defined | ✓ |
| 18 | `AnthropicProvider` satisfies `AiProvider` | `const _: AiProvider = new AnthropicProvider(...)` | compiles | compiles + defined | ✓ |
| 19 | `GroqProvider` satisfies `AiProvider` | `const _: AiProvider = new GroqProvider(...)` | compiles | compiles + defined | ✓ |
| 20 | `createAiProvider()` throws when `AI_PROVIDER` not set | `createAiProvider()` (env unset) | throws | throws 'AI_PROVIDER environment variable is not set' | ✓ |
| 21 | `createAiProvider()` throws when `AI_API_KEY` not set | env: AI_PROVIDER=openai, no key | throws | throws 'AI_API_KEY environment variable is not set' | ✓ |
| 22 | `createAiProvider()` throws on unknown provider | env: AI_PROVIDER=deepseek | throws | throws 'Unknown AI_PROVIDER: "deepseek"' | ✓ |
| 23 | `createAiProvider()` creates correct provider per env var | AI_PROVIDER=openai/anthropic/groq | correct class instance | correct class instance | ✓ |
| 24 | Prompt builders include run IDs and result counts | `buildCategorizationPrompt/buildCorrelationPrompt/buildSummaryPrompt` | contain run IDs, counts | contain run IDs, counts | ✓ |
| 25 | Prompt builders replace null fields with "(none)" | `buildCategorizationPrompt({ ... errorMessage: null })` | JSON contains "(none)" | JSON contains "(none)" | ✓ |
| 26 | `buildSummaryPrompt` computes pass rate delta | input with previousPassRate | contains delta string | contains "-5.0%" | ✓ |
| 27 | System prompts reference all 5 categories | `CATEGORIZATION_SYSTEM_PROMPT` | contains all 5 | contains all 5 | ✓ |

## Excerpt of raw output

```
 ✓ src/__tests__/unit/ai-helpers.test.ts (27 tests) 10ms
 ✓ src/__tests__/unit/mock-ai-provider.test.ts (25 tests) 25ms
 ✓ src/__tests__/unit/ai-providers.test.ts (16 tests) 7ms
 ✓ src/__tests__/unit/ai-prompts.test.ts (29 tests) 6ms

 Test Files  11 passed (11)
      Tests  258 passed (258)
   Duration  2.34s
```

## Verdict

**PASS** — all 97 new unit tests green, zero regressions (161 pre-existing → 258 total). No T2/T2.5/T3 required (non-UI story per brief).

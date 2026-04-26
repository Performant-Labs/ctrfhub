# Task Brief — AI-001: AiProvider interface and MockAiProvider

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: INFRA-001 ✅ (npm scripts, tsconfig, vitest config all in place).
- [x] No P0 gap blocks this story. **G-P1-003** (Wrong Anthropic model name `claude-haiku-3-5` → `claude-haiku-4-5-20251001`) was already fixed in `ai-features.md` line 47 prior to this brief; `gaps.md` is being marked ✅ Resolved in a parallel chore PR.
- [x] Branch cut: `story/AI-001` from `main` @ a982fc8 (post-INFRA-005 assign commit).
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(AI-001): assign`, brief committed alongside per the PR #17 convention).
- [x] **Parallel story:** INFRA-005 is being implemented in another workspace at the same time. **Zero file overlap** — INFRA-005 lives in `src/app.ts` boot path, `src/migrations/`, `src/mikro-orm.config.*`, `package.json` `migrate:*` scripts. AI-001 lives in `src/services/ai/` (new directory), `src/__tests__/unit/`, `src/__tests__/doubles/`, plus `src/types.ts` (re-export) and `src/app.ts` `AppOptions` (additive — adds `aiProvider` injection, no boot-path change). The only theoretical overlap is `package.json` (AI-001 adds SDK deps; INFRA-005 renames migrate scripts). Coordinate via André if a real edit conflict shows up.

## Story

**Description.** Ship the `AiProvider` interface and three real implementations (OpenAI, Anthropic, Groq) selectable via the `AI_PROVIDER` env var, plus a `MockAiProvider` test double that future AI stories use exclusively. This is the **contract surface** for the entire AI pipeline (A1 categorization, A2 root-cause correlation, A3 run narrative). Get the interface right — AI-002 / AI-003 / AI-004 wire downstream against it.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §AI-001, broken into bullets)

- `AiProvider` interface in `src/services/ai/types.ts` with three async methods: `categorizeFailures(input)`, `correlateRootCauses(input)`, `generateRunSummary(input)`. Payload types defined alongside per `ai-features.md §A1 / A2 / A3`. SDK-agnostic — the interface must not leak OpenAI / Anthropic / Groq SDK types.
- `MockAiProvider` test double in `src/__tests__/doubles/MockAiProvider.ts`. Records every invocation in a `calls[]` array for test assertions. Setter methods (`setCategorization(...)`, `setRootCauses(...)`, `setSummary(...)`) seed deterministic responses. Throws on unknown method calls (or unset response — implementer's choice; document in feature-handoff).
- Real provider implementations in `src/services/ai/providers/`: `OpenAiProvider`, `AnthropicProvider`, `GroqProvider`. Each implements `AiProvider`. Each uses its respective SDK (`openai`, `@anthropic-ai/sdk`, `groq-sdk`). Default model strings come from `ai-features.md §Default models` table (line 47): `claude-haiku-4-5-20251001` for Anthropic, `gpt-4o-mini` for OpenAI, `llama-3.3-70b-versatile` for Groq.
- A factory function in `src/services/ai/index.ts` (or `factory.ts`) that returns a real provider based on `process.env.AI_PROVIDER` ∈ `{openai, anthropic, groq}`, or throws on unknown / unset (when `NODE_ENV !== 'test'`).
- Display helpers `getEffectiveCategory(testResult)` and `getCategorySource(testResult)` in `src/services/ai/helpers.ts`. Pure functions; semantics per `ai-features.md §Display logic`.
- Batch helper `splitIntoBatches(items, size)` in the same file. Pure function; default batch size `20` per `ai-features.md §A1 batching`.
- Unit tests for: `getEffectiveCategory`, `getCategorySource`, `splitIntoBatches`, `MockAiProvider` setter/getter pairs (no real LLM calls). Place in `src/__tests__/unit/`.
- `AppOptions` in `src/app.ts` extended with optional `aiProvider?: AiProvider` (already declared per INFRA-002's spec — confirm and wire the default: `MockAiProvider` when `testing: true`, real factory otherwise).
- `src/types.ts` re-exports `AiProvider` so downstream code has one canonical import path.

**Test tiers required.** Unit only. No integration (no DB or HTTP touched here). No E2E.

**Page verification tiers.** None (no rendered routes).

**Critical test paths.** (verbatim from `tasks.md`, broken out)

- `AiProvider` interface has `categorizeFailures`, `correlateRootCauses`, `generateRunSummary`.
- `MockAiProvider.calls[]` records invocations for assertions.
- `OpenAiProvider` / `AnthropicProvider` / `GroqProvider` selected by `AI_PROVIDER` env.
- Unit tests for `getEffectiveCategory`, `getCategorySource`, `splitIntoBatches`.

## Required reading

**Skills (full paths — read before any code).**

- `skills/ai-pipeline-event-bus.md` — **primary skill.** Defines: how `AiProvider` plugs into the EventBus, the reserve-execute-commit pattern that AI-002 will use against `ai_pipeline_log`, and the **mandatory rule** that no real LLM calls happen in tests (CLAUDE.md "Forbidden patterns" inherits this).
- `skills/vitest-three-layer-testing.md` — Layer 1 unit-test patterns. `MockAiProvider` is the canonical AI test double; the file at `src/__tests__/doubles/MockAiProvider.ts` is the home documented elsewhere in the spec.

**Planning doc sections.**

- `docs/planning/ai-features.md` — full pipeline spec. Particularly:
  - §A1 Per-test categorization (request/response shape for `categorizeFailures`)
  - §A2 Root cause correlation (shape for `correlateRootCauses`)
  - §A3 Run narrative (shape for `generateRunSummary`)
  - §Default models (the line-47 table is the canonical source of model names per provider)
  - §Privacy and consent (the two-gate consent model — out of scope here, but the interface must accommodate provider-aware rejection in future AI-004 settings work)
  - §Durability and restart recovery (the `ai_pipeline_log` reserve-execute-commit pattern AI-002 implements)
- `docs/planning/architecture.md §Environment variables` — `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_CLOUD_PIPELINE`. Use these env names verbatim.
- `docs/planning/tasks.md §AI-001` — canonical acceptance source.
- `docs/planning/tasks.md §AI-002 / §AI-003 / §AI-004` — downstream consumers of your interface. Read briefly so you don't accidentally constrain them.

**Org-wide context (optional deep-dive).** Each cited skill has a `source:` frontmatter line pointing at Performant Labs's org-wide standards under `docs/ai_guidance/`. Following the source is for broader context, not required to do the work.

## Files in scope

- `src/services/ai/types.ts` (new) — `AiProvider` interface + payload types (`CategorizeFailuresInput`, `CategorizeFailuresOutput`, etc.).
- `src/services/ai/index.ts` (new) — factory `createAiProvider()` keyed on `process.env.AI_PROVIDER`. Re-exports interface + provider classes.
- `src/services/ai/providers/openai.ts` (new) — `OpenAiProvider implements AiProvider` using the `openai` package.
- `src/services/ai/providers/anthropic.ts` (new) — `AnthropicProvider implements AiProvider` using the `@anthropic-ai/sdk` package.
- `src/services/ai/providers/groq.ts` (new) — `GroqProvider implements AiProvider` using the `groq-sdk` package.
- `src/services/ai/helpers.ts` (new) — `getEffectiveCategory`, `getCategorySource`, `splitIntoBatches`.
- `src/__tests__/doubles/MockAiProvider.ts` (new) — `MockAiProvider implements AiProvider` with `calls[]` and setter methods.
- `src/__tests__/unit/ai-helpers.test.ts` (new) — unit tests for helpers.
- `src/__tests__/unit/mock-ai-provider.test.ts` (new) — unit tests for the mock's setter/getter contract.
- `src/__tests__/unit/ai-providers.test.ts` (new, type-level) — TypeScript type assertions that each provider class satisfies the `AiProvider` interface (no runtime API calls; just `const _: AiProvider = new OpenAiProvider({...})` compile-time checks).
- `src/types.ts` — re-export `AiProvider` (additive — won't conflict with INFRA-005's `EventBus` re-export).
- `src/app.ts` — wire `AppOptions.aiProvider` default. Additive only — `if (!options.aiProvider) options.aiProvider = options.testing ? new MockAiProvider() : createAiProvider();`. Don't touch the boot path beyond this DI seam (that's INFRA-005's territory).
- `package.json` — add SDK dependencies: `openai`, `@anthropic-ai/sdk`, `groq-sdk`. Coordinate with INFRA-005 implementer if you both need to edit `package.json` to avoid a merge conflict (their edits are to `migrate:*` → `schema:*` script renames; yours are dep additions — different sections, but same file).

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Real LLM API calls in any test file. Mandated by `skills/vitest-three-layer-testing.md` and `skills/ai-pipeline-event-bus.md`. **Even hitting a "test endpoint" or a "free tier" counts as a real API call here.** Tests use `MockAiProvider` exclusively.
- Importing OpenAI / Anthropic / Groq SDKs from `MockAiProvider`. The mock must be SDK-free.
- Leaking SDK types into `AiProvider`'s interface signatures. Use plain TypeScript types defined in `src/services/ai/types.ts`. Real providers convert between SDK types and our types internally.
- Using `any` for payload types. Define explicit `CategorizeFailuresInput` / `Output` etc. per `ai-features.md`.
- Hardcoded API keys. Read from `process.env.AI_API_KEY`.
- Hardcoded model names in provider classes. Use `process.env.AI_MODEL` with a default from the `ai-features.md §Default models` table (line 47).
- Touching DB schema, migrations, or `src/app.ts` boot-path code (those are INFRA-005's territory).

## Next action (Feature-implementer)

1. Open a fresh AntiGravity session. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief (`.argos/AI-001/brief.md`) as the second.
2. `git checkout story/AI-001 && git pull origin story/AI-001`.
3. Read `skills/ai-pipeline-event-bus.md` first (defines the contract surface), then `ai-features.md §A1/A2/A3 + Default models + Privacy and consent`.
4. Implement in this order:
   - **`src/services/ai/types.ts`** — interface + payload types. Get this right first; everything else depends on it.
   - **`src/services/ai/helpers.ts`** — pure functions (`getEffectiveCategory`, `getCategorySource`, `splitIntoBatches`). Easy to unit-test.
   - **`MockAiProvider`** — implements interface, no SDK deps. Unit-test its setter/getter contract.
   - **Real providers** — `OpenAiProvider`, `AnthropicProvider`, `GroqProvider`. Add SDKs to `package.json`. Implement each as a thin wrapper that converts SDK types ↔ our types. Type-level test that each satisfies `AiProvider`.
   - **Factory `createAiProvider()`** — env-keyed selector.
   - **`src/types.ts` and `src/app.ts`** — re-export interface; wire `AppOptions.aiProvider` default.
5. After each phase: `tsc --noEmit` (zero errors) and `npm run test:unit`.
6. Commit with `feat(AI-001): …`, `refactor(AI-001): …`, `fix(AI-001): …`, `test(AI-001): …`. `chore(AI-001): …` reserved for Argos status flips.
7. Write the feature-handoff to `.argos/AI-001/feature-handoff.md`. Be specific about: any AI-features.md spec ambiguity you surfaced, the exact payload shape you settled on for each interface method (this is what AI-002+ will lock against), how `MockAiProvider` handles "method called but no fixture set" (throw vs return placeholder), and any package.json conflicts with INFRA-005's branch you had to resolve.
8. Hand back to André so he can open the Test-writer step.

## Notes from Argos

- **The interface contract is the headline deliverable.** Future AI stories (AI-002 categorization pipeline, AI-003 root-cause + summary, AI-004 settings UI) all wire against `AiProvider`. Spend time on the payload shapes — getting them right now saves rework later. Use Zod schemas if it helps, but TypeScript types in `src/services/ai/types.ts` are the minimum.
- **`ai-features.md §Default models` line 47** is the canonical model-name source. The Anthropic value (`claude-haiku-4-5-20251001`) was the source of G-P1-003 — that gap is closed; you can trust the value as written.
- **MockAiProvider is everyone's friend.** Every downstream story uses it. Make it pleasant to seed: setters should accept either a single response or a sequence (so `setCategorization([resp1, resp2, resp3])` returns each on successive calls). Document the choice in the feature-handoff.
- **Event-bus subscription is NOT in scope here.** AI-002 wires `categorizeFailures` to the EventBus's `RunEvents.RUN_INGESTED`. Your job is to ship the *interface* AI-002 will subscribe with. Don't write subscription code in this story.
- **`ai_pipeline_log` table is also NOT in scope.** AI-002 ships that.
- **The brief itself is on the story branch** (per PR #17 convention).
- **Parallel-safety with INFRA-005:** INFRA-005 is rewriting the boot path and deleting `src/migrations/`. Your only meaningful edit to `src/app.ts` is adding the `aiProvider` DI seam. Make it surgical so INFRA-005's rebase is cheap.

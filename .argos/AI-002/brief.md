# Task Brief — AI-002: AI pipeline A1 categorization (Feature 3)

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: AI-001 ✅ (`AiProvider` interface, `MockAiProvider`, real providers, `splitIntoBatches`, `AppOptions.aiProvider` DI seam), CTRF-002 ✅ (`run.ingested` event published with `RunEvents.RUN_INGESTED`, `RunIngestedPayload`, `MemoryEventBus`).
- [x] No P0 gap blocks this story. **G-P0-004** (AI pipeline restart-recovery semantics) is ✅ Closed — `ai-features.md §Durability and restart recovery` is canonical. **G-P1-007** (run.ingested naming) is ✅ Resolved (PR #26).
- [x] Branch cut: `story/AI-002` from `main` @ a85b338 (post-#32 coverage-exclusion merge — actual base will be whatever `main` is at assign-time; no functional dependency on #32 merging first).
- [x] `tasks.md §AI-002` flipped `[ ]` → `[/]` on the story branch (commit `chore(AI-002): assign`, brief committed alongside per the PR #17 convention).
- [x] **Acceptance terminology note (post-INFRA-005):** the original `tasks.md §AI-002` acceptance reads "ai_pipeline_log table migrated (both dialects)" and "ai_category, ai_category_override, ai_category_model, ai_category_at columns on test_results". After INFRA-005, **migrations were replaced with schema-generator at boot** — the implementer adds an `AiPipelineLog` entity + extends `TestResult` with the four `ai_category*` fields, schema-generator creates the table and adds the columns automatically. The acceptance text is read as schema-generator-equivalent throughout this story (no migration files).
- [x] **Parallel story:** CI-003 (Tugboat phased) is being implemented in another workspace at the same time. **Zero file overlap** — CI-003 lives in `.tugboat/`, `.github/workflows/ci.yml`, `docs/planning/tasks.md`. AI-002 lives in `src/entities/`, `src/services/ai/pipeline/`, `src/__tests__/integration/`, `src/app.ts` (boot subscription — additive). The only theoretical overlap is `package.json` (dep additions); coordinate via André if either of you needs to add a package.

## Story

**Description.** Wire A1 (per-test categorization) into the AI pipeline. The pipeline subscribes to `run.ingested` (CTRF-002), reserves a row in `ai_pipeline_log` (a new durable journal table), executes categorization through the injected `AiProvider` (MockAiProvider in tests, real provider in prod) using `splitIntoBatches(batch=20)` (AI-001), commits results back to the run's `TestResult` rows via the four `ai_category*` columns, then publishes `run.ai_categorized` on the EventBus. The reserve-execute-commit pattern + heartbeat + boot-time recovery query are mandatory — the pipeline must survive process restarts mid-batch without leaving zombie state.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md §AI-002`, with the terminology note from §Preconditions applied)

- `AiPipelineLog` entity defined in `src/entities/AiPipelineLog.ts` per `database-design.md` and `ai-features.md §Durability and restart recovery`. Schema-generator creates the table on both dialects (no migration files).
- `TestResult` entity extended with four columns: `aiCategory`, `aiCategoryOverride`, `aiCategoryModel`, `aiCategoryAt` (typed per `database-design.md`).
- A1 categorization stage subscribes to `RunEvents.RUN_INGESTED` (subscribe wired in `src/app.ts` at boot when `aiProvider` is injected).
- Reserve-execute-commit pattern implemented in the categorizer: each `run.ingested` event reserves a row in `ai_pipeline_log` with `stage='categorize'`, `status='running'`, `started_at`, `worker_id`, `heartbeat_at` set; executes categorization in batches of 20 with `setImmediate` yielding between batches; commits results back to TestResults and flips the log row to `status='completed'` with `completed_at` set.
- Heartbeat every 15 s while `status='running'` (timer that updates `heartbeat_at`).
- Boot-time recovery query at app startup: scans `ai_pipeline_log` for rows where `stage='running'` AND `heartbeat_at < (NOW() - 60s)`, marks them `status='terminal_failed'` (or resumes per the `ai-features.md` policy — read the doc for the exact branch).
- Privacy / consent gate: A1 stage runs ONLY when `AI_CLOUD_PIPELINE='true'` env var is set AND the relevant `organizations.ai_cloud_ack_at` is not NULL. Otherwise the stage skips the run silently — no error, no log entry per `ai-features.md §Privacy and consent`.
- `splitIntoBatches(items, 20)` from AI-001 used; cap at 500 failed results per run.
- Publishes `RunEvents.RUN_AI_CATEGORIZED` to the EventBus on successful completion (constant added by AI-001 — verify it exists, otherwise add).
- Integration tests use `MockAiProvider` exclusively. **No real LLM calls in any test.**
- Existing 268+ tests still pass; new integration tests added in `src/__tests__/integration/ai-categorization.test.ts`.

**Test tiers required.** Integration. The pipeline is async, durable, and stateful — Layer 1 unit tests are insufficient. Use `buildApp({ testing: true, db: ':memory:', eventBus: new MemoryEventBus(), aiProvider: new MockAiProvider() })` per the canonical pattern in `testing-strategy.md §Example`.

**Page verification tiers.** None (no rendered routes touched).

**Critical test paths.** (verbatim from `tasks.md`, broken out for scannability)

- `AiPipelineLog` entity created on both dialects via schema-generator (verify in `src/__tests__/integration/schema-sqlite.test.ts` — extend that test's table-count assertion).
- A1 subscribes to `run.ingested` (assert via `MemoryEventBus.subscribers` snapshot).
- Reserve → execute → commit pattern observable in `ai_pipeline_log` rows: a single run produces one log row that transitions `status: 'reserved' → 'running' → 'completed'` with timestamps.
- Heartbeat every 15 s — assert that `heartbeat_at` advances during a long-running mock execution.
- Boot-time recovery: seed a row with `stage='running'` and stale `heartbeat_at`, boot the app, assert the row is now `terminal_failed` (or resumed per spec).
- Consent gate denies when `AI_CLOUD_PIPELINE` unset or `ai_cloud_ack_at` NULL — log row not created, no provider call made.
- Batch size 20 — assert `MockAiProvider.calls[0].input.tests.length === 20` for a 50-result run, with three calls total.
- Cap of 500 failed results per run — assert via a 600-failed-result fixture.
- Publishes `run.ai_categorized` on completion — assert via `MemoryEventBus.published`.
- **No real LLM calls** — grep `src/__tests__/integration/ai-categorization.test.ts` for `openai`, `@anthropic-ai`, `groq-sdk` returns zero matches.

## Required reading

**Skills (full paths — read before any code).**

- `skills/ai-pipeline-event-bus.md` — **primary skill.** Defines: how `AiProvider` plugs into the EventBus, the reserve-execute-commit pattern, the durable-journal model, the consent-gate semantics, and the "no real LLM calls in tests" rule. Read first.
- `skills/vitest-three-layer-testing.md` — Layer 2 integration test patterns. The `buildApp({ testing: true, ..., aiProvider: MockAiProvider })` pattern is the canonical injection contract.
- `skills/mikroorm-dual-dialect.md` — Entity definitions use `p.*` portable types; schema-generator handles dual-dialect creation post-INFRA-005.
- `skills/fastify-route-convention.md` — `request.em` is the canonical EM access pattern (you'll touch DB inside the categorizer service).

**Planning doc sections.**

- `docs/planning/ai-features.md §A1 Per-test categorization` — full spec: input shape, output shape, batch size, retry semantics, the five-category enum (`app_defect | test_data | script_error | environment | unknown`).
- `docs/planning/ai-features.md §Durability and restart recovery` — **the reserve-execute-commit canonical design.** This is the spec G-P0-004 was closed against; treat it as authoritative.
- `docs/planning/ai-features.md §Privacy and consent` — the two-gate consent model (`AI_CLOUD_PIPELINE` env + `organizations.ai_cloud_ack_at`).
- `docs/planning/database-design.md` — the `ai_pipeline_log` schema, the four `test_results.ai_category*` columns, the heartbeat / status enum.
- `docs/planning/architecture.md §Environment variables` — `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_CLOUD_PIPELINE` (consent gate).
- `docs/planning/testing-strategy.md §Example — ingest route` — canonical Layer 2 integration-test fixture shape; mirror it for the categorizer.
- `docs/planning/tasks.md §AI-002` — canonical acceptance source.

## Files in scope

- `src/entities/AiPipelineLog.ts` (new) — entity for `ai_pipeline_log` table per `database-design.md`. `p.*` portable types only. Composite index on `(stage, status, heartbeat_at)` for the boot-time recovery query.
- `src/entities/TestResult.ts` (modify) — add four `ai_category*` columns. Existing tests should still pass (additive change).
- `src/entities/index.ts` (modify) — add barrel export for `AiPipelineLog`.
- `src/mikro-orm.config.pg.ts` and `.sqlite.ts` (modify) — register the new entity.
- `src/services/ai/pipeline/categorizer.ts` (new) — the A1 stage handler. Implements reserve-execute-commit + heartbeat. Uses `MockAiProvider`-injectable `aiProvider`.
- `src/services/ai/pipeline/recovery.ts` (new, optional) — boot-time recovery query. Could live inside `categorizer.ts` if simple enough.
- `src/services/ai/pipeline/index.ts` (new) — barrel export.
- `src/services/ai/pipeline/consent.ts` (new) — consent-gate helper: `isAiCloudPipelineConsented(orm, orgId): Promise<boolean>`.
- `src/services/event-bus.ts` (modify, only if needed) — add `RUN_AI_CATEGORIZED` constant if AI-001 didn't already (verify first).
- `src/app.ts` (modify, additive) — wire categorizer subscription on boot when `aiProvider` is set; run boot-time recovery before serving traffic.
- `src/__tests__/integration/ai-categorization.test.ts` (new) — full pipeline integration tests.
- `src/__tests__/integration/schema-sqlite.test.ts` (modify) — extend the table-count assertion to include `ai_pipeline_log` (8 tables now: 6 CTRFHub + IngestIdempotencyKey + AiPipelineLog).

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Real LLM API calls in any test file. Mandated by `skills/ai-pipeline-event-bus.md` + `skills/vitest-three-layer-testing.md`. Tests inject `MockAiProvider`. Period.
- New migration files. Post-INFRA-005, schema is built from entities at boot via schema-generator. Add the entity, the table appears.
- `fastify.orm.em` anywhere — use `request.em` per `skills/mikroorm-dual-dialect.md` and `skills/fastify-route-convention.md`.
- Raw event-name strings (`'run.ingested'`, `'run.ai_categorized'`) in publisher or subscriber code. Use `RunEvents.*` constants only — typo drift between publisher and subscriber kills the AI pipeline silently.
- DB mocks in integration tests. Use `:memory:` SQLite via `buildApp({ db: ':memory:' })`.
- Bypass of consent gate. The two-gate (`AI_CLOUD_PIPELINE` env + `ai_cloud_ack_at` org column) is the privacy contract; consenting users opt in, others see nothing — no error, no nagging.
- Synchronous batch processing without yielding. Between every batch of 20: `await new Promise(r => setImmediate(r))` (same pattern as CTRF-002's bulk insert).
- Skipping the heartbeat-while-running. Without it, the boot-time recovery can't distinguish a still-working worker from a dead one.
- Postgres-only SQL. The recovery query must work on both dialects. Use MikroORM's QueryBuilder (`em.createQueryBuilder()`) or portable raw SQL.
- Reading `process.env.AI_PROVIDER` directly inside the categorizer. The `AppOptions.aiProvider` DI seam (AI-001) is the canonical injection point — your code receives an `AiProvider` instance, doesn't construct one.

## Next action (Feature-implementer)

1. Open a fresh AntiGravity session. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief (`.argos/AI-002/brief.md`) as the second.
2. `git checkout story/AI-002 && git pull origin story/AI-002`.
3. Read `skills/ai-pipeline-event-bus.md` first (full surface area), then `ai-features.md §A1 / §Durability and restart recovery / §Privacy and consent`. The recovery section is the most critical — get the query right before writing the categorizer.
4. Implement in this order (each step independently testable):
   - **Entity changes** — `AiPipelineLog.ts` (new) + extend `TestResult.ts`. Run `tsc --noEmit`. Run `npm run test:int` against `schema-sqlite.test.ts` — schema-generator should pick up the new entity automatically. Update the table-count assertion.
   - **Consent gate** — `consent.ts` pure function. Unit-test it.
   - **Categorizer service** — `categorizer.ts`. Implement reserve-execute-commit + heartbeat. Unit-test the pure parts (input/output transformation, batch slicing). Integration-test the full DB round-trip with a `MockAiProvider`-seeded response.
   - **Boot-time recovery** — `recovery.ts` (or inline). Integration-test by seeding a stale-heartbeat row and asserting the post-boot state.
   - **Wire-up in `src/app.ts`** — additive subscription registration when `aiProvider` is injected. Recovery query runs before serving traffic.
   - **Full pipeline integration test** — `ai-categorization.test.ts`. Cover all critical-paths above.
5. After each phase: `tsc --noEmit` (zero errors) and `npm run test` (full suite green).
6. Commit with `feat(AI-002): …`, `refactor(AI-002): …`, `test(AI-002): …`. `chore(AI-002): …` reserved for Argos status flips.
7. Write the feature-handoff to `.argos/AI-002/feature-handoff.md`. Be specific about: any payload-shape interpretation you settled on (these become the contract AI-003 / AI-004 wire against), the exact heartbeat staleness threshold you used (60s in the brief but `ai-features.md` is canonical — confirm), how `MockAiProvider`-driven failures (`throw new Error('mock failure')`) flow through reserve-execute-commit (does the log row land in `terminal_failed` or `failed_recoverable`?), any spec ambiguity surfaced.
8. Hand back to André so he can open the Test-writer step.

## Notes from Argos

- **The pipeline is the headline durability story.** A1 is the first stage of A1 → A2 → A3 → A4. Get the reserve-execute-commit primitives right; AI-003 / AI-004 will lift them as a pattern. If a primitive feels generic enough to extract into `src/services/ai/pipeline/runner.ts`, do it — but don't over-abstract on the first stage.
- **AI-001's deferred follow-ups are AI-002's territory.** AI-001's feature-handoff flagged: prompt quality minimal, no JSON validation in real providers, no retry. Reserve-execute-commit IS the retry mechanism (failed parses become recoverable failures; recovery query re-runs them). JSON validation goes around the provider call (validate `result.data` shape; on parse failure, mark log row recoverable-failed; recovery query retries). Worth a Zod schema for the categorize-output structure — derive from `CategorizeFailuresOutput` type in `src/services/ai/types.ts`.
- **CTRF-002's Better Auth rate-limiter caveat** — the API-key plugin's internal 10-per-10s verification limit (CTRF-002 feature-handoff) is something to be aware of if your integration tests do many API-key-authenticated calls in succession. The categorizer itself doesn't do API-key calls (it's an internal subscriber, not an HTTP endpoint), so this is mostly informational unless your test fixture seeds CTRF runs via the ingest endpoint.
- **The brief itself is on the story branch** (per PR #17 convention).
- **Parallel-safety with CI-003:** zero file overlap. The two stories can ship in either order.

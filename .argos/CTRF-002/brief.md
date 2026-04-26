# Task Brief — CTRF-002: Ingest route and service

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: CTRF-001 ✅ (`CtrfReportSchema` in `src/modules/ingest/schemas.ts`), AUTH-001 ✅ (Better Auth + `x-api-token` plumbing), INFRA-004 ✅ (TestRun / TestResult / TestArtifact entities, dual-dialect migrations).
- [x] No P0 gap blocks this story. (G-P0-001/002 affect UI templates only; G-P0-003 affects settings; G-P0-004 closed; G-P1-005 about MAX_PAYLOAD_SIZE applies to CTRF-003 artifact-file-parts, not the JSON ingest body.)
- [x] Branch cut: `story/CTRF-002` from `main` @ aa227de (CI-002 merge commit).
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(CTRF-002): assign`, brief committed alongside per the PR #17 convention).
- [x] **Parallel story:** CI-001 is being implemented in another workspace at the same time. **Zero file overlap** — CI-001 lives in `.github/workflows/`, root `Dockerfile`, `.dockerignore`. The only theoretical overlap is `package.json` (lint scripts on the CI-001 side); coordinate via André if either of you needs to add a script.

## Story

**Description.** Build the ingest endpoint that turns a CTRF JSON payload into a persisted `TestRun` + `TestResult` rows and fires `run.ingested` on the EventBus. This is the headline pipe — every downstream feature (Dashboard, AI categorization, retention, search) depends on rows landing here.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §CTRF-002, broken into bullets for scannability)

- `POST /api/v1/projects/:slug/runs` with `x-api-token` header authentication.
- Both `application/json` (raw CTRF body) and `multipart/form-data` (CTRF JSON field; artifact file parts handled in CTRF-003) accepted.
- Zod validation using `CtrfReportSchema` from `src/modules/ingest/schemas.ts` (CTRF-001 — re-use, do not redefine).
- `201 { runId }` on success.
- `401` missing token; `403` cross-project token; `404` unknown project; `413` payload too large; `422` invalid CTRF; `429` rate-limited.
- Idempotency: `Idempotency-Key` header → on duplicate replay, returns `200` with header `X-Idempotent-Replay: true` (the original `runId` preserved). Backed by the `ingest_idempotency_keys` table per `database-design.md §4.23` (`project_id` + `idempotency_key` composite uniqueness; 24h TTL pruned by retention sweep).
- Bulk insert uses 500-row chunked pattern with `setImmediate` yield between chunks (event loop must not block — see `skills/ctrf-ingest-validation.md`).
- Publishes `run.ingested` to the EventBus (the AI pipeline's A1 stage subscribes to this — see `docs/planning/ai-features.md §86`).
- **NO separate `/api/artifact` endpoint.** Artifacts co-upload via `multipart/form-data` only and land in CTRF-003 — keep the route surface minimal here.
- Integration test suite covers every status code path above.

**Test tiers required.** Integration. Unit tests for any pure helpers (idempotency-key normalization, chunk slicer) belong in `src/__tests__/unit/`; the Layer 2 tests in `src/__tests__/integration/ingest.test.ts` are where the bulk of the verification lives. Use `buildApp({ testing: true, db: ':memory:', eventBus: new MemoryEventBus() })` per the canonical pattern in `testing-strategy.md §125`.

**Page verification tiers.** T1 Headless only — `fastify.inject()` against every status code branch (201, 401, 403, 404, 413, 422, 429) and the idempotency replay (verify `X-Idempotent-Replay: true` header on the second request). No T2/T2.5/T3 — this is an API-only route, no rendered HTML.

**Critical test paths.** (verbatim from `tasks.md`, broken out)

- JSON and `multipart/form-data` both accepted on the same route.
- 201 with `{ runId }` on success.
- 401 missing token; 422 invalid CTRF; 404 unknown project; 413 size limit; 429 rate limit; 403 cross-project token.
- Idempotency replay returns 200 with `X-Idempotent-Replay: true`.
- Bulk insert uses 500-row chunks with `setImmediate` yield (event loop not blocked).
- `run.ingested` event published to `MemoryEventBus`.
- **No `/api/artifact` endpoint exists** in the diff.

## Required reading

**Skills (full paths — read before any code).**

- `skills/ctrf-ingest-validation.md` — **primary skill.** Defines the 500-row chunked bulk-insert + `setImmediate` yield, idempotency-key handling, `run.ingested` event publication shape, and the explicit "no `/api/artifact` endpoint" rule. Read first.
- `skills/fastify-route-convention.md` — `request.em` always (never `fastify.orm.em`), Zod validation via `setValidatorCompiler`, response shapes, content-negotiation. Ingest is API-only so the HTMX partial-vs-full rules don't bite, but the `request.em` pattern matters.
- `skills/mikroorm-dual-dialect.md` — entity inserts must work on Postgres (production) AND SQLite (single-node). Use `p.*` portable types per INFRA-004's pattern. Test against both via `npm run test:int` (CI runs both dialects in matrix).
- `skills/vitest-three-layer-testing.md` — Layer 2 integration tests use a real DB (no mocks per CLAUDE.md forbidden patterns), `MemoryArtifactStorage`, `MemoryEventBus`. The `afterAll(() => app.close())` pattern is mandatory.
- `skills/page-verification-hierarchy.md` §T1 — only T1 (Headless via `fastify.inject()`/`curl`) applies. The skill's curl pattern for `/health` is your model for the `201 { runId }` happy path.

**Planning doc sections.**

- `docs/planning/product.md §Feature 1 — CTRF Report Ingestion` (line 87) — full acceptance source. Note the explicit `application/json` + `multipart/form-data` requirement and the artifact-co-upload rule (deferred to CTRF-003).
- `docs/planning/architecture.md §Sending test reports to CTRFHub from CI` (line 519) — the canonical curl example for the auth header (`x-api-token`) and the `runId` response shape.
- `docs/planning/architecture.md §Backend` (line 14, table row "Rate limiting") — DD-029 in DD-012's Layer 2 table is the canonical numerical rate-limit value for ingest. Use the library's default store backend per the same row.
- `docs/planning/database-design.md §4.23 ingest_idempotency_keys` (line 566) — composite uniqueness on `(project_id, idempotency_key)`, 24h TTL, pruning policy. DD-019 has the full idempotency policy.
- `docs/planning/database-design.md` TestRun / TestResult / TestArtifact rows — INFRA-004 already shipped these entities; reuse, don't redefine.
- `docs/planning/testing-strategy.md §Example — ingest route` (line 125) — **the integration test template you should mirror**. Note the `MemoryEventBus` injection pattern.
- `docs/planning/ai-features.md §86` — `run.ingested` is the trigger event for the AI A1 categorization stage. Don't rename this event; downstream subscribers depend on the literal string.
- `docs/planning/tasks.md §CTRF-002` (line 106) — canonical acceptance source.

**Org-wide context (optional deep-dive).** Each cited skill has a `source:` frontmatter line pointing at Performant Labs's org-wide standards under `docs/ai_guidance/`. The symlink resolves on workspaces with `~/Sites/ai_guidance` cloned (see `DEVELOPER_SETUP.md`). Skills inline the relevant rules — following the source is for broader context, not required to do the work.

## Files in scope

- `src/modules/ingest/routes.ts` (new) — Fastify plugin registering the `POST /api/v1/projects/:slug/runs` route, content-negotiation between JSON and multipart, status-code branches.
- `src/modules/ingest/service.ts` (new) — `IngestService` class (or pure functions) implementing `validateAndPersist(em, project, ctrf)`: Zod parse → token-scope check → idempotency lookup → 500-row chunked TestResult insert with `setImmediate` yield → emit `run.ingested`.
- `src/modules/ingest/idempotency.ts` (new, optional) — `IdempotencyKeyStore` interface + a real DB-backed implementation; keeps the service.ts orchestration readable.
- `src/services/event-bus.ts` (likely new — verify against current main) — `MemoryEventBus` for tests + the production interface. AI features will depend on this; design the publish/subscribe surface to match `ai-features.md §339`.
- `src/app.ts` — register the new ingest plugin via `app.register()`.
- `src/__tests__/integration/ingest.test.ts` (new) — full Layer 2 suite matching the template in `testing-strategy.md §125`.
- `src/__tests__/unit/ingest-helpers.test.ts` (if needed) — unit tests for any pure helpers.
- `src/__tests__/fixtures/ctrf.ts` (new or extend) — `validCtrfReport`, `ctrfWithAttachments` fixtures used by the integration tests.
- A new MikroORM migration adding `ingest_idempotency_keys` (both dialects) — only if INFRA-004 didn't already ship it. Run `git log --all -- 'src/migrations/**'` to confirm.

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- `fastify.orm.em` anywhere — must be `request.em` per `mikroorm-dual-dialect.md`.
- Inline Zod schemas in handlers. Use `CtrfReportSchema` from `src/modules/ingest/schemas.ts` (CTRF-001 — single source of truth per `zod-schema-first.md`).
- DB mocks in integration tests — must hit a real database (PG or SQLite). Per CLAUDE.md "DB mocked in an integration test → `skills/integration-testing.md`".
- Postgres-only SQL or column types in the migration. Use `p.*` portable types per INFRA-004's pattern.
- Adding a `/api/artifact` endpoint or any `app.post('/api/artifact', ...)` — explicit forbidden pattern per `skills/ctrf-ingest-validation.md` and `skills/artifact-security-and-serving.md`.
- Synchronous bulk insert without yielding to the event loop. Every 500 rows: `await new Promise(r => setImmediate(r))`. Skip this and the loop blocks under load.
- Skipping any of the status-code branches in the integration suite (must cover 201, 401, 403, 404, 413, 422, 429 plus the idempotency replay).
- Raw event-name strings literal-coded twice — define `'run.ingested'` once (e.g., a `RunEvents` constants object) and import it in both publisher and tests so a typo can't drift the AI pipeline silently.
- Long-lived `EntityManager` reused across requests. Use `request.em` per request (Fastify decorates it via the MikroORM plugin).

## Next action (Feature-implementer)

1. Open a fresh AntiGravity session. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief (`.argos/CTRF-002/brief.md`) as the second.
2. `git checkout story/CTRF-002 && git pull origin story/CTRF-002` (already cut and pushed by Argos with the brief committed).
3. Read the five skills and the planning sections above. The `testing-strategy.md §Example — ingest route` is the integration-test scaffold you should mirror almost verbatim.
4. Implement in this order (each step independently testable):
   - **Event bus shim** — `src/services/event-bus.ts` with `MemoryEventBus` (in-process `Map<topic, handler[]>`); production EventBus interface ready for a future adapter. The AI stories depend on this; get the surface right.
   - **Idempotency store** — `src/modules/ingest/idempotency.ts`. Migration for `ingest_idempotency_keys` if not already in INFRA-004's set.
   - **Ingest service** — `src/modules/ingest/service.ts`. Zod parse → idempotency check → token-scope check → 500-row chunked persist → `run.ingested` emit.
   - **Ingest route** — `src/modules/ingest/routes.ts`. Both content types; size limit via `MAX_CTRF_JSON_SIZE`; rate limit via `@fastify/rate-limit` with the DD-029 numbers.
   - **Integration tests** — copy `testing-strategy.md §Example — ingest route` and extend to all status branches.
5. After each phase: `npm run tsc -- --noEmit` (must be zero errors) and `npm run test:int` (or `npm run test`).
6. Commit with `feat(CTRF-002): …`, `fix(CTRF-002): …`, `refactor(CTRF-002): …`. `chore(CTRF-002): …` is reserved for Argos status flips.
7. Write the feature-handoff to `.argos/CTRF-002/feature-handoff.md`. Be specific about: any spec ambiguity you surfaced (notably the `run.ingested` vs `run.created` question — see Notes below), your bulk-insert chunk-size choice if you deviated from 500, any decision about the EventBus surface that future AI stories will depend on.
8. Hand back to André so he can open the Test-writer step (T1 verification + integration test review + spec-audit).

## Notes from Argos

- **Spec ambiguity to surface — `run.ingested` vs `run.created`.** The acceptance criteria, `product.md §Feature 1`, `ai-features.md §A1`, and `architecture.md §350` all use `run.ingested` (the AI pipeline trigger). But `testing-strategy.md §Example — ingest route` (line 159) uses `run.created` in its example assertion, and `database-design.md §SSE` (line 1076) uses `run.created` for the SSE UI notification stream. **Implement `run.ingested` per the acceptance criteria** — that's the one downstream subscribers reference by literal name. Flag in your feature-handoff: are these meant to be the same event under different names, or two distinct events (one for the AI pipeline trigger, one for SSE UI updates)? Argos will reconcile in `gaps.md` from your finding.
- **Idempotency key transport.** Per DD-019 / `database-design.md §4.23`, the key arrives as an HTTP header (`Idempotency-Key`), not a body field or query param. Validate as printable ASCII at the Fastify layer; reject with 422 if malformed.
- **Size limits.** `MAX_CTRF_JSON_SIZE` (defaulted in `.env.example`) caps the JSON body. The 100 MB video / 200 MB zip limits in `product.md §Feature 4` apply to **artifact file parts** in CTRF-003 — they do not relax CTRF-002's JSON cap. (G-P1-005 in `gaps.md` documents this split — read it if 413 behavior is unclear.)
- **CTRF `status: 'other'` already validated by CTRF-001.** Don't re-validate at the service layer — `CtrfReportSchema.parse()` either accepts the report or throws, and your route returns 422 from the catch.
- **Don't ship CTRF-003.** Multipart parsing must accept the multipart envelope (so the JSON field is read out), but the artifact file parts are out of scope here — they get implemented in CTRF-003. Reject (or store-and-discard) any attached file parts in this story; document the choice in feature-handoff.
- **The brief itself is on the story branch** (per PR #17 convention), so paste-and-relay isn't needed across implementer sessions.

# CTRFHub — MVP Task Backlog

Dependency-ordered. Tasks with `depends_on: []` can start immediately. All others require their listed dependencies to be `[x]` before the story is assigned.

Status key:
- `[ ]` — not started
- `[/]` — in progress
- `[x]` — complete

---

## Tier 0 — Foundational Infra

### INFRA-001 — Project scaffold and toolchain
**Depends on:** none
**Skills required:** `mikroorm-dual-dialect.md`, `zod-schema-first.md`
**Test tiers required:** unit (vitest config proves out)
**Page verification tiers:** none (no routes yet)
**Critical test paths:** coverage thresholds 80/80/75 enforced by vitest config; dual MikroORM configs (`mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts`) both load without error; `tsc --noEmit` passes
**Acceptance:** `npm install` succeeds; `tsc --noEmit` passes on empty src/; ESLint config in place; `package.json` has all required scripts (`dev`, `build`, `test`, `test:unit`, `test:int`, `test:e2e`, `test:coverage`, `migrate:pg`, `migrate:sqlite`, `migrate:create:pg`, `migrate:create:sqlite`, `css:dev`, `css:build`); `vitest.config.ts` with coverage thresholds (80/80/75); `e2e/playwright.config.ts` with two-viewport matrix (1280×800, 375×800); dual MikroORM config files (`mikro-orm.config.ts`, `mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts`); `src/client/htmx-events.ts` constants file bootstrapped.
- [x] INFRA-001

---

### INFRA-002 — Base Fastify app factory
**Depends on:** INFRA-001
**Skills required:** `fastify-route-convention.md`, `zod-schema-first.md`, `better-auth-session-and-api-tokens.md`, `page-verification-hierarchy.md`
**Test tiers required:** unit (buildApp options type guard), integration (`/health`, CSP headers, shutdown hooks)
**Page verification tiers:** T1 Headless (`/health` 503 during `booting`/`migrating`, 200 when ready; helmet CSP headers present)
**Critical test paths:** `/health` returns `{ bootState: 'migrating', ... }` with 503; `/health` returns 200 when ready; global auth preHandler registered; `@fastify/view` Eta engine bound; SIGTERM triggers graceful close of DB + event bus
**Acceptance:** `buildApp()` factory exists in `src/app.ts` with `AppOptions` interface (`testing`, `db`, `artifactStorage`, `eventBus`, `aiProvider`); `ZodTypeProvider` registered; global auth `preHandler` hook wired; `@fastify/helmet` registered with CSP from `architecture.md §CSP`; `@fastify/rate-limit` registered; `@fastify/static` registered for `src/assets/`; `@fastify/view` registered with Eta; `GET /health` returns correct `bootState` shape and 503 during migrations; graceful SIGTERM shutdown sequence implemented.
- [x] INFRA-002

---

### INFRA-003 — Base Tailwind CSS entry and layout template
**Depends on:** INFRA-001
**Skills required:** `tailwind-4-flowbite-dark-only.md`, `eta-htmx-partial-rendering.md`, `viewport-mobile-first-desktop-only.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration (`reply.page()` partial-vs-full-page branching)
**Page verification tiers:** T1 Headless (`<meta viewport content="width=1280">` emitted, script load order in head), T2 ARIA (main landmark, nav landmark), T3 Visual (narrow-smoke at 375×800 — no horizontal scroll; 1280×800 baseline layout)
**Critical test paths:** HTMX request returns partial (no `<html>`); direct nav returns full layout; no-horizontal-scroll assertion at narrow viewport; backdrop-contrast WCAG re-check gate wired for any future token change
**Acceptance:** `src/assets/input.css` has correct `@import tailwindcss`, `@import flowbite`, `@source` directives, `@theme` block with all design tokens, `@layer components` with `.badge-pass/fail/skip/flaky`, `.run-card`, `.stat-tile`; `layouts/main.eta` has correct script load order (Tailwind → HTMX → idiomorph → Alpine → Flowbite → app.js), `<meta viewport content="width=1280">`, `hx-ext="morph"` on `<body>`; `reply.page()` decorator implemented (partial vs full-page branching on `HX-Request`); `npm run css:dev` watches without error; narrow-smoke test passes at 375×800.
- [ ] INFRA-003

---

### INFRA-004 — Core database entities and first migration
**Depends on:** INFRA-001
**Skills required:** `mikroorm-dual-dialect.md`
**Test tiers required:** unit (entity helpers), integration (schema-generator on both dialects)
**Page verification tiers:** none (no routes)
**Critical test paths:** `npm run schema:update:pg` against fresh Postgres; `npm run schema:update:sqlite` against fresh SQLite; entities use only portable `p.*` types (no dialect-specific SQL); `MemoryArtifactStorage` and `MemoryEventBus` contracts pass shared unit tests
**Acceptance:** Entities defined: `Organization`, `User` (Better Auth managed), `Project`, `TestRun`, `TestResult`, `TestArtifact`; all use portable `p.*` types only; schema-generator creates all CTRFHub-owned tables on fresh PG and SQLite databases; `npm run schema:update:pg` and `npm run schema:update:sqlite` succeed against fresh DBs; entity barrel export at `src/entities/index.ts`; `MemoryArtifactStorage` and `MemoryEventBus` test doubles created in `src/__tests__/doubles/`. *(Reworded by INFRA-005: migration files replaced with schema-generator at boot.)*
- [x] INFRA-004

---

### INFRA-005 — Replace migration runner with schema-generator at boot
**Depends on:** INFRA-004
**Skills required:** `mikroorm-dual-dialect.md`, `vitest-three-layer-testing.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration (schema-generator on both dialects)
**Page verification tiers:** none (no rendered routes)
**Critical test paths:** schema-generator emits CREATE TABLE statements for all 7 entities (Organization, User, Project, TestRun, TestResult, TestArtifact, IngestIdempotencyKey) in topological FK order on fresh PG and fresh SQLite; `updateSchema()` is idempotent on existing schema; `/health` returns 200 within 15s on fresh DB; previously-soft-failing e2e job (CI-001) passes hard
**Acceptance:** App boot uses `orm.schema.updateSchema()` instead of migrator; `src/migrations/` deleted; `skipTables: ['organization']` exclusion in mikro-orm config(s) removed; `Organization` entity created from definition by schema-generator; `package.json` `migrate:*` scripts replaced with `schema:*`; CI dialect-verification step uses schema-generator (not `migrate:pg`/`migrate:sqlite`); e2e job's `continue-on-error: true` removed (revives hard e2e gating); existing 210+ tests pass; `architecture.md §Production Deployment` / `§Image build` / `§Migrations in production` rewritten for schema-generator boot; `tasks.md §INFRA-004` acceptance reworded; `skills/mikroorm-dual-dialect.md` updated to describe schema-generator pattern.
- [x] INFRA-005

---

## Tier 1 — Authentication and Setup

### AUTH-001 — Better Auth integration and global auth hook
**Depends on:** INFRA-002, INFRA-004
**Skills required:** `better-auth-session-and-api-tokens.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration
**Page verification tiers:** T1 Headless (401 shapes, `HX-Redirect` response header, `/setup` redirect on empty DB)
**Critical test paths:** valid session cookie passes; valid `ctrf_*` Bearer API key passes; missing auth → 401; HTMX request missing auth → 200 with `HX-Redirect: /login`; raw API key never stored (only hash); empty-users redirect to `/setup`; `skipAuth: true` bypass honored for `/api/auth/*` and `/health`
**Acceptance:** `src/auth.ts` with `betterAuth({ apiKey plugin, defaultPrefix: 'ctrf_', storeRawKey: false })`; Better Auth schema generated (`npx better-auth generate`); `/api/auth/*` catch-all route registered with `skipAuth: true`; global `preHandler` checks (1) empty-users redirect to `/setup`, (2) `skipAuth` bypass, (3) Bearer API key, (4) session cookie, (5) HTMX 401 with `HX-Redirect`; integration tests cover: valid session, valid API key, missing auth → 401, HTMX missing auth → HX-Redirect header.
- [x] AUTH-001

---

### AUTH-002 — First-boot setup wizard (Feature 0)
**Depends on:** AUTH-001, INFRA-003
**Skills required:** `better-auth-session-and-api-tokens.md`, `eta-htmx-partial-rendering.md`, `zod-schema-first.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration, E2E
**Page verification tiers:** T1 Headless (`/setup` returns 410 once users non-empty; non-`/setup` routes redirect when DB empty), T2 ARIA (progress indicator `role="progressbar"` or step heading hierarchy, every input labeled, Next/Back as `button`), T3 Visual (dark surface, Flowbite form components, 1280×800)
**Critical test paths:** all four wizard steps functional; env-var seed path (`CTRFHUB_INITIAL_ADMIN_*`) produces same end state as web path; `/setup` returns 410 Gone after completion; crash-resumable (each step commits independently); backdrop-contrast check on any card/surface token edit
**Acceptance:** All four wizard steps functional (`/setup`); env-var seed path functional (`CTRFHUB_INITIAL_ADMIN_*`); `/setup` returns `410 Gone` once users table non-empty; non-`/setup` routes redirect to `/setup` on empty DB; crash-resumable (each step commits independently); integration tests for all wizard paths (web, env-seed, 410 after completion); T2 ARIA: progress indicator, step headings, form labels; T3 visual: dark surface, correct Flowbite form components.
- [ ] AUTH-002

---

### AUTH-003 — Login, logout, password reset (DD-021), email verification (DD-022)
**Depends on:** AUTH-001, INFRA-003
**Skills required:** `better-auth-session-and-api-tokens.md`, `eta-htmx-partial-rendering.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration, E2E
**Page verification tiers:** T1 Headless (rate-limit 429s, enumeration-safe responses, HX-Redirect on login success), T2 ARIA (form labels, submit button, error `role="alert"`), T3 Visual (login page dark aesthetic, 1280×800)
**Critical test paths:** rate limits 10/min per IP on `/forgot-password`, 3/hr per user; enumeration-safe response identical for existing vs. non-existing email; CLI `bootstrap-admin` and `reset-admin-password` succeed against fresh DB; email verification banner visible only when SMTP configured and user unverified
**Acceptance:** `/login` email+password form; password reset flow (SMTP-conditional); email verification banner (SMTP-conditional); all rate limits (10/min per IP on `/forgot-password`, 3/hr per user); enumeration-safe responses; CLI `bootstrap-admin` and `reset-admin-password` subcommands; integration tests for all error paths; T3 visual: login page matches dark aesthetic.
- [ ] AUTH-003

---

## Tier 2 — CTRF Ingestion

### CTRF-001 — Zod CTRF schema and unit tests
**Depends on:** INFRA-001
**Skills required:** `zod-schema-first.md`, `ctrf-ingest-validation.md`, `vitest-three-layer-testing.md`
**Test tiers required:** unit
**Page verification tiers:** none (schema only, no routes)
**Critical test paths:** valid CTRF report passes; missing required fields rejected with 422-shaped error; wrong types rejected; `status: 'other'` accepted (per gap G-P2-004); 100% branch coverage on `CtrfReportSchema`
**Acceptance:** `src/modules/ingest/schemas.ts` with `CtrfReportSchema` covering full CTRF spec including `status: 'other'`; unit tests: valid report passes, missing required fields rejected (422), wrong types rejected, `other` status accepted; `ctrf-validator.test.ts` written; 100% branch coverage on schema.
- [x] CTRF-001

---

### CTRF-002 — Ingest route and service
**Depends on:** CTRF-001, AUTH-001, INFRA-004
**Skills required:** `ctrf-ingest-validation.md`, `fastify-route-convention.md`, `mikroorm-dual-dialect.md`, `vitest-three-layer-testing.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration
**Page verification tiers:** T1 Headless (every status code: 201, 401, 404, 413, 422, 429; idempotency replay header)
**Critical test paths:** JSON and multipart/form-data both accepted; 201 with `{ runId }` on success; 401 missing token; 422 invalid CTRF; 404 unknown project; 413 size limit; 429 rate limit; 403 on cross-project token; idempotency replay returns 200 with `X-Idempotent-Replay: true`; bulk insert uses 500-row chunks with `setImmediate` yield (event loop not blocked); `run.ingested` event published to `MemoryEventBus`; **no `/api/artifact` endpoint exists**
**Acceptance:** `POST /api/v1/projects/:slug/runs` with `x-api-token`; JSON and multipart/form-data accepted; Zod validation; 201 with `{ runId }`; 401 missing token; 422 invalid CTRF; 404 unknown project; 429 rate limit; 413 size limit; token scoped to project (403 cross-project); idempotency key handling (200 + `X-Idempotent-Replay: true` on duplicate); bulk insert uses 500-row chunked pattern with `setImmediate` yield; `run.ingested` published to EventBus; NO separate `/api/artifact` endpoint; integration test suite covers all cases.
- [x] CTRF-002

---

### API-001 — Public REST read API
**Depends on:** CTRF-002, AUTH-001
**Skills required:** `fastify-route-convention.md`, `zod-schema-first.md`, `mikroorm-dual-dialect.md`, `vitest-three-layer-testing.md`
**Test tiers required:** integration
**Page verification tiers:** T1 Headless (all status codes; auth enforcement; pagination shape; org-scope guard — results never cross orgs)
**Critical test paths:** project-scoped `x-api-token` grants read access to its own project only (not other projects in the same org); session cookie grants full org access; `GET /api/v1/projects/:slug/runs` returns paginated list with filters applied at SQL level; `GET /api/v1/runs/:id` returns test results paginated (default 100 per page, max 1000); `GET /api/v1/projects/:slug/stats` returns pass-rate/duration/flaky-count for the requested window (7/30/90 days); unknown project slug → 404; unauthenticated → 401; token scoped to different project → 403; **all endpoints are session-cookie auth OR `x-api-token` — no new auth mechanism required**; `HATEOAS`-light: every list response carries `total`, `page`, `limit`, `data[]`
**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/projects` | List all projects for the authenticated org. Session auth only (no project-scoped token). Returns `[{ id, slug, name, description, createdAt }]`. |
| `GET` | `/api/v1/projects/:slug` | Get a single project's details + token count + run count. Same auth as above. |
| `GET` | `/api/v1/projects/:slug/runs` | Paginated, filterable run list. Query params: `status` (passed\|failed\|mixed), `branch`, `environment`, `from` (ISO date), `to` (ISO date), `page` (default 1), `limit` (default 20, max 100). Returns `{ total, page, limit, data: [RunSummary] }`. `RunSummary` = `{ id, runId, status, passRate, passed, failed, skipped, flaky, duration, startedAt, branch, environment }`. |
| `GET` | `/api/v1/runs/:id` | Full run detail. Includes `testResults` array (paginated: `testsPage`, `testsLimit`, default 100 per page, max 1000). Each result: `{ id, name, status, duration, message, trace, aiCategory, aiCategoryOverride, suiteTitle }`. AI fields null when AI not configured. |
| `GET` | `/api/v1/projects/:slug/stats` | Aggregated stats for a time window. Query param: `window` (7d\|30d\|90d, default 7d). Returns `{ totalRuns, passRate, avgDuration, failedCount, flakyCount, trend: [{ date, passRate, failedCount }] }`. Trend is one data point per day in the window. |

**Auth model for project-scoped tokens:** an `x-api-token` that has `projectId=X` in `apikey.metadata` may call any endpoint whose path resolves to that same project; attempts to access a different project return 403. Session cookies get full org access.
**Acceptance:** All five endpoints implemented in `src/modules/api/routes.ts` with service layer in `src/modules/api/service.ts`; Zod response schemas for all five shapes; org-scope guard — a project in org A is never visible to a token/session in org B; project-scoped token access respected (403 on cross-project); pagination with `total`/`page`/`limit` envelope; integration tests covering: valid session returns data, project-scoped token returns 403 on wrong project, unauthenticated returns 401, unknown slug returns 404, filter combinations produce correctly filtered SQL queries (not post-filtered); both Postgres and SQLite dialects covered.
- [ ] API-001

---

### CTRF-003 — Artifact co-upload with ingest
**Depends on:** CTRF-002
**Skills required:** `ctrf-ingest-validation.md`, `artifact-security-and-serving.md`, `vitest-three-layer-testing.md`
**Test tiers required:** integration (with `MemoryArtifactStorage`)
**Page verification tiers:** none (ingest endpoint, no page)
**Critical test paths:** magic-bytes validation on every upload (rejects mismatched extension/content); per-file size limits enforced (images 10 MB, video 100 MB, zip 200 MB, logs 5 MB); per-run total enforced via `MAX_ARTIFACT_SIZE_PER_RUN`; external URL attachments stored by reference only (no file body accepted); `TestArtifact` entity row created per stored file; `ArtifactStorage` interface boundary respected (no direct filesystem calls in route)
**Acceptance:** Multipart ingest accepts artifact file parts; magic-bytes validation on all uploads; per-file size limits enforced (images 10 MB, video 100 MB, zip 200 MB, logs 5 MB); per-run total enforced (`MAX_ARTIFACT_SIZE_PER_RUN`); external URL attachments stored by reference only (no file upload); `ArtifactStorage` interface used (local FS default, S3 optional); `TestArtifact` entity written; integration tests use `MemoryArtifactStorage`.
- [ ] CTRF-003

---

### CTRF-004 — CI reporter packages and GitHub Actions example
**Depends on:** CTRF-002
**Skills required:** none specific
**Test tiers required:** integration (fixture run ingested via each reporter format produces identical records)
**Page verification tiers:** none
**Critical test paths:** `@ctrfhub/playwright-reporter` and `@ctrfhub/cypress-reporter` both produce identical stored `TestRun` + `TestResult` records against the same fixture run; `examples/github-actions/` YAML has working ingest URL + token placeholders; all three ingest paths (Playwright reporter, Cypress reporter, raw CTRF POST) tested against CTRF-002 route
**Acceptance:** `@ctrfhub/playwright-reporter` npm package scaffolded under `packages/`; `@ctrfhub/cypress-reporter` scaffolded; `examples/github-actions/` YAML example pre-filled with ingest URL and token placeholder; all three produce identical stored run records (verified by integration test with fixture runs).
- [ ] CTRF-004

---

## Tier 3 — Dashboard and Run History

### DASH-001 — Dashboard screen (Feature 2)
**Depends on:** CTRF-002, AUTH-002, INFRA-003
**Skills required:** `eta-htmx-partial-rendering.md`, `htmx-alpine-boundary.md`, `htmx-4-forward-compat.md`, `tailwind-4-flowbite-dark-only.md`, `viewport-mobile-first-desktop-only.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration, E2E
**Page verification tiers:** T1 Headless (200 + HTML; partial-vs-full branching on `HX-Request`; cold-load budget), T2 ARIA (`h1` "Dashboard"; stat tiles labeled; Chart.js canvases have accessible names; empty state `role="status"`), T3 Visual (dark surface, stat tile layout, chart area — 1280×800)
**Critical test paths:** < 1 s cold load for 10 000 runs; Chart.js data rendered inline (no extra API calls); "Waiting for your first test report" empty state shown when no runs; HTMX filter change produces partial (no full-page reload); backdrop-contrast WCAG pass on stat-tile backdrop
**Acceptance:** `GET /` dashboard showing: total runs, pass rate, avg duration, flaky count (last 7 days); Chart.js trend charts (pass rate, failures, duration) rendered via inline data (no extra API calls); "Waiting for your first test report" empty state; HTMX partial swap on filter change; < 1 s cold load for 10,000 runs; T2 ARIA: `h1`, stat tiles accessible; T3 visual: dark surface, stat tiles, chart area.
- [ ] DASH-001

---

### DASH-002 — Run list with filtering and pagination (Feature 2)
**Depends on:** DASH-001
**Skills required:** `eta-htmx-partial-rendering.md`, `htmx-alpine-boundary.md`, `htmx-4-forward-compat.md`, `tailwind-4-flowbite-dark-only.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration, E2E
**Page verification tiers:** T1 Headless (filter parameters produce correctly filtered result set; HTMX partial returns no `<html>`), T2 ARIA (filter controls labeled; pagination buttons named; run list items are `link`s), T3 Visual (run cards, status badges, pagination component — 1280×800)
**Critical test paths:** project / date range / status / environment filter combinations; HTMX partial swap on every filter change (no full reload); pagination default 20, max 100; Flowbite Table component used; `hx-target`/`hx-swap` on the requesting element (never inherited)
**Acceptance:** `GET /runs` filterable by project, date range, status, environment; HTMX partial swap on filter change (no full page reload); paginated (default 20, max 100); Flowbite Table component; integration tests for filter combinations; T3 visual: run cards, status badges, pagination.
- [ ] DASH-002

---

### DASH-003 — Run detail view: suite → test → steps (Feature 2)
**Depends on:** DASH-002
**Skills required:** `eta-htmx-partial-rendering.md`, `htmx-alpine-boundary.md`, `tailwind-4-flowbite-dark-only.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration, E2E
**Page verification tiers:** T1 Headless (route 200; `body` text does not contain `{"results":`), T2 ARIA (suite `button` with `aria-expanded` accordion; Flowbite Modal `role="dialog"` when opened; each test row a `link`/`button` with test name), T3 Visual (failure detail panel; AI category badge pending state — 1280×800)
**Critical test paths:** suite → test → step hierarchy renders; error message + stack trace visible; raw JSON never leaks to page text (E2E assert `page.textContent('body')` does NOT contain `{"results":`); Flowbite Modal accessible open/close; Alpine island for modal state does NOT contain an HTMX swap target
**Acceptance:** `GET /runs/:id` — suite accordion → test rows → expandable failure detail; error message and stack trace displayed; no raw JSON visible on page (E2E test asserts `page.textContent('body')` does not contain `{"results":`); Flowbite Modal for test detail; T2 ARIA: accordion expand/collapse; T3 visual: failure detail, AI category badge (pending state when AI not configured).
- [ ] DASH-003

---

## Tier 4 — AI Pipeline

### AI-001 — AiProvider interface and MockAiProvider
**Depends on:** INFRA-001
**Skills required:** `ai-pipeline-event-bus.md`, `vitest-three-layer-testing.md`
**Test tiers required:** unit
**Page verification tiers:** none (no routes)
**Critical test paths:** `AiProvider` interface has `categorizeFailures`, `correlateRootCauses`, `generateRunSummary`; `MockAiProvider.calls[]` records invocations for assertions; `OpenAiProvider` / `AnthropicProvider` / `GroqProvider` selected by `AI_PROVIDER` env; unit tests for `getEffectiveCategory`, `getCategorySource`, `splitIntoBatches`
**Acceptance:** `AiProvider` interface with `categorizeFailures`, `correlateRootCauses`, `generateRunSummary`; `MockAiProvider` test double in `src/__tests__/doubles/`; `OpenAiProvider`, `AnthropicProvider`, `GroqProvider` real implementations behind `AI_PROVIDER` env; unit tests for `getEffectiveCategory` and `getCategorySource` display helpers; unit tests for `splitIntoBatches`.
- [x] AI-001

---

### AI-002 — AI pipeline: A1 categorization (Feature 3)
**Depends on:** AI-001, CTRF-002
**Skills required:** `ai-pipeline-event-bus.md`, `vitest-three-layer-testing.md`
**Test tiers required:** integration (with `MockAiProvider`)
**Page verification tiers:** none (pipeline only)
**Critical test paths:** `ai_pipeline_log` table created on both dialects via schema-generator (per INFRA-005); A1 subscribes to `run.ingested`; reserve → execute → commit pattern observable in log rows; heartbeat every 15 s; boot-time recovery query finds `stage='running'` rows and resumes/terminal-fails them; consent gate denies when `AI_CLOUD_PIPELINE` unset or `organizations.ai_cloud_ack_at` null; batch size 20, cap 500 failed results; publishes `run.ai_categorized` on completion; **no real LLM calls** — tests use `MockAiProvider` exclusively
**Acceptance:** `ai_pipeline_log` table created on both dialects via schema-generator (per INFRA-005); A1 stage subscribes to `run.ingested`; reserve-execute-commit pattern implemented; heartbeat every 15 s; boot-time recovery query; privacy/consent gate (`AI_CLOUD_PIPELINE`, `organizations.ai_cloud_ack_at`); batch size 20, cap 500 failed results; `ai_category`, `ai_category_override`, `ai_category_model`, `ai_category_at` columns on `test_results`; publishes `run.ai_categorized` on completion; integration tests use `MockAiProvider`; no real API calls in tests.
- [ ] AI-002

---

### AI-003 — AI pipeline: A2 root-cause correlation + A3 run narrative (Feature 3)
**Depends on:** AI-002
**Skills required:** `ai-pipeline-event-bus.md`, `vitest-three-layer-testing.md`
**Test tiers required:** integration (with `MockAiProvider`)
**Page verification tiers:** none
**Critical test paths:** pipeline chain order enforced — `categorize → correlate → summarize` (assert `ai_pipeline_log` row order); A2 subscribes to `run.ai_categorized`; A3 subscribes to `run.ai_correlated`; `ai_root_causes JSONB` / `ai_summary TEXT` columns populated; downstream stages run with `partial: true` if upstream stage terminally failed; stuck-stage sweeper at 60 s interval terminal-fails rows with `attempt ≥ 3`; no real LLM calls
**Acceptance:** A2 subscribes to `run.ai_categorized`; A3 subscribes to `run.ai_correlated`; `ai_root_causes JSONB` and `ai_summary TEXT` columns on `test_runs`; pipeline chain order verified by integration test (`categorize → correlate → summarize` index assertions); stages run with `partial: true` if upstream stage failed; `MockAiProvider.correlateRootCauses` and `generateRunSummary` called; stuck-stage sweeper (60-second interval, terminal-fail at `attempt ≥ 3`).
- [ ] AI-003

---

### AI-004 — AI results display in Run Detail UI
**Depends on:** AI-003, DASH-003
**Skills required:** `eta-htmx-partial-rendering.md`, `tailwind-4-flowbite-dark-only.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration, E2E
**Page verification tiers:** T1 Headless (AI cards absent when `AI_PROVIDER` unset; manual-override POST returns partial), T2 ARIA (AI summary card collapsible `button` with `aria-expanded`; category chips have accessible names; Pending vs AI vs Manual chips distinguishable), T3 Visual (AI summary card; category badge states — AI badge, Manual badge, Pending chip — 1280×800)
**Critical test paths:** manual category override preserves original `ai_category` (only `ai_category_override` changes); HTMX partial swap on override; no AI columns/cards render when AI provider is not configured; SSE update arrives and triggers dashboard refresh after pipeline completes; backdrop-contrast WCAG pass on summary-card surface
**Acceptance:** Run Detail shows AI summary card at top (collapsible); root-cause cluster cards above test table; per-test category chip (AI badge vs Manual badge vs Pending chip); manual category override saves via HTMX partial swap; original AI prediction preserved in `ai_category`; no AI columns/cards shown when `AI_PROVIDER` not configured; SSE update triggers dashboard refresh after AI analysis completes; T3 visual: AI summary card, category badge states.
- [ ] AI-004

---

## Tier 5 — Artifact Management

### ART-001 — Artifact serving: GET /api/files/*
**Depends on:** CTRF-003
**Skills required:** `artifact-security-and-serving.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration
**Page verification tiers:** T1 Headless (every security header asserted: `X-Content-Type-Options`, `Cross-Origin-Resource-Policy`, `Referrer-Policy`, `Cache-Control`, `Content-Disposition`; 302 redirect shape for S3)
**Critical test paths:** `X-Content-Type-Options: nosniff` always; `Cross-Origin-Resource-Policy: same-site` always; `Referrer-Policy: no-referrer` always; `Content-Disposition: inline` for safe types, `attachment` for HTML/SVG/PDF/ZIP; S3 pre-signed URL redirect with 1-hour expiry; 300 req/min rate limit per session; exhaustive T1 header asserts for every content-type branch
**Acceptance:** `GET /api/files/*` serves locally stored artifacts with all isolation headers (`X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-site`, `Referrer-Policy: no-referrer`, correct `Cache-Control`); `Content-Disposition: inline` for safe types, `attachment` for HTML/SVG/PDF/ZIP; S3 pre-signed URL redirect (1-hour expiry); rate limit 300 req/min per session user; integration tests for all content-type cases; T1 curl verification of headers.
- [ ] ART-001

---

### ART-002 — Artifact display in Run Detail UI
**Depends on:** ART-001, DASH-003
**Skills required:** `artifact-security-and-serving.md`, `eta-htmx-partial-rendering.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration, E2E
**Page verification tiers:** T1 Headless (iframe `sandbox` attribute emitted, NO `allow-same-origin`; artifact URLs in HTML resolve to 200 + correct content-type), T2 ARIA (artifact list items accessible with type icons named; `<video>` controls reachable), T3 Visual (artifact list, inline screenshot, video player — 1280×800)
**Critical test paths:** HTML report iframe has `sandbox="allow-scripts allow-forms allow-popups"` — **never** `allow-same-origin`; screenshots render as `<img>`; videos as `<video>`; Playwright trace links open `trace.playwright.dev`; external URL embeds (Loom, YouTube) in allowed-origin iframe; T1 GET on each rendered artifact URL returns 200 + expected content-type (per 2026-04-21 "srcset resolves" incident)
**Acceptance:** Test detail view lists associated artifacts with type icons; screenshots render inline (`<img>`); videos render with `<video>` player; Playwright trace links open `trace.playwright.dev`; HTML reports render in iframe `sandbox="allow-scripts allow-forms allow-popups"` WITHOUT `allow-same-origin`; external URL embeds (Loom, YouTube) in allowed-origin iframe; T3 visual: artifact list, inline screenshot, video player.
- [ ] ART-002

---

## Tier 6 — Settings and Multi-Project

### SET-001 — Project settings: general + CI integration + tokens
**Depends on:** AUTH-002, CTRF-002
**Skills required:** `fastify-route-convention.md`, `zod-schema-first.md`, `better-auth-session-and-api-tokens.md`, `eta-htmx-partial-rendering.md`, `page-verification-hierarchy.md`
**Token model note (post-AUTH-001):** Better Auth's `apikey` table is the canonical token store. Per-token policy (rate limit, permissions) lives in `apikey.metadata` (JSON) — see `database-design.md §DD-012` (rate-limit `keyGenerator`) and `§DD-019` (`?on_duplicate=replace` permission) for the canonical schema. The `project_tokens` table referenced in this story's critical-test-paths and acceptance bullets below is **deprecated**; do NOT migrate it. Token list / create / revoke flow goes through Better Auth's admin API. (Acceptance bullets below will be reworded when this story is briefed; the substantive functionality is unchanged — only the underlying table changes.)
**Test tiers required:** integration, E2E
**Page verification tiers:** T2 ARIA (tablist + tabpanels; form labels; danger-zone confirmation modal `role="dialog"`), T3 Visual (token create page, blast-radius modal — 1280×800)
**Critical test paths:** token plaintext returned exactly once on create; last-4 shown thereafter; token hash stored (not plaintext); slug rename warning shown before commit; delete rate-limited to 5/hr; blast-radius modal requires slug confirmation before delete; delete cascade verified via integration test; `project_tokens` and `project_environments` tables created via schema-generator on both dialects (per INFRA-005)
**Acceptance:** `/projects/:id/settings` general tab (name, slug, prefix, description); CI integration tab with YAML snippets; token create/revoke (plaintext shown once, last-4 thereafter); `project_tokens` and `project_environments` tables created via schema-generator on both dialects (per INFRA-005); admin-only danger zone (archive/delete project with blast-radius modal + slug confirmation); rate limit 5/hr on delete; integration tests for token create/revoke, slug rename warning, delete cascade.
- [ ] SET-001

---

### SET-002 — Org settings: general + members + system status
**Depends on:** AUTH-002, INFRA-004
**Skills required:** `fastify-route-convention.md`, `eta-htmx-partial-rendering.md`, `tailwind-4-flowbite-dark-only.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration
**Page verification tiers:** T1 Headless (no env var names or credentials in response body — `curl | grep -E 'PASSWORD|SECRET|TOKEN'` returns empty), T2 ARIA (system status page landmarks; disk bar has accessible name + value), T3 Visual (system status page, disk bar at 70%/90% thresholds — 1280×800)
**Critical test paths:** `/org/settings/general` saves name/slug/logo/timezone; `/admin/users` lists admins + active sessions + password-reset link generation + email verification resend; `GET /org/settings/system` shows DB table sizes, artifact storage stats, disk bar (amber ≥70%, red ≥90%), retention policy; **no credentials or secret env var values exposed** on system page; backdrop-contrast gate on disk-bar color states
**Acceptance:** `/org/settings/general` (name, slug, logo, default timezone); `/admin/users` (list admins, active sessions, password reset link generation, email verification resend); `GET /org/settings/system` shows system info, DB table sizes, artifact storage stats, disk space bar (amber at 70%, red at 90%), retention policy; no credentials or secret env vars exposed on system page; T3 visual: system status page, disk bar.
- [ ] SET-002

---

### SET-003 — Personal settings: profile + security + notifications + personal API keys
**Depends on:** AUTH-001
**Skills required:** `fastify-route-convention.md`, `eta-htmx-partial-rendering.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration, E2E (`settings-autosave.spec.ts`)
**Page verification tiers:** T2 ARIA (form labels on every field; "✓ Saved" confirmation has `role="status"`; revoke-all button has `aria-label`), T3 Visual (autosave indicator visible state — 1280×800)
**Critical test paths:** autosave fires on blur (not every keystroke); "✓ Saved" confirmation renders after successful save; revoke-all-sessions kills all other sessions and retains current; personal API token shown plaintext once, last-4 thereafter; `user_profiles`, `user_notification_preferences`, `personal_api_tokens` tables created via schema-generator on both dialects (per INFRA-005); Slack DM notification column hidden until PL-009 ships
**Acceptance:** `/settings/profile` (display name, avatar, timezone); `/settings/security` (change password, active sessions, revoke all); `/settings/notifications` (event toggles — Slack DM column hidden until PL-009); `/settings/api-keys` personal token create/revoke; `user_profiles`, `user_notification_preferences`, `personal_api_tokens` tables created via schema-generator on both dialects (per INFRA-005); autosave on blur with "✓ Saved" confirmation (E2E test: `settings-autosave.spec.ts`).
- [ ] SET-003

---

### WHOOK-001 — Outbound webhook: generic signed HTTP POST (DD-018, MVP)
**Depends on:** SET-001, CTRF-002
**Skills required:** `fastify-route-convention.md`, `zod-schema-first.md`, `mikroorm-dual-dialect.md`, `vitest-three-layer-testing.md`
**Test tiers required:** integration
**Page verification tiers:** T1 Headless (webhook registration 201; delivery log endpoint returns last 5 entries; invalid URL returns 422; signature header present on outbound POST)
**Critical test paths:** `run.failed` event triggers delivery within 5 seconds of ingest completing; outbound POST body is signed with `X-CTRFHub-Signature: sha256=<hmac>` using the project's webhook secret; failed delivery (non-2xx or timeout) is logged with status + response body (truncated to 1 KB) in `webhook_deliveries`; retry not in MVP (failed deliveries are logged, not retried — retry is Phase 2); at most 10 webhooks per project (returns 422 if exceeded); `project_webhooks` and `webhook_deliveries` tables created via schema-generator on both dialects; delivery log API returns last 5 per webhook; inline delivery log visible on `/projects/:id/integrations`
**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/hx/projects/:slug/webhooks` | Register a webhook (URL + optional secret) |
| `DELETE` | `/hx/projects/:slug/webhooks/:id` | Remove a webhook |
| `GET` | `/hx/projects/:slug/webhooks/:id/deliveries` | Last 5 delivery log entries (HTMX partial) |

**Payload shape** (matches DD-018, `"version": "1"`):
```json
{
  "version": "1",
  "event": "run.failed",
  "projectSlug": "frontend-e2e",
  "runId": "FE-042",
  "status": "failed",
  "passRate": 0.87,
  "failedCount": 13,
  "startedAt": "2026-04-27T14:00:00.000Z",
  "url": "https://ctrfhub.example.com/runs/FE-042"
}
```
**Acceptance:** `project_webhooks` table (url, secret_hash, payload_version, created_at) and `webhook_deliveries` table (webhook_id, event, status_code, response_body_preview, delivered_at) created via schema-generator on both dialects; webhook registration UI on `/projects/:id/integrations` tab; `run.failed` event fires delivery after ingest; HMAC-SHA256 signature on every outbound request (`X-CTRFHub-Signature` header); delivery failures logged (non-retried in MVP); inline last-5 delivery log per webhook; max 10 webhooks per project; integration tests: valid delivery fires + is logged, failed delivery (mock HTTP 500) logged without retry, signature validates, over-limit returns 422.
- [ ] WHOOK-001

---

## Tier 7 — Data Management and SSE

### DATA-001 — Data retention nightly job (Feature 7)
**Depends on:** CTRF-002
**Skills required:** `mikroorm-dual-dialect.md`
**Test tiers required:** integration
**Page verification tiers:** none (cron job + export routes, no UI page)
**Critical test paths:** nightly cron honors `RETENTION_CRON_SCHEDULE` (default `0 2 * * *`); deletes runs older than `organizations.retention_days` with FK cascade; artifact file unlink failures logged but non-fatal; pruning job logs count of runs + artifacts deleted; manual run delete < 2 s for 10 000-test run; `GET /api/v1/runs/:id/export.json` and `.zip` return correct shape; both dialect cascades tested
**Acceptance:** Nightly cron (`RETENTION_CRON_SCHEDULE` env, default `0 2 * * *`); deletes runs older than `organizations.retention_days` with FK cascade; artifact files unlinked (failures logged, not fatal); pruning job logs count of runs and artifacts deleted; manual run delete from UI (confirmation dialog, < 2 s for 10,000-test run); CTRF JSON + ZIP export (`GET /api/v1/runs/:id/export.json` and `.zip`); integration tests for retention logic and export endpoints.
- [ ] DATA-001

---

### SSE-001 — Server-Sent Events for real-time dashboard updates
**Depends on:** CTRF-002, DASH-001
**Skills required:** `fastify-route-convention.md`, `htmx-4-forward-compat.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration (connection lifecycle), E2E (`sse-update.spec.ts`)
**Page verification tiers:** T1 Headless (connection returns `text/event-stream`; `event: shutdown` frame sent on close)
**Critical test paths:** endpoint path is **`/org/:orgId/events`** (canonical); per-user and per-org connection limits enforced; 30-second keepalive; graceful shutdown sends `event: shutdown` frame; HTMX SSE extension auto-reconnects on drop; dashboard updates silently when a new run ingests; HTMX event names come from `HtmxEvents` constants (no raw `htmx:xhr:*` strings)
**Acceptance:** SSE endpoint at `/org/:orgId/events` (canonical path from `architecture.md §SSE`); per-user and per-org connection limits; 30-second keepalive; graceful shutdown sends `event: shutdown` frame; HTMX SSE extension auto-reconnects; dashboard updates silently when a new run ingests (banner or silent swap per spec); `sse.test.ts` integration test for connection lifecycle; E2E test `sse-update.spec.ts`.
- [ ] SSE-001

---

## Tier 8 — Global Search

### SRCH-001 — Global search endpoint and UI (architecture.md §Global Search)
**Depends on:** DASH-001, CTRF-002
**Skills required:** `fastify-route-convention.md`, `zod-schema-first.md`, `mikroorm-dual-dialect.md`, `page-verification-hierarchy.md`
**Test tiers required:** integration (both dialect `SearchProvider` implementations), E2E
**Page verification tiers:** T1 Headless (API returns scoped results; cross-org results never returned), T2 ARIA (command palette `role="dialog"`; search input labeled; result list navigable with keyboard), T3 Visual (palette appearance — 1280×800)
**Critical test paths:** Postgres FTS (`tsvector` + GIN) and SQLite FTS5 behind `SearchProvider` interface; scopes runs / tests / comments tested independently; **org-scope guard: results never cross organizations** (assertion in integration test); `⌘K` / `Ctrl+K` opens palette via Alpine (no HTMX swap target inside the palette island); 200 ms debounce; recent searches persisted to `localStorage`
**Acceptance:** `GET /api/v1/search?q=&scope=&orgId=` with Postgres FTS (`tsvector` + GIN) and SQLite FTS5 behind `SearchProvider` interface; three scopes: runs, tests, comments; org-level scope guard (results never cross org boundaries); `⌘K` / `Ctrl+K` command palette (Alpine + Tailwind, no external library); debounced 200 ms; recent searches in `localStorage`; persistent search in top bar; integration tests for both dialect implementations.
- [ ] SRCH-001

---

## Tier 9 — CI and Observability

### CI-001 — GitHub Actions CI pipeline
**Depends on:** INFRA-001
**Skills required:** none specific
**Test tiers required:** none (meta — orchestrates other tiers)
**Page verification tiers:** none
**Critical test paths:** `unit` → `integration` → `e2e` jobs run sequentially; E2E job ingests its own CTRF report to staging CTRFHub (dog-food rule); Docker multi-stage build (`builder` → `runner`); `lint` job runs `tsc --noEmit` + ESLint; `release` job on tag pushes multi-arch image to `ghcr.io/ctrfhub/ctrfhub`
**Acceptance:** `.github/workflows/ci.yml` with: `unit` job → `integration` job (sequential) → `e2e` job (needs integration) → ingest E2E CTRF report to staging CTRFHub; Docker multi-stage build (`builder` → `runner`); `lint` job (`tsc --noEmit` + `eslint`); `release` job on tag (multi-arch Docker push to `ghcr.io/ctrfhub/ctrfhub`).
- [x] CI-001

---

### CI-002 — Docker Compose files (dev + prod + SQLite)
**Depends on:** INFRA-002
**Skills required:** none specific
**Test tiers required:** none (meta — configuration only)
**Page verification tiers:** none
**Critical test paths:** `compose.dev.yml` runs with `tsx watch` + Tailwind `--watch` + Postgres; `compose.yml` runs prod with `ghcr.io` image + Postgres volume + `stop_grace_period: 30s`; `compose.sqlite.yml` single-container with SQLite; `.env.example` covers every env var named in `architecture.md §Environment variables`; compose `healthcheck` hits `/health`
**Acceptance:** `compose.dev.yml` (app with `tsx watch`, Tailwind `--watch`, Postgres); `compose.yml` (prod, ghcr.io image, Postgres named volume, `stop_grace_period: 30s`); `compose.sqlite.yml` (single container, SQLite); `.env.example` with all env vars from `architecture.md §Environment variables`; `healthcheck` in compose uses `/health` endpoint.
- [x] CI-002

---

### CI-003 — Tugboat per-PR preview + dog-food CTRF ingestion
**Depends on:** AUTH-001 (need a deployable app with login), CI-001 (need the CI workflow), CI-002 (need the Docker Compose stack Tugboat builds from)
**Skills required:** `better-auth-session-and-api-tokens.md` (admin seed), `mikroorm-dual-dialect.md` (migrations on Tugboat boot)
**Test tiers required:** integration (CI itself produces a green preview build)
**Page verification tiers:** T1 Headless (`/health` returns 200 on the preview URL), T2.5 (smoke check on the preview from the developer's Chrome — login as the seeded admin, confirm dashboard loads)
**Critical test paths:** Each PR opens → Tugboat builds the preview from `compose.yml` → migrations run as a build step (PG dialect) → an initial admin user is seeded so the developer can log in → preview URL is posted into the PR description → the CI E2E job ingests its own CTRF report into the per-PR preview's CTRFHub instance, closing the dog-food loop on the change actually being reviewed.
**Acceptance:** `.tugboat/config.yml` at repo root defines services (Postgres + app), build steps (npm install → migrate:pg → seed admin), and the URL-post step; first PR opened after this story merges produces a working preview reachable at `pr-N.<tugboat-subdomain>.tugboatqa.com`; preview's CTRFHub has the seeded admin (credentials supplied via env var on Tugboat) and can be logged into; CI E2E job has been amended to use the preview URL for ingest, and the report is visible in the preview's run list; `.github/workflows/ci.yml` posts the preview URL into the PR description as part of the `pr-agent` workflow output (or via a new lightweight job).
**Optional API follow-ups (not required for the first cut):** Tugboat exposes a token-authenticated REST API at `https://api.tugboatqa.com/v3`. Once the baseline integration above is green, the CI E2E job can optionally poll the API to gate ingest on preview status `= ready` and probe the preview's `/health` before sending the CTRF report — both reduce flakes when Tugboat's build is slow. **Teardown is not in scope:** Tugboat auto-deletes stale previews per its own preview-lifecycle policy.
- [ ] CI-003

---

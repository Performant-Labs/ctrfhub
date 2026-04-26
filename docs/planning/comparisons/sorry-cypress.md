# Sorry Cypress — Feature Comparison vs CTRFHub

**Reviewed:** 2026-04-26
**Source:** `~/Projects/ReportingTools/sorry-cypress/` (commit at time of clone)
**CTRFHub baseline:** `docs/planning/product.md`, `architecture.md`, `ai-features.md`, `database-design.md`, `parking-lot.md`

---

## 1. What Was Reviewed

| Package | Path | Purpose |
|---|---|---|
| `director` | `packages/director/src/` | Core orchestration server — ingest API, spec distribution, hook dispatch, screenshot/video upload |
| `api` | `packages/api/src/` | GraphQL read API for the dashboard (Apollo Server, MongoDB datasources) |
| `dashboard` | `packages/dashboard/src/` | React SPA (Material UI) — run list, run detail, project settings, hook management |
| `common` | `packages/common/src/` | Shared TypeScript types — Run, Instance, Test, Hook, Project |
| `mongo` | `packages/mongo/src/` | Thin MongoDB connection + collection wrappers |
| `logger` | `packages/logger/src/` | Structured logging (pino-based) |
| `docker-compose.full.yml` | root | Full deployment: 4 containers (mongo, director, api, dashboard) |

---

## 2. Feature Presence Matrix

| Dimension | CTRFHub MVP | Sorry Cypress | Notes |
|---|---|---|---|
| **Ingest API protocol** | REST (JSON + multipart), CTRF-native | Cypress-native REST (proprietary protocol) | SC implements the Cypress Dashboard wire protocol — machines POST to `/runs` and `/instances/:id/results`. Not a generic format; tightly coupled to Cypress CLI. |
| **Format support** | CTRF (any framework via CTRF adapters) | Cypress only | SC is *only* a Cypress Dashboard replacement. No other framework support. CTRFHub's framework-agnostic CTRF approach is a clear differentiator. |
| **Ingest auth** | `x-api-token` header (Better Auth API key) | `ALLOWED_KEYS` env var → record-key allowlist | SC validates `recordKey` from the request body against a static env-var list (`allowedKeys.ts`). No per-project scoping, no user sessions, no token rotation. Extremely basic. |
| **Idempotency** | 24h TTL keyed on `reportId` | Run-level dedup via `ciBuildId` hash | SC generates `runId = hash(ciBuildId + projectId)`. If a run with the same hash exists, it joins the existing run rather than creating a new one. Idempotency is per-run, not per-report. |
| **Data model depth** | `project → run → result` (normalized, relational) | `project → run → spec/instance → test` (denormalized, MongoDB) | SC stores everything as embedded MongoDB documents. Run contains specs array, each spec has an instanceId. Instance results are a separate collection but denormalized stats are duplicated into the run. No formal relational integrity. |
| **Data model — test taxonomy** | `passed / failed / skipped / pending / other` (CTRF standard) | `passed / failed / skipped / pending` | SC uses Cypress's native 4-state model. Missing `other` — not relevant since they only support Cypress. |
| **Flaky detection** | Planned (pattern-based, AI-assisted) | Basic — `flaky` count tracked in `RunGroupProgressTests` | SC tracks a flaky counter at the run-group level (`tests.flaky`), populated from Cypress's built-in retry mechanism. No historical pattern detection, no cross-run analysis. |
| **AI / categorization** | A1–A4 pipeline (LLM-based per-test categorization, clustering, narratives) | **Absent** | Zero AI features confirmed. Grep for `openai|anthropic|llm|categoriz|classify|machine.learning` returned zero hits beyond false positives (e.g., `specState` enum strings). |
| **Data storage** | PostgreSQL + SQLite (dual-dialect, MikroORM) | MongoDB 4.4+ only | SC is MongoDB-only. No SQL option, no embedded database for small teams. |
| **Search** | Planned (PostgreSQL FTS) | Client-side filter only | Dashboard has a `SearchField` component that passes a `search` query param to GraphQL `Filters` (key/value match or `like`). This becomes a MongoDB `$match` or `$regex` — basic string matching, not full-text search. |
| **Real-time updates** | Planned (SSE) | In-process `EventEmitter` (pubsub.ts) | SC uses Node.js `EventEmitter` for hook dispatch (run start/finish, instance start/finish). No WebSocket/SSE push to the dashboard — the dashboard polls via GraphQL. |
| **Notifications** | Planned (webhook-based) | ✅ Rich — 6 integrations | **Slack** (with result filter + branch filter), **GitHub** (status API, token + GitHub App auth), **Bitbucket** (status API), **MS Teams**, **Google Chat**, **Generic Webhook** (custom headers). This is Sorry Cypress's strongest feature. Each hook is per-project, configurable per event type (`RUN_START`, `RUN_FINISH`, `RUN_TIMEOUT`, `INSTANCE_START`, `INSTANCE_FINISH`). |
| **Auth — dashboard** | Session-based (Better Auth) | **Absent** | SC dashboard has zero authentication. Anyone with network access can view/modify/delete everything. The `GRAPHQL_CLIENT_CREDENTIALS` env var is an empty string in the docker-compose. No login, no sessions, no RBAC. |
| **Auth — multi-tenancy** | Project-scoped, organization-based | Project-level isolation only | SC has `projectId` but no organization concept, no user roles, no access control between projects. |
| **Screenshot/video storage** | Local filesystem (MVP), S3 (planned) | S3, MinIO, GCS, Azure Blob, COS (Tencent Cloud) | SC has excellent cloud storage flexibility via a pluggable `ScreenshotsDriver` interface. 6 drivers: S3, MinIO, Google Cloud Storage, Azure Blob Storage, IBM COS, and a dummy (no-op) driver. CTRFHub currently stores attachments on local filesystem only — this is a gap worth noting. |
| **Parallelization / orchestration** | Not applicable (CTRF is post-execution) | ✅ Core feature — spec distribution across machines | SC's primary value proposition is *orchestrating* parallel Cypress runs by distributing specs across machines. The director assigns unclaimed specs to requesting machines. This is fundamentally different from CTRFHub's scope — CTRFHub receives completed results, it doesn't orchestrate execution. |
| **Retention / cleanup** | Planned (TTL-based, admin UI) | Manual deletion only | SC has `deleteRun`, `deleteRuns`, and `deleteRunsInDateRange` mutations. No automated retention policies, no scheduled cleanup, no TTL. Users must manually delete runs or call the API. |
| **Export** | Planned (CSV/JSON) | **Absent** | No export functionality found. |
| **Health / metrics** | Planned (health endpoint) | `isDBHealthy()` in driver interface | SC has a DB health check method on the execution driver, but no `/health` endpoint exposed, no Prometheus metrics, no operational monitoring. |
| **UI — project list** | ✅ | ✅ | SC shows all projects with color coding, run counts, latest status. |
| **UI — run list** | ✅ | ✅ | SC has a run feed with cursor-based pagination, filterable by project. Shows commit info, CI provider, status badges, duration, pass/fail counts. |
| **UI — run detail** | ✅ (with AI insights) | ✅ (basic) | SC shows spec list with status badges, individual test results with error messages, stack traces, screenshots, video playback. No AI categorization, no failure grouping. |
| **UI — test detail** | ✅ | ✅ | SC shows test title, state, `displayError` (rendered), code frame, attempts (retries), screenshot gallery, video player with timestamp linking. |
| **UI — trends / charts** | ✅ (run-over-run trends) | **Absent** | No historical charting. `specStats` query provides `avgWallClockDuration` and `count` but this isn't rendered in the dashboard. |
| **UI — CI build grouping** | Not planned | ✅ | SC has `CiBuild` aggregation — groups runs by `ciBuildId` on a dedicated view. |
| **UI — instance reset** | Not applicable | ✅ | SC allows resetting a claimed instance so it can be re-run (specific to the orchestration model). |
| **Run timeout / inactivity** | Not planned | ✅ | SC has per-project `inactivityTimeoutSeconds` with a dedicated `runTimeout` collection. If a run is inactive beyond the threshold, it's marked completed with timeout. |
| **Deployment complexity** | Single container (Node.js + SQLite) | 4 containers (MongoDB, Director, API, Dashboard) | CTRFHub's single-binary story is dramatically simpler. SC requires MongoDB as a hard dependency, plus 3 Node.js services. |
| **Technology stack** | Node.js, Fastify, HTMX, MikroORM | Node.js, Express, React (MUI), Apollo Server, MongoDB driver | Both are Node.js. SC uses a SPA architecture (React + Apollo Client → Apollo Server → MongoDB) vs CTRFHub's server-rendered HTMX approach. |
| **Status taxonomy depth** | `passed / failed / skipped / pending / other` (5 states) | `passed / failed / skipped / pending` (4 states) | SC mirrors Cypress's native 4-state model. No distinction between product defect and test infrastructure failure — a single `failed` covers both. |
| **Execution step hierarchy** | Flat (`message` + `trace` on result) | Flat — attempt → error only | SC records individual test attempts (`attempts[]`) with per-attempt `displayError` and code frame. No before/after stages, no nested steps, no per-step attachments. The deepest grouping is spec → test → attempt. |
| **Export to monitoring systems** | Not yet | **Absent** | No Prometheus, InfluxDB, or other metrics export. The `isDBHealthy()` driver method is internal only; no scrape endpoint. |
| **Issue tracker integration** | Not planned (MVP) | **Absent** | No Jira, GitHub Issues, or other BTS linking. Hooks can post to generic webhooks, but there is no structured ticket-linking workflow. |
| **Rule-based vs AI categorization** | LLM-based (A1 pipeline) | **Absent** | SC has no categorization at all — failures are displayed raw. No regex rules, no ML, no LLM. |
| **Complementary vs competitive** | Competitive (overlapping dashboard role) | Partially complementary | SC focuses on Cypress orchestration; CTRFHub focuses on multi-framework post-hoc analysis. A team running Cypress could use SC for parallelization *and* CTRFHub for cross-framework dashboarding — they are not mutually exclusive. The overlap is only if the team is Cypress-only and only needs a run dashboard. |
| **AI cold-start story** | Works day 0 (LLM) | N/A — no AI | SC has no AI. No cold-start concern. |
| **Privacy architecture** | Per-project consent gate (opt-in) | N/A — no AI | No log indexing, no ML pipeline, no data sent to external services. Privacy concerns are limited to the ingest API and MongoDB storage — both are self-hosted. |
| **Plugin / extensibility model** | In-process event bus | Driver interface only | SC's extensibility is limited to swapping `ExecutionDriver` (in-memory vs mongo) and `ScreenshotsDriver` (6 cloud backends). No plugin system, no event hooks for third parties beyond the notification hook system. |
| **Live run interruption / Quality Gates** | Not yet (post-hoc model) | **Partial** — `inactivityTimeoutSeconds` per project | SC can time out and complete a run that has gone inactive beyond a threshold (`runTimeout` collection). This is a timeout guard, not a quality-gate GO/NO-GO. No rule-based pass/fail threshold on results. |

---

## 3. Code-vs-Docs Reconciliation

| Claim (README/docs) | Source verification | Verdict |
|---|---|---|
| "run cypress tests in parallel with no limitations" | Confirmed — `getNextTask()` in `run.controller.ts` distributes unclaimed specs via atomic MongoDB operations | ✅ Accurate |
| "upload screenshots and videos to your own storage" | Confirmed — 6 storage drivers in `director/src/screenshots/` | ✅ Accurate |
| "integrate with GitHub, Slack or anything else via webhooks" | Confirmed — 6 hook reporters in `director/src/lib/hooks/reporters/` | ✅ Accurate |
| "browse test results, screenshots and video recordings" | Confirmed — dashboard has `testDetails.tsx`, `instanceDetails.tsx`, video `player.tsx` | ✅ Accurate |
| "self-hosted" | Confirmed — docker-compose with 4 containers, no SaaS dependency | ✅ Accurate |
| Implied: works with any test framework | **Not true** — ingest API is Cypress wire protocol only | ❌ README doesn't claim multi-framework, but it's worth noting |

---

## 4. Notable Design Choices Worth Comparing

### 4.1 Pluggable Driver Architecture

Sorry Cypress uses a clean `ExecutionDriver` + `ScreenshotsDriver` interface pattern (`driver.types.ts`). The execution driver can be swapped between `in-memory` (for development) and `mongo` (for production). The screenshots driver supports 6 cloud storage backends.

**Relevance to CTRFHub:** CTRFHub's `AiProvider` interface follows a similar pattern. The screenshot storage driver pattern is relevant if CTRFHub adds S3/cloud storage support for attachments — the interface-per-backend approach is proven.

### 4.2 Hook System Is the Standout Feature

Sorry Cypress's notification system is its most sophisticated feature. Each project can have multiple hooks of different types, each subscribing to specific events (`RUN_START`, `RUN_FINISH`, `RUN_TIMEOUT`, `INSTANCE_START`, `INSTANCE_FINISH`). The Slack hook supports result filtering (all/failed-only/successful-only) and branch filtering. GitHub and Bitbucket hooks set commit status checks.

**Relevance to CTRFHub:** CTRFHub's `parking-lot.md` lists webhooks as post-MVP. When implementing, Sorry Cypress's event model (5 events) and per-hook event subscription is a good reference. The Slack result/branch filtering is a nice UX touch. GitHub commit status integration is particularly valuable for CI workflows.

### 4.3 MongoDB — Embedding vs Normalizing

SC stores run specs as embedded arrays inside the run document. This means:
- A run with 500 specs = one large document with a 500-element array
- Spec claiming uses atomic `$set` on array elements
- Progress tracking is done by re-scanning the specs array

This works for Cypress (typical spec counts are 10–200) but would not scale for CTRFHub's target of 10,000+ results per run. CTRFHub's normalized relational model with separate `test_results` rows is the correct choice.

### 4.4 No Authentication Is a Liability

SC's complete lack of dashboard authentication is a significant limitation for team use. Any network-accessible deployment is fully open — anyone can delete projects, runs, and modify hook configurations. The `ALLOWED_KEYS` mechanism only protects the ingest API, not the dashboard or the GraphQL API.

**Relevance to CTRFHub:** CTRFHub's Better Auth integration with session + API key auth is a clear advantage. This is worth calling out in the synthesis.

### 4.5 CI Build Grouping

SC groups runs by `ciBuildId` — a concept that links multiple parallel runs (potentially from different machines) into a single CI build view. This is useful for CI-native workflows where a single pipeline spawns multiple Cypress containers.

**Relevance to CTRFHub:** CTRFHub's data model doesn't have an explicit CI build grouping concept. Since CTRF reports are post-execution, a single report already contains all results from a run. However, if a CI pipeline sends multiple CTRF reports (e.g., one per test suite), there's no built-in way to group them. This is worth flagging for `gaps.md`.

---

## 5. Proposed Findings for Routing

### For `gaps.md` (potential MVP additions)

| Finding | Priority | Rationale |
|---|---|---|
| **Cloud storage driver for attachments** | Phase 2 | SC supports 6 backends. CTRFHub's local-only filesystem storage limits deployment flexibility. An S3-compatible driver would cover most cloud deployments. |
| **CI build grouping** | Phase 2 | SC's `ciBuildId` concept allows grouping related runs. CTRFHub may need a way to link multiple reports from the same pipeline execution. |
| **GitHub commit status integration** | Phase 2 | SC's GitHub hook sets commit statuses. This is high-value for CI workflows — teams see pass/fail directly on PRs. |

### Explicitly out of scope for CTRFHub

| Feature | Why N/A |
|---|---|
| Test orchestration / spec distribution | CTRFHub receives completed reports, doesn't orchestrate execution |
| Instance reset / re-run | Same — not an orchestrator |
| MongoDB support | CTRFHub is PostgreSQL + SQLite by design |
| Cypress-specific wire protocol | CTRF is the chosen format; adapter conversion happens at the reporter level |
| Live run interruption / Quality Gates | SC's `inactivityTimeoutSeconds` is a timeout guard, not a quality gate; neither tool has rule-based GO/NO-GO gates |
| Plugin extensibility system | SC has no plugin system beyond driver swapping; not a gap to address from this tool |

### Already covered in `parking-lot.md`

| Finding | Reference |
|---|---|
| Webhook/notification system | `parking-lot.md` — webhooks listed as post-MVP |
| S3 storage | `parking-lot.md` — cloud storage noted |
| Retention policies | `parking-lot.md` — data lifecycle management |
| Export functionality | `parking-lot.md` — export listed |

---

## 6. Market Position — Where CTRFHub Fills the Gap

### 6.1 Why Sorry Cypress users might switch to CTRFHub

Sorry Cypress serves a narrow audience: **teams that run Cypress exclusively and need free parallelization**. The moment any of the following conditions apply, Sorry Cypress stops being adequate and CTRFHub becomes the natural next step:

1. **Multi-framework test suites.** Most mature teams run more than one test framework — Playwright for E2E, Vitest/Jest for unit tests, maybe a mobile suite. Sorry Cypress can only report on Cypress runs. CTRFHub ingests any framework that has a CTRF reporter, giving teams a single pane of glass across their entire test portfolio. This is the primary gap CTRFHub fills.

2. **Failure understanding at scale.** Sorry Cypress shows raw error messages and stack traces — nothing more. When a suite produces 200 failures in a run, a developer must manually read each one. CTRFHub's AI categorization pipeline (A1–A4) groups related failures, explains root causes in natural language, and surfaces patterns across runs. For teams drowning in test noise, this is a step change.

3. **Trend visibility.** Sorry Cypress has no historical analysis — each run is viewed in isolation. There's no way to answer "is this test getting flakier over time?" or "how has our pass rate changed this sprint?" CTRFHub's run-over-run trend charts and AI-assisted flaky detection address this directly.

4. **Security and team access control.** Sorry Cypress has zero dashboard authentication. Any network-accessible deployment is fully open — anyone can delete projects and runs. For teams with compliance requirements or multi-team organizations, this is a non-starter. CTRFHub's session-based auth with API key scoping provides the baseline security teams expect.

5. **Operational simplicity.** Sorry Cypress requires 4 containers and a MongoDB instance. CTRFHub's single-binary deployment with embedded SQLite means a team can go from zero to a working dashboard in under a minute, with no external database to manage.

6. **SQL-native data access.** Sorry Cypress stores data in MongoDB with denormalized documents. CTRFHub's normalized PostgreSQL/SQLite schema means teams can query their test data with standard SQL, build custom reports with any BI tool, and integrate with existing data infrastructure.

### 6.2 Why Sorry Cypress users might NOT switch

1. **Parallelization is the killer feature.** If a team's primary problem is "Cypress Dashboard is too expensive and we need free parallel test distribution," CTRFHub doesn't solve that problem. CTRFHub is a post-execution reporting tool — it doesn't orchestrate test runs. Teams that depend on Sorry Cypress's spec distribution across CI machines would need to keep it (or switch to a different parallelization solution) regardless.

2. **Cypress-native workflow.** Sorry Cypress is a drop-in replacement for Cypress Dashboard — zero config change beyond pointing `CYPRESS_API_URL` at the director. Switching to CTRFHub requires installing a CTRF reporter for Cypress and modifying CI scripts to POST reports. It's not hard, but it's not zero-config either.

3. **Notification maturity.** Sorry Cypress's hook system (Slack, GitHub, Bitbucket, Teams, GChat, generic webhook) is production-proven and richly configurable. CTRFHub's notification system is post-MVP. Teams that depend on Slack alerts with branch filtering or GitHub commit status checks would lose that capability during the transition.

4. **Video playback and screenshot gallery.** Sorry Cypress has polished video-player integration with test-timestamp linking and inline screenshot galleries. CTRFHub's attachment handling is still MVP-level (local filesystem storage, basic display). Teams that heavily rely on visual debugging artifacts may find CTRFHub's current offering less refined.

5. **No migration path.** Sorry Cypress data lives in MongoDB; CTRFHub uses PostgreSQL/SQLite. There's no import tool. Historical data would be left behind — teams can't bring their existing run history with them.

---

## 7. Summary Assessment

Sorry Cypress is a **narrowly focused** tool that does one thing well: replace the Cypress Dashboard for parallel test orchestration. Its notification system is excellent, and its pluggable storage driver architecture is well-designed.

However, it has significant limitations that validate CTRFHub's design choices:
- **Single-framework lock-in** (Cypress only) vs CTRFHub's CTRF-native approach
- **Zero AI/categorization** — failures are shown raw, no grouping or analysis
- **No authentication** — a non-starter for team environments
- **No trends or historical analysis** — each run is viewed in isolation
- **MongoDB-only** — no embedded database option for small deployments
- **4-container deployment** vs CTRFHub's single-binary target

The main feature CTRFHub should learn from is the **notification/hook system** — Sorry Cypress's per-project, per-event, multi-destination hook architecture is well thought out and should influence CTRFHub's eventual webhook implementation.

# CTRFHub Data Flow & Request Lifecycle

This document stitches the per-module specs and skills into end-to-end request-lifecycle narratives. It is descriptive, not normative — every rule it leans on is already declared in another spec doc or skill, and those documents remain authoritative. Where the existing spec is silent or ambiguous, this doc flags the gap rather than resolving it.

> **Read this with:** `architecture.md` (stack and conventions), `database-design.md` (entities), `product.md` (acceptance criteria for each feature), `ai-features.md` (pipeline stages), and the corresponding skills in `skills/`. The "Authoritative source" pointers below tell you where to go for definitive detail.

---

## 1. Purpose

`architecture.md` describes *what* the stack is. `database-design.md` describes *what* the data model is. The per-module skills (`fastify-route-convention.md`, `ctrf-ingest-validation.md`, `ai-pipeline-event-bus.md`, etc.) describe *how* a single layer behaves. None of those documents walk a request from arrival to response.

This doc fills that gap. It answers four questions that come up repeatedly:

1. Where does an incoming HTTP request go after Fastify accepts the socket, and what touches it on the way to the database?
2. How does the same template path serve both a full HTML page and an HTMX partial swap?
3. How does an ingest write reach a logged-in user's open browser tab without a polling loop?
4. How does the AI pipeline run asynchronously without blocking the ingest 201 response?

---

## 2. The MVC mapping

CTRFHub is not a classical Rails-style MVC app — it is a Fastify plugin tree with a service layer and a server-rendered view layer. The roles map onto MVC like this:

| MVC role | Implementation in CTRFHub | Authoritative source |
|---|---|---|
| **Model** | MikroORM v7 entities under `src/entities/` (one file per table). Persistence dialect (Postgres or SQLite) is selected at boot via `MIKRO_ORM_DRIVER`; entities are dialect-agnostic. | `database-design.md`; `skills/mikroorm-dual-dialect.md` |
| **View** | Eta templates under `src/views/` — `layouts/main.eta` (shell), `pages/<screen>.eta` (full-page bodies), `partials/<fragment>.eta` (HTMX swap targets). The `reply.page()` decorator chooses partial vs. full layout from the `HX-Request` header. | `skills/eta-htmx-partial-rendering.md` |
| **Controller** | Fastify route handlers under `src/modules/<feature>/routes.ts`. They own the request/response lifecycle (auth check via `preHandler`, schema validation via Zod, rate limit, response shape) and *only* that — they delegate business logic to a service. | `skills/fastify-route-convention.md` |
| **Service layer** (added below "Controller") | Plain TypeScript classes under `src/modules/<feature>/service.ts`. They receive a MikroORM `EntityManager` and typed DTOs derived from Zod schemas, and they own all DB access and business rules. They never see `request` or `reply`. | `skills/fastify-route-convention.md` § Service Layer |
| **Schemas** (cross-cutting) | Zod schemas under `src/modules/<feature>/schemas.ts` are the single source of truth for runtime validation *and* TypeScript types. Hand-written `interface`s that duplicate a Zod shape are a forbidden pattern. | `skills/zod-schema-first.md` |
| **Client interactivity** | HTMX 2.x for *all* server communication; Alpine.js 3 for ephemeral local UI state only; idiomorph for state-preserving DOM swaps. The boundary is enforced by lint-style rules (no `x-data` inside an HTMX swap target; no inherited `hx-target`/`hx-swap`). | `skills/htmx-alpine-boundary.md`; `skills/htmx-4-forward-compat.md` |
| **Async processing** | An `EventBus` abstraction (`src/lib/event-bus.ts`) decouples ingest from the AI pipeline and from SSE fan-out. In MVP it is in-memory; the same interface is implementable as Redis Pub/Sub for horizontal scale-out. | `database-design.md` § DD-011; `skills/ai-pipeline-event-bus.md` |

**The hard contracts that fall out of this:**

- Route handlers do not call `em.find` / `em.create` / `em.flush` directly. They call `service.method(request.em, dto)`. (`fastify-route-convention.md` § Bad example — DB access in handler.)
- Services do not call `reply.send` or `reply.page`. They return data. The handler renders.
- Templates do not contain business logic — only the data the handler passed in.
- Schemas are imported in both `routes.ts` and `service.ts`; the service's parameter type is `z.infer<typeof FooSchema>`.
- The EventBus is the only legal way for the ingest path to trigger AI work or SSE fan-out. Direct calls into AI services or the SSE registry from an ingest handler are forbidden.

---

## 3. Module layout

```
src/
├── app.ts                 — Fastify app factory: registers plugins, ZodTypeProvider,
│                            global preHandler (auth), error handler, view engine
├── server.ts              — api-container entrypoint; calls orm.schema.updateSchema()
│                            and starts the HTTP listener
├── worker.ts              — worker-container entrypoint; subscribes to AI pipeline events
│                            and runs the retention sweep cron; never calls updateSchema()
├── auth.ts                — Better Auth instance config (session + apiKey plugins)
├── mikro-orm.config*.ts   — driver-specific config; selected at boot
├── entities/              — MikroORM entities (Model)
├── lib/
│   ├── event-bus.ts       — EventBus interface + in-memory implementation
│   └── artifact-storage.ts— ArtifactStorage interface (local FS / S3 backends)
├── services/              — cross-module services (e.g. event-bus singleton wiring)
├── modules/<feature>/
│   ├── routes.ts          — Controller — Fastify plugin
│   ├── schemas.ts         — Zod schemas + derived types
│   └── service.ts         — Business logic; receives EntityManager
├── views/
│   ├── layouts/main.eta   — full-page shell
│   ├── pages/<screen>.eta — page bodies (rendered when HX-Request is absent)
│   └── partials/<frag>.eta— HTMX swap targets
└── client/
    ├── app.ts             — HTMX init, Alpine init, Flowbite re-init on after-settle
    └── htmx-events.ts     — central constants for every HTMX event name
                             (forward-compat for HTMX 4.0 htmx:xhr:* → htmx:fetch:* rename)
```

Currently extant module directories: `auth/`, `health/`, `ingest/`. Other modules in this doc (runs, dashboard, search, settings, AI) are spec'd but not yet implemented — see `tasks.md` for the dependency-ordered backlog.

---

## 4. End-to-end request lifecycles

Each subsection traces one canonical flow from arrival to terminal state. The "Authoritative source" line names the spec sections this lifecycle is composed from; this doc adds nothing new — it only sequences them.

### 4.1 CI ingest — `POST /api/v1/projects/:slug/runs`

*Authoritative source: `skills/ctrf-ingest-validation.md`; `product.md` § Feature 1, § Feature 4; `skills/better-auth-session-and-api-tokens.md`; `skills/ai-pipeline-event-bus.md`; `database-design.md` § DD-011.*

```
HTTP request
  │  Headers: x-api-token: ctrf_<token>
  │           Content-Type: application/json | multipart/form-data
  │           Idempotency-Key: <uuid>            (optional)
  │  Body:    CTRF JSON  (+ artifact file parts if multipart)
  │
  ▼
[Reverse proxy]                    Caddy / nginx (TLS, body-size cap)
  │
  ▼
[Fastify accepts socket]           src/server.ts → app instance
  │
  ▼
[Global preHandler hook]           src/app.ts
  │  1. Setup-wizard gate: if users table is empty AND path != /setup,
  │     redirect to /setup. (Bypassed once any user exists.)
  │  2. skipAuth check: route's config.skipAuth shortcuts the rest.
  │  3. Token auth: x-api-token: ctrf_* → auth.api.verifyApiKey()
  │  4. (Fallback) session cookie → auth.api.getSession()
  │  5. On failure: HTMX → HX-Redirect: /login (status 200);
  │                 otherwise → 302 /login
  │
  ▼
[Per-route rate limit]             @fastify/rate-limit
  │  Key: x-api-token (per-token limit) — overrides default IP-based key.
  │  Limit: token.rate_limit_per_hour, default 120/hour.
  │  On 429: { error: "Rate limit exceeded" } JSON.
  │
  ▼
[Schema validation]                @fastify/type-provider-zod
  │  - params  ← z.object({ slug: string })
  │  - body    ← CtrfReportSchema  (src/modules/ingest/schemas.ts)
  │  On Zod failure: 422 { error, issues: [...] }
  │
  ▼
[Route handler]                    src/modules/ingest/routes.ts
  │  - Verify token's metadata.projectId matches the resolved project.
  │  - Idempotency-Key check via service:
  │      hit  → return 200 with original runId + X-Idempotent-Replay: true
  │      miss → continue
  │  - Multipart: parse `ctrf` field, stream artifact file parts to
  │    ArtifactStorage; per-file 413 caps (img 10MB, vid 100MB, zip 200MB,
  │    log 5MB); per-run cap MAX_ARTIFACT_SIZE_PER_RUN (default 1GB).
  │  - Delegate to IngestService.ingest(em, slug, dto, artifacts).
  │
  ▼
[IngestService]                    src/modules/ingest/service.ts
  │  - em.create(TestRun, ...)
  │  - bulkInsertResults() — 500-row chunks, em.flush() + em.clear() per
  │    chunk, setImmediate yield between chunks (event-loop friendliness
  │    rule from skills/ctrf-ingest-validation.md).
  │  - em.create(TestArtifact, ...) per uploaded file with the storage URI
  │    returned by ArtifactStorage.put().
  │  - em.create(IngestIdempotencyKey, { key, runId }) if header was present.
  │  - All-or-nothing: a transaction wraps run + results + artifacts +
  │    idempotency-key writes. (Spec'd in `tasks.md` ingest story.)
  │
  ▼
[Post-commit publish]              src/services/event-bus.ts
  │  eventBus.publish('ai',  HtmxEvents.RUN_INGESTED, { runId, orgId, … })
  │  eventBus.publish('ui',  HtmxEvents.RUN_INGESTED, { runId, orgId, … })
  │  Fire-and-forget — ingest does NOT await downstream subscribers.
  │
  ▼
[Response]                         201 { runId: "E2E-042" }

Asynchronously, two subscriber chains start:
  - 'ai'  group → AiPipelineService A1 → A2 → A3 (see §4.5)
  - 'ui'  group → SSE registry → connected browser tabs (see §4.4)
```

**Failure-mode contracts** (each enforced at one layer; do not duplicate):

| Failure | Layer | Status |
|---|---|---|
| Missing/invalid `x-api-token` | global preHandler | 401 |
| Token scoped to a different project | route handler | 403 |
| Project slug not found | service (after auth) | 404 |
| Body fails Zod | type-provider-zod | 422 |
| Artifact exceeds per-file or per-run cap | route handler (multipart streaming) | 413 |
| Rate limit exceeded | rate-limit plugin | 429 |
| DB constraint failure mid-transaction | service (transaction rolls back) | 500 |

### 4.2 Browser page load — `GET /projects/:slug/runs`

*Authoritative source: `skills/fastify-route-convention.md`; `skills/eta-htmx-partial-rendering.md`; `skills/zod-schema-first.md`; `skills/better-auth-session-and-api-tokens.md`.*

```
GET /projects/frontend-e2e/runs?status=failed&page=2
Cookie: better-auth.session_token=<…>
(no HX-Request header — direct browser navigation)
  │
  ▼
[Reverse proxy → Fastify → preHandler]
  │  Session cookie validated via auth.api.getSession().
  │  request.user is populated; request.em is the org-scoped EntityManager.
  │
  ▼
[Schema validation]
  │  params      ← z.object({ slug: string })
  │  querystring ← RunFilterSchema
  │  Coerced types: page: number (z.coerce.number), status: enum, …
  │
  ▼
[Route handler]                    src/modules/runs/routes.ts (planned)
  │  const runs = await runsService.list(request.em, {
  │    slug: request.params.slug, ...request.query,
  │  });
  │  return reply.page('run-list', { runs, title: 'Test Runs — CTRFHub' });
  │
  ▼
[reply.page() decorator]           registered in src/app.ts
  │  if (request.headers['hx-request'] === 'true')
  │    → render src/views/partials/run-list.eta             (just the fragment)
  │  else
  │    → render src/views/layouts/main.eta with body=run-list  (full shell)
  │
  ▼
[Eta render → HTML response]
  │  Full page response includes:
  │    <html> shell, <head> assets, nav landmark, main landmark,
  │    <body hx-ext="morph"> globally,
  │    a swap-target container e.g. <div id="run-list-container" hx-get=…>
  │    that contains the partial as its initial content.
  │
  ▼
[Browser parses + executes htmx.js + Alpine.js]
  │  - HTMX scans the document for hx-* attributes.
  │  - Alpine scans for x-data and hydrates ephemeral state outside swap targets.
  │  - Flowbite initializes via initFlowbite() in the after-settle listener.
  │  - SSE connection is opened for the page's org (see §4.4).
```

**Why the same handler serves both partial and full responses:** `reply.page('run-list', data)` is the partial-vs-full-page decorator from `eta-htmx-partial-rendering.md`. Routes never branch on `HX-Request` themselves.

### 4.3 HTMX swap — filter change on the runs list

*Authoritative source: `skills/htmx-alpine-boundary.md`; `skills/eta-htmx-partial-rendering.md`; `skills/htmx-4-forward-compat.md`.*

```
User toggles a status filter inside an Alpine x-data dropdown
that lives OUTSIDE #run-list-container.
  │
  ▼
Alpine emits a custom event:  $dispatch('filterChanged', { status: 'failed' })
  │
  ▼
HTMX trigger fires on #run-list-container:
  hx-get="/projects/frontend-e2e/runs?status=failed"
  hx-trigger="filterChanged from:body"
  hx-target="#run-list-container"     (placed on the requesting element — not inherited)
  hx-swap="morph:innerHTML"
  HX-Request: true                     (added automatically by HTMX)
  │
  ▼
[Same Fastify route as §4.2]
  │  Auth: session cookie via global preHandler.
  │  Schema: same RunFilterSchema validates the new querystring.
  │  Service: runsService.list() returns the filtered set.
  │  Renderer: reply.page('run-list', …) — but this time HX-Request is true,
  │            so Eta renders ONLY partials/run-list.eta.
  │
  ▼
[Browser receives partial HTML]
  │  idiomorph swaps the contents of #run-list-container in-place.
  │  Alpine state on the dropdown OUTSIDE the target survives — that's the
  │  whole point of the boundary rule: the dropdown is open before, after,
  │  and during the swap.
  │  After-settle hook re-runs initFlowbite() on the new DOM nodes.
```

**Forbidden in this flow** (each is a fast-fail review finding):

- An `x-data` attribute inside `partials/run-list.eta` — it would be wiped on every swap.
- `hx-target` on the `<form>` tag and `hx-trigger` on a child input — `hx-target` and `hx-swap` must be on the same (requesting) element.
- A raw `'htmx:xhr:loadstart'` event-name string in client code — must come from `src/client/htmx-events.ts` constants.

### 4.4 SSE update — live screen refresh after an ingest

*Authoritative source: `database-design.md` § DD-011; `database-design.md` § DD-012 (rate limits); `skills/fastify-route-convention.md` § SSE.*

```
[At page load, the browser opens the SSE channel]
  │
  ▼
GET /api/sse/orgs/:orgId
Accept: text/event-stream
Cookie: better-auth.session_token=<…>
  │
  ▼
[Fastify SSE route]                Authenticate via session cookie.
  │  Enforce per-user and per-org connection caps (DD-012).
  │  Register the connection in the SSE registry, keyed by orgId+userId.
  │  Send periodic keepalive frames; cap connection age (forces graceful
  │  reconnection so a stuck connection doesn't pin a worker forever).
  │  On client disconnect → cleanup the registry entry.
  │
  ▼
… meanwhile, an unrelated CI run completes (§4.1) and the ingest handler
publishes 'ui' → run.ingested on the EventBus …
  │
  ▼
[SSE registry subscribes to 'ui' events]
  │  For each registered connection whose orgId matches event.orgId:
  │    write `event: run.ingested\n`
  │    write `data: ${JSON.stringify({ projectId, projectSlug, runId, status, passRate })}\n\n`
  │
  ▼
[Browser HTMX SSE extension receives the frame]
  │
  ▼
HTMX matches subscribers via hx-trigger="sse:run.ingested[…]":
  - Dashboard KPI cards   → silent  hx-get re-render of /projects/.../dashboard/kpis
  - Project-list row 42   → silent  hx-get of /projects/.../row  (filter via [detail.projectId==42])
  - Test Runs list        → reveal  "↑ 1 new run — click to load" banner (no auto-insert)
  - Milestone progress    → silent  re-render if run.milestone_id is set (Business edition)
  │
  ▼
Each silent re-render is itself an HTMX swap (= §4.3 path with HX-Request: true).
```

**Why an EventBus indirection between ingest and SSE:** for MVP the bus is in-memory and the indirection looks superfluous, but the same interface is implementable as Redis Pub/Sub for horizontal scaling. The ingest handler does not know whether it is in a single-node deployment or a multi-replica one. (`database-design.md` § DD-011.)

**Graceful shutdown interaction:** on `SIGTERM`, step 4 of the shutdown sequence is "Drain SSE connections" — the server sends a final `event: shutdown\ndata: {}` frame so the HTMX SSE extension reconnects to whichever instance the load balancer routes it to next. (`architecture.md` § Graceful shutdown.)

### 4.5 AI pipeline — async processing of a freshly ingested run

*Authoritative source: `skills/ai-pipeline-event-bus.md`; `ai-features.md` § Implementation Architecture, § Durability and restart recovery.*

```
EventBus 'ai' subscriber chain — runs in the worker container, not the api.

run.ingested
  │
  ▼
[A1 — categorizeRun]               AiPipelineService.handleRunIngested
  │  1. Consent gates:
  │       AI_CLOUD_PIPELINE === 'on'   ?
  │       organizations.ai_cloud_ack_at IS NOT NULL  ?
  │       If either gate is closed → mark ai_pipeline_log row 'done' and
  │       publish next event without an LLM call.
  │  2. Reservation:
  │       INSERT … ON CONFLICT(test_run_id, stage) DO NOTHING
  │       UPDATE … SET status='running', worker_id=$id, attempt=attempt+1
  │              WHERE status='pending' AND attempt < 3   RETURNING id
  │       If no row reserved → another worker has it; return.
  │  3. Idempotency check:
  │       If primary output already persisted → mark 'done', publish next, return.
  │  4. Heartbeat timer: setInterval every 15 s → UPDATE heartbeat_at = NOW().
  │  5. Call AiProvider.categorizeFailures(failedResults, batchSize: 20, cap: 500).
  │  6. On success: write categorization to test_results, mark 'done',
  │     clear heartbeat, publish run.ai_categorized.
  │  7. On transient error (attempt < 3): release row to 'pending'; no publish.
  │  8. On terminal error (attempt = 3): mark 'failed'; publish next stage
  │     with `partial: true` so downstream runs with degraded input.
  │
  ▼
run.ai_categorized
  │
  ▼
[A2 — correlateRootCauses]         Same lifecycle pattern, single LLM call,
  │                                 cap output at 10 clusters.
  ▼
run.ai_correlated
  │
  ▼
[A3 — generateSummary]             Aggregate metrics + A1/A2 output;
  │                                 NO raw test names sent to the LLM
  │                                 (privacy gate, ai-features.md).
  ▼
run.ai_summarized

A4 (anomaly detection) is Phase 2 — explicitly NOT in MVP.
```

**Restart recovery (mandated by `ai-pipeline-event-bus.md` § Boot-time recovery):**

```
worker.ts boot sequence:
  1. UPDATE ai_pipeline_log SET status='pending', worker_id=NULL, heartbeat_at=NULL
       WHERE status='running'
         AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '2 minutes');
  2. For each remaining 'pending' row in runs from the last 24 h, republish the
     stage's trigger event so a worker picks it up.
  3. THEN subscribe to live EventBus events.
```

This is the design that makes the in-memory EventBus survivable. The bus itself is fire-and-forget; durability lives in the `ai_pipeline_log` table.

**Test doubles** — `MockAiProvider` is the only AI double used in any test tier. Never `nock`/`msw` for AI HTTP. (`skills/ai-pipeline-event-bus.md` § Test double.)

### 4.6 Auth — the same global preHandler serves browsers and CI

*Authoritative source: `skills/better-auth-session-and-api-tokens.md`; `architecture.md` § CSRF protection; `product.md` § Feature 0, § Feature 5.*

```
Every request → global preHandler (src/app.ts) :

  if (firstRunGate.usersTableEmpty() && path != '/setup' && !skipAuth(route))
    → redirect '/setup'        (one-shot bootstrap; route is 410 Gone afterward)

  if (route.config.skipAuth)
    → return                   (continues to the route handler with no auth)

  if (request.headers['x-api-token']?.startsWith('ctrf_'))
    → auth.api.verifyApiKey()  (Better Auth apiKey plugin; storeRawKey: false)
    → on success: request.apiKeyUser = { id, metadata: { projectId }, … }
    → on failure: 401 JSON
    → return

  const session = await auth.api.getSession({ headers: request.headers });
  if (session)
    → request.user = session.user
    → request.org  = session.org
    → return

  // Unauthenticated, neither token nor session
  if (request.headers['hx-request'])
    → reply.header('HX-Redirect', '/login').code(200).send()
    → (HTMX consumes HX-Redirect cleanly)
  else
    → reply.redirect('/login')
```

**Why no explicit CSRF token middleware:** Better Auth issues `SameSite=Lax` cookies; HTMX uses XHR/fetch; modern browsers do not send `SameSite=Lax` cookies on cross-origin XHR. Adding an explicit CSRF token would be redundant and would complicate API-key flows. (`architecture.md` § CSRF protection.)

**Token never leaves the boundary:** the raw `ctrf_*` value is shown to the user *once* at creation; only the hash is stored. Logging the raw token value is a forbidden pattern. The route handler reads `request.apiKeyUser.metadata.projectId` — never the token itself.

---

## 5. Cross-cutting concerns visible in every flow

| Concern | Where it sits in the flow | Spec |
|---|---|---|
| **Org scoping** | `request.em` is wrapped with an `organization_id` filter populated from the session or token before the handler runs. Search and every list query are constrained at the SQL `WHERE` level — never post-filtered. | `architecture.md` § Global Search → Scope guards; `database-design.md` |
| **Schema sync** | `orm.schema.updateSchema()` runs in `server.ts` only — never in `worker.ts`. Workers `depends_on` the api container. | `architecture.md` § Schema sync at boot |
| **Rate limiting** | Per-route via `config.rateLimit` overrides; default 600/min global. Mixed backends — library default store for high-volume endpoints, in-process LRU for enumeration-sensitive endpoints. | `architecture.md` § Backend (rate-limit row); DD-029 |
| **Error rendering** | The global error handler in `app.ts` returns `partials/error.eta` to HTMX/browser requests and JSON to API requests. Routes throw `fastify.httpErrors.badRequest(...)` — no manual `reply.send()` for errors. | `skills/fastify-route-convention.md` § Error handling |
| **Graceful shutdown** | SIGTERM → stop accepting → drain in-flight ingests (25 s budget) → cancel pending AI events (recovery query re-queues) → drain SSE → close ORM pool → exit. | `architecture.md` § Graceful shutdown |

---

## 6. What this document is *not*

- **Not a replacement for the per-feature specs.** When you implement a feature, the cited skill or `docs/planning/*` section is authoritative. This doc only sequences them.
- **Not a description of current implementation.** Several modules (runs, dashboard, search, settings, AI pipeline) are spec'd but not yet implemented — see `tasks.md` for status. The flows above describe what the spec mandates; the codebase is being built up against them.
- **Not a place to introduce new conventions.** Anything that looks like a new rule here is a bug in the doc. File a gap in `docs/planning/gaps.md`.

---

## 7. Open ambiguities flagged for André (not resolved here)

These came up while sequencing the flows above and are not unambiguously answered by the existing spec. They are listed here for routing into `gaps.md` rather than resolved unilaterally:

1. **Transaction boundary on the ingest write.** `ctrf-ingest-validation.md` requires chunked bulk insert (500 rows + `em.clear()` + `setImmediate` per chunk). `em.clear()` between chunks implies the insert cannot be a single MikroORM transaction across all chunks — the identity map is reset. The expected atomicity contract (all-or-nothing for the entire run? all-or-nothing per chunk with a compensating delete on failure?) is not pinned down in any current doc. Most likely answer: per-run transaction at the connection level via `em.getConnection().transactional()` while still chunk-flushing inside it; needs confirming.
2. **EventBus delivery semantics on api → worker boundary.** DD-011 says ingest publishes to `eventBus.publish(...)`. In a two-container deployment (api + worker) with the in-memory bus, the publish in the api process is invisible to the worker process. The current spec implies workers handle AI pipeline events by polling `ai_pipeline_log` for `pending` rows on boot and then again continuously — but the *steady-state* trigger path between api and worker isn't named. Implication: either (a) ingest writes the `pending` row itself before responding (and the worker has a polling loop), or (b) the EventBus has a cross-process implementation in MVP. Worth pinning down before AI-1 lands.
3. **SSE channel scope when a user belongs to multiple orgs.** DD-011 says one stream per user *per org* (`/api/sse/orgs/:orgId`). For users in two orgs viewing two tabs, are these independent connections that count separately against DD-012's per-user cap, or does the cap apply per (user, org) pair? Affects connection-cap math for self-hosters with shared admin accounts.
4. **`run.ingested` payload shape.** DD-011 § Event format shows `{projectId, projectSlug, runId, status, passRate}`. `ai-pipeline-event-bus.md` shows `{ runId, orgId }`. The two are not contradictory (the AI bus carries a subset) but it would be cleaner to have one canonical schema definition that the AI subscriber projects out of. Candidate location: `src/services/event-bus.ts` next to the `EventBus` interface.

These belong in `gaps.md` if the existing entries don't already cover them — I have not edited `gaps.md` from here.

---

## 8. References

- `docs/planning/architecture.md` — stack and deployment topology
- `docs/planning/database-design.md` — Model layer; DD-010 / DD-011 / DD-012 (SSE + EventBus + capacity)
- `docs/planning/product.md` — acceptance criteria for every feature; auth contract (Feature 5)
- `docs/planning/ai-features.md` — pipeline stage definitions and durability rules
- `skills/fastify-route-convention.md` — Controller layer
- `skills/zod-schema-first.md` — schemas as single source of truth
- `skills/eta-htmx-partial-rendering.md` — View layer; partial vs. full page
- `skills/htmx-alpine-boundary.md` — client-side division of labor
- `skills/htmx-4-forward-compat.md` — event-name constants, `hx-target`/`hx-swap` placement
- `skills/ctrf-ingest-validation.md` — ingest contract, chunked bulk insert
- `skills/ai-pipeline-event-bus.md` — A1–A4 stage handlers, recovery
- `skills/better-auth-session-and-api-tokens.md` — global preHandler and token semantics
- `skills/mikroorm-dual-dialect.md` — Postgres/SQLite parity rules

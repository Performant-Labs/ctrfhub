# CTRFHub Architecture

> **Status note (2026-05-19).** This document was augmented by story `architecture-augment`
> to add the **Code Architecture** sections (`Layering`, `Code Conventions`, `Operational
> Invariants`, `Document Authority`) that the Architecture Reviewer (A) needs as its audit
> yardstick. See `.argos/stories/architecture-augment/` for the gap analysis that motivated
> the augmentation. The augmentation was authorized by an explicit exception to the standing
> "never modify `docs/planning/*`" rule — the exception process is now codified in
> [§Document Authority and Exception Process](#document-authority-and-exception-process).
>
> Sections derived from observable patterns in `src/` (rather than from a pre-existing
> planning doc) are explicitly marked **[descriptive-from-code]**. Sections derived from an
> existing planning document or skill are marked **[derived-from-docs]**. Where the codebase
> drifts from the intended rule, the intended rule is stated as the standard and the drift is
> noted parenthetically — André adjudicates drift; agents follow the stated rule.

## Runtime & Language

| Concern | Choice | Rationale |
|---|---|---|
| **Runtime** | Node.js 22 LTS | Active LTS; native ESM; `--watch` flag eliminates nodemon |
| **Language** | TypeScript 5.x (strict) | End-to-end type safety; required for MikroORM v7 entity pattern |
| **Package manager** | npm | Default; no toolchain overhead |
| **Module system** | ESM (`"type": "module"`) | Required by MikroORM v7; aligns with Node 22 native ESM |

---

## Backend

| Concern | Choice |
|---|---|
| **HTTP framework** | [Fastify](https://fastify.dev/) + `@fastify/type-provider-zod` |
| **Schema validation** | [Zod](https://zod.dev/) — single source of truth for runtime validation and TypeScript types |
| **Template engine** | [Eta](https://eta.js.org/) via `@fastify/view` — TypeScript-native, actively maintained |
| **Auth** | [Better Auth](https://www.better-auth.com/) — session auth for browsers, project-scoped API tokens for CI |
| **Database ORM** | [MikroORM v7](https://mikro-orm.io/) — single entity definitions, dialect switched via env var |
| **Database (prod)** | PostgreSQL 16 |
| **Database (dev/single-node)** | SQLite via `better-sqlite3` |
| **File uploads** | `@fastify/multipart` |
| **Static assets** | `@fastify/static` |
| **Rate limiting** | `@fastify/rate-limit` — all numeric limits, keys, backends, and the 429 response shape are canonical in DD-012's Layer 2 table (DD-029). Mixed backends: library's default store for high-volume endpoints (ingest, general API, settings, artifacts); in-process LRU for low-volume enumeration-sensitive endpoints (password reset, email verification, webhook dispatcher) |
| **Security headers** | `@fastify/helmet` — CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Cross-Origin-Opener-Policy (DD-028 I7) |
| **Artifact storage** | Local filesystem (default); S3/MinIO-compatible (optional, via env) |

---

## Frontend

| Concern | Choice |
|---|---|
| **Interactivity** | [HTMX 2.x](https://htmx.org/) — all server communication; zero custom fetch/XHR code |
| **Local UI state** | [Alpine.js 3.x](https://alpinejs.dev/) — dropdowns, modals, tab switches |
| **DOM morphing** | [idiomorph](https://github.com/bigskysoftware/idiomorph) — preserves Alpine state across HTMX swaps |
| **CSS framework** | [Tailwind CSS 4](https://tailwindcss.com/) — CSS-first config via `@theme`, no `tailwind.config.js` |
| **Component library** | [Flowbite](https://flowbite.com/) — pre-built Tailwind + Alpine components |
| **Charts** | [Chart.js](https://www.chartjs.org/) |
| **CSS build** | Tailwind CLI (`npx @tailwindcss/cli`) — single command, no bundler |

### Frontend boundary rules

- **HTMX owns** all server communication. Alpine owns ephemeral local state only.
- Alpine `x-data` components must not contain HTMX swap targets.
- All HTMX event listeners reference constants in `src/client/htmx-events.ts` — never raw event name strings (forward-compat with HTMX 4.0 rename of `htmx:xhr:*` → `htmx:fetch:*`).
- `hx-target` and `hx-swap` are always placed on the requesting element, never inherited from a parent.

### Viewport posture — desktop-only product, mobile-first authoring

CTRFHub is a **desktop application** in MVP: design target is 1280×800 CSS px and wider, the product promise is desktop, mobile QA is out of scope, and no mobile layout stories ship. At the same time, screen markup is authored **mobile-first** so that if PL-019 is ever promoted, adding mobile access is a QA-and-polish effort rather than a rewrite. See DD-030 for the decision record.

The viewport meta tag pins the rendered width so mobile browsers show the desktop layout at zoom:

```html
<meta name="viewport" content="width=1280">
```

A user opening CTRFHub on a phone sees the full desktop layout rendered at 1280 CSS px wide; mobile Safari/Chrome scales the page to fit the screen; pinch-zoom works normally. This is the Datadog / Snyk / CircleCI / Buildkite posture — the UI is readable and functional on a phone the way a desktop website is readable on a phone, not the way a mobile-first app is. The developer triage workflow happens at a workstation.

The two postures are kept deliberately separate:

- **Product commitment (desktop-only):** we QA at 1280×800, we don't design or test mobile-specific flows, we don't promise a useful mobile experience, and release notes never claim mobile parity. A user who pulls CTRFHub up on a phone is using it off-label.
- **Authoring commitment (mobile-first):** the *way* we write CSS and markup assumes narrow viewports are the base case and desktop styles are progressive enhancements via `md:` / `lg:` / `xl:`. This is the Tailwind / Flowbite default authoring style anyway — we're choosing not to fight it. It costs nothing at authoring time and makes PL-019 promotion cheap.

Consequences for the codebase:

- **Tailwind responsive utilities are the authoring convention.** Base styles (unprefixed) target narrow viewports; `md:` / `lg:` / `xl:` add desktop enhancements. This matches Tailwind's mobile-first design and matches how Flowbite components ship.
- **Flowbite components render at their responsive defaults** — the Sidebar drawer-collapse behaviour, Navbar hamburger trigger, responsive tables all remain in the component markup. We don't strip them and we don't customise them. If a component collapses to a drawer below `md:`, that collapse still happens on a phone even though we don't ship a mobile product story around it.
- **Tables that exceed narrow viewports get an `overflow-x-auto` wrapper** so the desktop-scale content scrolls horizontally on phones rather than overflowing the body. This is one authoring rule, applied consistently, and costs nothing.
- **Playwright tests run a two-viewport matrix** — 1280×800 is the primary viewport where the full test assertions run; 375×800 runs a narrow-viewport smoke test per screen with minimal assertions (page loads without a console error, no unexpected horizontal overflow outside `.overflow-x-auto` containers). The narrow-viewport smoke is a regression guardrail against CSS drift, not a product commitment to mobile correctness — failures block merge but do not imply the screen has been designed for the narrow case.
- **Accessibility minimums still apply** — WCAG 2.1 AA including the 24×24 CSS px interactive-element floor (which Flowbite's default button sizes exceed). The floor is an accessibility concern for users with motor impairments, not a mobile-touch concern, and survives the desktop-only scope.

The explicit non-commitment: an on-call engineer who gets paged at 2 AM and tries to ack the run from their phone can read everything, but tapping small links means pinch-zooming first. Promotion to "desktop-primary, mobile-degraded-functional" (the posture most dev-tool web apps eventually reach) is tracked in PL-019 — because the authoring is already mobile-first, promotion becomes a QA-commitment and polish effort (drop the viewport pin, run three-viewport Playwright, tighten touch targets to 44×44) rather than a rewrite.

---

## AI Features

| Concern | Choice |
|---|---|
| **Failure categorization** | OpenAI / Groq / Anthropic SDK (configured via env) |
| **Model** | Provider-agnostic; controlled by `AI_PROVIDER` + `AI_MODEL` env vars |

---

## Global Search

Users expect a single search box to find a run, test, or comment by name, ID, or error substring. CTRFHub's MVP implementation is database-native — no external index — so self-hosters don't have to deploy Elasticsearch or OpenSearch to get working search.

### MVP implementation — Postgres FTS and SQLite FTS5

The search endpoint is `GET /api/v1/search?q=:query&scope=:scope&orgId=:orgId` returning a unified result list across three scopes (auto-detected from the query by default):

| Scope | Matches against | Returned fields |
|---|---|---|
| `runs` | `test_runs.id_prefix-run_sequence` exact match, `test_runs.commit_sha` prefix match, `test_runs.environment`, `test_runs.branch` | id, display id, project, started_at, status |
| `tests` | `test_results.test_name` FTS, `test_results.error_message` FTS | id, test_name snippet, run id, status |
| `comments` | `test_result_comments.body` FTS | id, snippet, result id, author, created_at |

Implementation per driver:

- **PostgreSQL:** generated `tsvector` columns on each searchable table (`test_results.search_tsv`, `test_result_comments.search_tsv`) indexed with GIN. `english` text-search configuration for stemming. `websearch_to_tsquery()` for the query parser (handles quoted phrases and `-exclusion`). Ranking via `ts_rank_cd`.
- **SQLite:** FTS5 virtual tables mirrored to the base tables via triggers (`test_results_fts`, `test_result_comments_fts`). `MATCH` query. `bm25()` for ranking.

MikroORM abstracts the driver; the search service has two implementations behind a `SearchProvider` interface, selected at boot by inspecting the dialect.

### Scope guards and multi-tenancy

Every query is constrained by `organization_id` at the query level — not in post-filter. A user's session carries their current org membership; search results never cross org boundaries even if a shared project name exists. Projects the user doesn't have access to within their org are also filtered out at query time.

### Trigger UX

- **Global keyboard shortcut:** `⌘K` / `Ctrl+K` opens a command palette overlay (Tailwind + Alpine.js, no external library). Debounced 200ms. Results grouped by scope with keyboard navigation.
- **Top bar:** a persistent search input in the top bar (always visible — see "Viewport posture" in the Frontend section for why there's no responsive breakpoint qualifier). Same endpoint, same rendering.
- **Recent searches:** last 10 queries persisted to `localStorage` (client-side only — never indexed server-side).

### When FTS stops being enough

Postgres FTS scales comfortably to ~10M `test_results` rows and ~1M comments on a 4-core VPS with default tuning. The signal to graduate to an external index (Meilisearch is the recommended first step — self-hostable, single binary, no ops tax) is when any of:

- p95 search latency > 500ms
- Users routinely need fuzzy / typo-tolerant matching (not FTS's strength)
- Cross-field weighted ranking is needed (e.g. "rank by test name hit, then error message, then comments")

External index deployment is deferred (parking lot) — schema fields that would feed Meilisearch are already present, so the migration is additive.

---

## Local Development

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Docker Desktop | Latest | Container runtime |
| Node.js | 22 LTS | TypeScript compilation, local CLI tools |
| npm | Bundled with Node | Package management |

### Starting the dev environment

Everything runs in containers. There is no "run Node directly" workflow for the app itself.

```bash
# 1. Clone and install (needed for editor tooling and running mikro-orm CLI)
git clone https://github.com/ctrfhub/ctrfhub.git
cd ctrfhub
npm install

# 2. Copy env template
cp .env.example .env
# Edit .env — set BETTER_AUTH_SECRET and PUBLIC_URL at minimum; choose SQLITE or Postgres dialect

# 3. Start the full dev stack
docker compose -f compose.dev.yml up
```

The dev compose file mounts the source tree as a volume and runs `tsx watch` inside the container, giving hot-reload without rebuilding the image.

### Dev compose services

```
┌─────────────────────────────────┐
│        compose.dev.yml          │
│                                 │
│  app (ctrfhub)                  │
│  ├── tsx watch src/index.ts     │
│  ├── css:dev (Tailwind --watch) │
│  └── port 3000                  │
│                                 │
│  db (postgres:16-alpine)        │
│  └── port 5432 (local only)     │
└─────────────────────────────────┘
```

SQLite users skip the `db` service entirely — set `SQLITE_PATH=/data/ctrfhub.db` and the app creates the file automatically.

### Database schema management (dev)

Schema is managed by MikroORM's schema-generator (`orm.schema.updateSchema()`), not by migration files. The app syncs the database schema to match entity definitions on every boot. This is idempotent — safe on fresh and existing databases.

```bash
# Inspect what DDL changes schema-generator would apply (dry-run)
docker compose -f compose.dev.yml exec app npm run schema:emit:pg
docker compose -f compose.dev.yml exec app npm run schema:emit:sqlite

# Apply schema changes (equivalent to what happens on app boot)
docker compose -f compose.dev.yml exec app npm run schema:update:pg
docker compose -f compose.dev.yml exec app npm run schema:update:sqlite
```

> **Note (INFRA-005):** Migration files (`src/migrations/`) no longer exist. When v1.0 ships and we have real production deployments with data to preserve, generate ONE baseline migration from the v1.0 entity state, commit it as `src/migrations/0001_baseline.ts`, and switch back to migration-mode for production upgrades.

### Running tests (dev)

```bash
# Unit + integration tests (uses fastify.inject — no real server)
docker compose -f compose.dev.yml exec app npm test

# Watch mode
docker compose -f compose.dev.yml exec app npm run test:watch
```

---

## Production Deployment

### Container-only deployment

CTRFHub ships as a single Docker image. There is no bare-metal or PaaS deployment path.

```
┌─────────────────────────────────────────────┐
│            compose.yml (production)          │
│                                             │
│  app (ghcr.io/ctrfhub/ctrfhub:latest)       │
│  ├── Built image (no source mount)           │
│  ├── Compiled JS + pre-built Tailwind CSS    │
│  └── port 3000 (behind reverse proxy)        │
│                                             │
│  db (postgres:16-alpine)                    │
│  └── Named volume: ctrfhub_pgdata           │
└─────────────────────────────────────────────┘
```

```bash
# One-command self-host (Postgres)
docker compose up -d

# SQLite variant — single container, no db service
docker compose -f compose.sqlite.yml up -d
```

### Image build

The production image uses a multi-stage build:

```
Stage 1 — builder
  FROM node:22-alpine
  - npm ci  (--mount=type=cache,target=/root/.npm — BuildKit npm cache)
  - npx tsc (compile TypeScript → dist/)
  - npx @tailwindcss/cli --minify (generate dist/assets/tailwind.css)
  - cp -r src/assets/. dist/assets/  (bridge vendored client JS into dist/assets/)

Stage 2 — runner
  FROM node:22-alpine
  - npm ci --omit=dev --ignore-scripts  (--mount=type=cache for npm)
  - Copy dist/ from builder (no source files, no dev dependencies)
  - CMD ["node", "dist/index.js"]
```

> **Asset-pipeline note (PR #71 — invariant U3).** The builder stage's `cp -r src/assets/. dist/assets/`
> step is **load-bearing, not a convenience.** Production serves static assets from `dist/assets/`
> (`@fastify/static` root, `src/app.ts §5`), but the `postinstall` hook (`scripts/copy-vendor-assets.mjs`)
> vendors client JS into `src/assets/`. Without the bridge copy, vendored client JS 404s at runtime.
> The normative rule is captured below in
> [§Operational Invariants → Asset-pipeline bridging](#operational-invariants). The runner stage
> uses `--ignore-scripts` so the `postinstall` hook does not re-fire against a source-free image.

> **Build-cache note (PR #72 — invariant U2).** Both `npm ci` steps use BuildKit
> `RUN --mount=type=cache,target=/root/.npm` so npm's package cache survives between builds.
> A warm rebuild with no source change completes in 2–3 s (all stages report `CACHED`); a cold
> build is ~57–60 s. The canonical verification command is `scripts/docker-build-cached.sh`
> (also `npm run docker:build:cached`), which builds with a buildx local cache. `.dockerignore`
> is kept tight so the `COPY . .` layer is not invalidated by unrelated files. The normative
> rule is captured below in [§Operational Invariants → Build-layer caching](#operational-invariants).

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | — | Min 32-char random string; consumed by Better Auth (`buildAuth()` in `src/auth.ts`) to sign session cookies. Name dictated by the Better Auth library. |
| `PUBLIC_URL` | ✅ | — | Public base URL (e.g. `https://ctrfhub.example.com`); used for auth redirects |
| `DATABASE_URL` | Postgres only | — | `postgresql://user:pass@db:5432/ctrfhub` |
| `SQLITE_PATH` | SQLite only | `/data/ctrfhub.db` | Path inside container |
| `RETENTION_CRON_SCHEDULE` | ❌ | `0 2 * * *` | Cron schedule for the nightly retention sweep; retention period is configured per org/project in the UI, not via env var |
| `AI_PROVIDER` | ❌ | — | `openai` \| `groq` \| `anthropic` |
| `AI_API_KEY` | ❌ | — | API key for the chosen AI provider |
| `AI_MODEL` | ❌ | — | Model name (e.g. `gpt-4o-mini`) |
| `ARTIFACT_STORAGE` | ❌ | `local` | `local` \| `s3` |
| `S3_ENDPOINT` | S3 only | — | MinIO or S3 endpoint URL |
| `S3_BUCKET` | S3 only | — | Bucket name for artifacts |
| `S3_KEY` | S3 only | — | Access key ID |
| `S3_SECRET` | S3 only | — | Secret access key |
| `PORT` | ❌ | `3000` | HTTP port the app listens on |

> **Authoritative reference:** `deployment-architecture.md` § Environment variables is the canonical list. This table covers the variables most relevant to initial setup.

### Reverse proxy

Place a reverse proxy in front of the app container. The app itself does not handle TLS.

**Caddy (recommended for self-hosters):**
```
ctrfhub.example.com {
    reverse_proxy app:3000
}
```

**nginx:**
```nginx
server {
    listen 443 ssl;
    server_name ctrfhub.example.com;

    location / {
        proxy_pass         http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

### Data persistence

| Data | Storage | Backup recommendation |
|---|---|---|
| Test runs + test records | PostgreSQL named volume / SQLite file | `pg_dump` daily; copy SQLite file |
| Uploaded artifacts | Local volume or S3/MinIO | Replicate S3 bucket; snapshot local volume |
| Auth sessions + API key hashes | PostgreSQL / SQLite (same DB) | Covered by DB backup |

### Schema sync at boot

Schema is synced automatically at container startup using `orm.schema.updateSchema()`, but **only in the `api` container** (`dist/server.js`). The `worker` container (`dist/worker.js`) must never call `updateSchema()`.

```typescript
// src/server.ts  — api container entrypoint ONLY
const orm = await MikroORM.init(config);
await orm.schema.updateSchema();   // sync schema — api entrypoint only
await startServer();

// src/worker.ts  — worker container entrypoint
// ❌ Do NOT call updateSchema() here.
// The worker depends_on the api container being started,
// which guarantees schema is already synced.
await startWorker();
```

**Why this matters:** Both `api` and `worker` start from the same image. If both called `updateSchema()` simultaneously, they would race to alter tables. The race is mostly safe (DDL is idempotent), but the losing container may encounter transient lock-wait errors on PostgreSQL.

For HA multi-instance deployments (multiple `api` replicas), run schema sync as a dedicated one-shot init container before starting the app containers.

> **Forward-looking note (INFRA-005):** The schema-generator approach is correct for MVP — no production users, no data to preserve, no migration ceremony needed. When v1.0 ships and we have real deployments, generate ONE baseline migration from the v1.0 entity state, commit it as `src/migrations/0001_baseline.ts`, and switch back to migration-mode for production upgrades. Schema-generator is a development/MVP tool; migrations are the production-safe tool for evolving schema while preserving data.

### Graceful shutdown

The `api` process must handle `SIGTERM` gracefully. Docker sends `SIGTERM` when `docker compose down` or a rolling deploy is triggered. The process has `SIGTERM_TIMEOUT` seconds (default 30s) before Docker sends `SIGKILL`.

**Shutdown sequence:**

```
SIGTERM received
  │
  ├─ 1. Stop accepting new connections (Fastify closes its listening socket)
  │       → In-flight requests continue; new requests get TCP RST
  │
  ├─ 2. Wait for in-flight ingest requests to complete
  │       → A chunked bulk insert (setImmediate chain) may take several seconds
  │         for large CTRF payloads; let it finish to avoid a partial run in DB
  │       → Timeout: 25s (leaves 5s buffer before SIGKILL)
  │
  ├─ 3. Cancel pending AI pipeline EventBus events
  │       → Any run.ingested events not yet picked up by AiCategorizerService
  │         are abandoned; startup recovery query re-queues them on next boot
  │       → Do NOT wait for AI API calls in progress — they are idempotent
  │
  ├─ 4. Drain SSE connections
  │       → Send a final `event: shutdown\ndata: {}\n\n` frame so clients know
  │         to reconnect; HTMX SSE extension handles reconnect automatically
  │
  └─ 5. Close DB connection pool and exit(0)
```

**Implementation sketch:**

```typescript
// src/server.ts
const server = await buildApp();
await server.listen({ port: PORT, host: '0.0.0.0' });

const shutdown = async (signal: string) => {
  server.log.info({ signal }, 'shutdown initiated');
  await server.close();   // stops new connections; waits for in-flight requests
  await orm.close();      // closes DB connection pool
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

Fastify's `server.close()` internally calls `closeAllConnections()` and waits for pending requests. The default wait is controlled by Fastify's `closeGracefully` option — set to `true`.

**Docker Compose setting:**

```yaml
services:
  api:
    stop_grace_period: 30s   # matches SIGTERM_TIMEOUT; default is 10s — too short
```

The `worker` container follows the same pattern but waits for the current retention batch to complete before closing. A retention sweep that is mid-batch will finish its current 1,000-row chunk, then stop.

---

## Security

### CSRF protection

HTMX makes all requests via XHR/fetch — not HTML form navigation. Browsers enforce `SameSite=Lax` on XHR/fetch: **the session cookie is not sent on cross-origin requests**. A malicious page on `evil.com` that attempts to POST to a CTRFHub instance cannot attach the session cookie; the attack fails at the browser before reaching the server.

**No explicit CSRF token is required.** Better Auth issues `SameSite=Lax` cookies by default. This setting must not be changed to `SameSite=None`.

#### Global auth preHandler and the `/assets/*` bypass (N2)

Authentication is enforced by a **single global `preHandler` hook** registered in
`buildApp()` (`src/app.ts §9`). The hook resolves in ordered branches:

1. **Branch 0 — static-asset bypass.** Requests whose path starts with `/assets/` bypass auth
   entirely (PR #71). Static client assets carry no session and no API token; without the
   bypass the global hook would redirect them to `/login` and the asset would 404. This bypass
   is path-prefix-based and precedes every other branch.
2. **Branch 1 — public-route allow-list.** `/setup`, `/api/auth/*`, `/health`, and `/assets/*`
   are unauthenticated public routes.
3. **Branch 2 — `skipAuth` bypass.** Routes registered with `config: { skipAuth: true }` skip
   the hook. This is the documented per-route opt-out (see `skills/better-auth-session-and-api-tokens.md`).
4. **Branch 3+ — session-cookie / API-token resolution** for everything else.

The `/assets/*` bypass and the public-route allow-list are the only paths that reach a handler
unauthenticated. New unauthenticated routes must be added to the allow-list deliberately, not
left to chance. **[descriptive-from-code]** — captured from `src/app.ts §9`; PR #71 added Branch 0.

---

### Content Security Policy (CSP)

Set via `@fastify/helmet`. The MVP policy is permissive but meaningful — it constrains frame sources and connection targets while allowing `unsafe-inline` for Alpine.js.

**Why `unsafe-inline` is required:** Alpine.js evaluates `x-data` and `x-on:*` attribute values as JavaScript expressions at runtime. A nonce-based strict CSP that eliminates `unsafe-inline` is achievable but requires per-request nonce injection; this is deferred to post-MVP.

**Main-app CSP:**

```
default-src  'self';
script-src   'self' 'unsafe-inline';
style-src    'self' 'unsafe-inline';
frame-src    'self'
             trace.playwright.dev
             loom.com www.loom.com
             youtube.com www.youtube.com youtube-nocookie.com
             vimeo.com player.vimeo.com;
img-src      'self' data:;
media-src    'self';
connect-src  'self';
```

When `ARTIFACT_PUBLIC_URL` is set (per DD-028 I2), that origin is added to `frame-src`, `img-src`, and `media-src`, and removed from `default-src`/`self` semantics at those directives; the operator's separate artifact origin serves the content in a cookie-jar-isolated location.

**Artifact-response CSP** (emitted on HTML artifact responses from `/runs/:id/report/` and any `text/html` body served by `/api/files/*`, per DD-028 I6):

```
sandbox;
default-src 'none';
style-src   'unsafe-inline';
img-src     'self' data:;
```

The `sandbox` directive makes the browser treat the response as a sandboxed document even if the outer iframe attribute was stripped or never set. `default-src 'none'` disables JS `fetch`, WebSocket, and any network call inside the artifact. Belt-and-braces to the iframe sandbox described below.

**Iframe sandbox for user-content HTML.** Playwright HTML reports and single-file `text/html` attachments are rendered inside an iframe with:

```html
<iframe sandbox="allow-scripts allow-forms allow-popups" …></iframe>
```

**The `allow-same-origin` token is deliberately absent** (DD-028 I1). With it, scripts in the iframe could force-reload the page without the sandbox attribute and regain full same-origin access — a widely-known no-op sandbox. Without it, the iframe runs in an opaque origin: `document.cookie` returns empty, `fetch('/api/v1/…')` is cross-origin and carries no CTRFHub session cookie, and storage APIs are scoped to the opaque origin. Interactive navigation inside the report (filter chips, timeline scrubber) still works because `allow-scripts` is present.

**Cross-Origin-Opener-Policy (DD-028 I7):** main-app responses carry `Cross-Origin-Opener-Policy: same-origin` so a new-tab-opened artifact cannot reach back into the CTRFHub tab via `window.opener`. Every link that opens an artifact in a new tab also carries `rel="noopener noreferrer"`; where the app itself calls `window.open`, the features argument includes `'noopener,noreferrer'`. Defence-in-depth — browsers ignoring COOP still get the link-level protection, and vice versa.

`Cross-Origin-Embedder-Policy` is **not** set to `require-corp` in MVP because that would break Playwright Trace Viewer embedding and external video embeds (Loom, YouTube). Revisit if everything CTRFHub embeds ships COEP-compatible resources.

---

### Artifact file serving — rate limit and origin-isolation headers

`GET /api/files/*` is rate-limited to **300 req/min per session-user-id** (local-disk storage only — S3/MinIO pre-signed URLs are single-use with a 1-hour expiry and need no app-layer limit). Canonical row and 429 response shape live in DD-012's Layer 2 table (see DD-029); the remainder of this section covers the per-response isolation headers that are specific to artifact serving.

Per DD-028 I6, both `/api/files/*` and `/runs/:id/report/*` emit the following headers on every response:

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Server's `Content-Type` is authoritative; stops browser sniffing |
| `Cross-Origin-Resource-Policy` | `same-site` (default) or `cross-origin` (when `ARTIFACT_PUBLIC_URL` is set) | Stops third-party origins loading artifacts as a fingerprinting pivot |
| `Referrer-Policy` | `no-referrer` | Stops the referrer leaking CTRFHub URL structure to anything the artifact embeds |
| `Content-Security-Policy` | `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:` on HTML responses only | Belt-and-braces to the iframe sandbox |
| `Cache-Control` | `private, max-age=300, immutable` on `/api/files/*`; `no-store` on `/runs/:id/report/` index | Stale caches can't serve pre-XSS content |

`Content-Disposition` is `inline` for the DD-028 I3 safe-type allowlist (`image/png|jpeg|webp|gif`, `video/mp4|webm`, `audio/mpeg|ogg`, `text/plain ≤ 500 KB`) and `attachment; filename*=UTF-8''<sanitised>` for everything else — including the explicit active-content offenders HTML, SVG, XML, PDF, and archives. Filenames are sanitised per DD-028 I5 (RFC 5987, `\r\n\0` stripped, 200-char cap).

The existing DD-014 CORS headers (`Access-Control-Allow-Origin: trace.playwright.dev`, etc.) sit alongside the I6 set — they are additive, not contradictory. `Access-Control-Allow-Credentials` remains unset.

---

### Health endpoint

`GET /health` — unauthenticated. Readiness-shaped: returns 200 **only after the `api` process has completed boot** (including schema sync). Used by Docker compose `healthcheck`, upstream load balancers, and Kubernetes probes to decide whether to route traffic to this instance.

**MVP boot behaviour (read this first).** In MVP the API process is **not listening** during schema sync — `buildApp()` runs schema sync to completion *before* `app.listen()` returns (`src/index.ts`). A probe arriving during that window therefore sees **connection-refused**, not 503. The `start_period: 30s` on the Docker compose healthcheck is what tolerates the early-boot window; it is the real MVP guarantee. If schema sync fails the process exits non-zero so the orchestrator restarts it.

The process tracks a `bootState` value that transitions through: `booting → migrating → ready`. In MVP only the `ready` (and `ready`-with-DB-unreachable) rows of the status table below are observable from outside the process — the `booting` and `migrating` 503 rows are unreachable in production today and are retained for forward compatibility. The `migrating` state represents the schema-generator sync phase (`orm.schema.updateSchema()`) rather than running migration files (INFRA-005 pivot).

**Response shape:**

```json
{ "status": "ok", "db": "ok", "bootState": "ready", "version": "1.0.0", "uptime": 3600 }
```

**Status codes:**

| `bootState` | HTTP | `status` | Notes |
|---|---|---|---|
| `booting` | 503 | `booting` | Forward-compat only — **unreachable in MVP** (the server isn't listening during this window; probes get connection-refused). Retained so a future restructure that registers `/health` and calls `app.listen()` before schema sync can return a real 503 here. |
| `migrating` | 503 | `migrating` | Forward-compat only — **unreachable in MVP** (same reason). If a future restructure exposes the schema-generator window, this is the row a probe would see — connection-refused becomes 503-during-DDL and load balancers stop routing traffic to a DB undergoing schema changes. |
| `ready` | 200 | `ok` | Schema sync complete, DB reachable, Redis reachable (if configured). This is the **only** 200 row. |
| `ready` but DB unreachable | 503 | `error` | Pool exhaustion or connectivity failure after successful boot. This is the operative 503 row in MVP. |

**Checks performed (only in `ready` state):**
- **DB:** `SELECT 1` — catches pool exhaustion and connectivity failures
- **Redis:** ping, only when `EVENT_BUS=redis`
- **Artifact storage:** not checked (adds latency; disk/S3 failures surface via ingest errors instead)

**Why readiness, not liveness:** A separate `GET /livez` (returns 200 whenever the process is running, ignoring DB and schema sync) can be added later if k8s deployments need to distinguish "kill this pod" from "don't route to this pod". For MVP, single-container deployments don't benefit from the distinction — the Docker healthcheck behaviour we need is readiness (route to me when ready).

**Schema sync window (why early-boot probes are connection-refused, not 503).** A load balancer that started routing traffic to an instance whose schema doesn't match the application's expectations would see 500s on every request until sync completes. In MVP we prevent that by **not opening the listening socket until schema sync resolves** — probes during sync get connection-refused (which every load balancer treats the same as 503-not-ready) and the compose `start_period: 30s` absorbs the cold-start window. On a cold Postgres, schema sync can take a few seconds; `start_period` is sized to swallow that comfortably.

A future restructure could register `/health` and call `app.listen()` *before* schema sync, so probes during sync receive an actual 503-with-body — useful in deployments that need to distinguish "starting" from "process dead" without relying on the `start_period` heuristic. That restructure is out of scope for MVP; the rows in the table above are retained so the contract is defined when the restructure lands.

**Worker startup (note on `depends_on: service_healthy`):** `deployment-architecture.md` uses `depends_on: { api: { condition: service_healthy } }` on the `worker` container specifically to guarantee schema sync has completed before the worker boots. That `depends_on` clause is load-bearing — it is the only reason the worker can safely assume schema is applied.

---

## CI / CD

### Recommended pipeline (GitHub Actions)

```
push to main
  ├── test job: docker build --target builder → npm test
  ├── lint job: tsc --noEmit + eslint
  └── release job (on tag):
        ├── docker buildx build --platform linux/amd64,linux/arm64
        └── docker push ghcr.io/ctrfhub/ctrfhub:<tag>
```

### Sending test reports to CTRFHub from CI

```yaml
# .github/workflows/test.yml
- name: Run tests
  run: npx playwright test --reporter=ctrf-json

- name: Push report to CTRFHub
  run: |
    curl -X POST ${{ vars.CTRFHUB_URL }}/api/v1/projects/${{ vars.CTRFHUB_PROJECT_SLUG }}/runs \
      -H "x-api-token: ${{ secrets.CTRFHUB_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d @ctrf-report.json
```

`CTRFHUB_TOKEN` is a project-scoped API token generated in CTRFHub project settings. `CTRFHUB_PROJECT_SLUG` is the URL slug of the project (shown in project settings).

### Issue-management workflows (PR #75 — update U1)

Beyond the build/test/release pipeline above, two repository-hygiene GitHub Actions workflows
are in place. Both are **LLM-free** — they use only GitHub-native primitives and `actions/stale`,
so they carry zero recurring API cost. The normative rules are stated in
[§Operational Invariants → Issue-management workflows](#operational-invariants); the summary:

- **`dedupe-issues.yml`** — runs on `issues: opened`. Extracts keywords from the new issue and
  runs `gh issue list --search` to surface 0–5 possibly-similar prior issues as a comment. The
  0-candidate path is silent (no comment). No Claude/LLM call — GitHub's own search ranking does
  the matching.
- **`stale.yml`** — a daily (`schedule` + `workflow_dispatch`) `actions/stale@v9` sweep that
  labels and, after a grace window, closes inactive issues and PRs. Items carrying the `pinned`
  label are exempt from the sweep; the `stale` label marks the warning state.
- **`sync-labels.yml`** — idempotently creates the `stale` label the sweep depends on.

These workflows are additive to `ci.yml`, `pr-review.yml`, and `release.yml`, which are untouched.

---

## Layering and Dependency Direction

> **[descriptive-from-code]** — this section captures the majority pattern observable in `src/`
> as of 2026-05-19. Where the codebase drifts, the intended rule is stated as the standard and
> the drift is noted parenthetically; André adjudicates. This section resolves the
> `architecture.md §Layering` citation in `docs/orchestrator-workflows/auditarchitecture.md`
> and is the primary yardstick for A's **layering** and **dependency-direction** audit dimensions.
>
> **Anchor note.** The literal heading "Layering" is preserved as the leading word of this
> section's title so the `§Layering` citation resolves. The section also carries the
> dependency-direction content that `auditarchitecture.md` separately cites as
> `project-architecture.md §Module boundaries` — see [§Document Authority](#document-authority-and-exception-process)
> for why that content lives here and not in `project-architecture.md`.

### The layering chain

CTRFHub's request-handling code is organized into a strict, one-directional layer chain:

```
            ┌────────────────────────────────────────────────────────┐
            │  presentation         Eta templates (src/views/)        │
            │                       — consume view models only        │
            └───────────────────────────▲────────────────────────────┘
                                         │ render(viewModel)
            ┌────────────────────────────┴────────────────────────────┐
            │  route / handler      src/modules/<m>/routes.ts          │
            │                       — Fastify plugin; HTTP in/out,     │
            │                         Zod validation, status codes     │
            └────────────────────────────▲────────────────────────────┘
                                          │ calls
            ┌─────────────────────────────┴───────────────────────────┐
            │  service              src/modules/<m>/service.ts         │
            │                       src/services/*                     │
            │                       — business logic; no Fastify       │
            │                         request/reply objects            │
            └─────────────────────────────▲───────────────────────────┘
                                           │ uses
            ┌──────────────────────────────┴──────────────────────────┐
            │  repository / ORM     MikroORM EntityManager (request.em)│
            │                       — persistence; entity queries      │
            └──────────────────────────────▲──────────────────────────┘
                                            │ maps
            ┌───────────────────────────────┴─────────────────────────┐
            │  entity / DB          src/entities/* → PostgreSQL/SQLite │
            └─────────────────────────────────────────────────────────┘

  Dependency direction: every arrow points UP. A lower layer never imports
  from a higher layer. Templates never import a service; entities never
  import a route; a service never touches a FastifyRequest.
```

### Layer rules (normative)

1. **Presentation consumes view models only.** Eta templates under `src/views/` render plain
   data objects ("view models") prepared by the route/handler layer. A template never imports a
   service, a repository, an entity class, or the EntityManager. The route shapes the view model;
   the template renders it.
2. **Routes own HTTP, services own logic.** A `src/modules/<m>/routes.ts` file is a Fastify
   plugin: it parses/validates the request (via the Zod schema), calls into the service, maps
   the result or thrown error to a status code, and renders or sends. It contains **no business
   logic**. Canonical example: `src/modules/ingest/routes.ts` delegates all ingestion logic to
   `IngestService`.
3. **Services never touch Fastify request/reply.** A service receives plain arguments (and, when
   it needs persistence, an `EntityManager`) and returns plain results or throws typed errors. It
   must not import `FastifyRequest`/`FastifyReply` or reach for `reply.send`. Canonical example:
   `IngestService` (`src/modules/ingest/service.ts`) — its JSDoc explicitly states it "never
   accesses Fastify request/reply objects directly."
4. **Persistence goes through the per-request EntityManager.** Data access uses the
   request-forked `request.em` — **never `fastify.orm.em`** (the root EM). MikroORM is the
   repository layer; see [§Code Conventions → MikroORM usage](#code-conventions) for the
   repository-pattern detail.
5. **Entities are leaves.** An entity under `src/entities/` may import another entity (for a
   relation — e.g. `TestRun.ts` imports `ProjectSchema`) but imports nothing from `modules/`,
   `services/`, routes, or `app.ts`. Entities are the bottom of the chain.
6. **No layer-skipping.** A route does not query the EntityManager for business decisions that
   belong in a service; a service does not render a template; a template does not run a query.
   Skipping a layer is a `block`-severity drift in an A audit.

### Module boundaries and shared seams

- **Feature modules live under `src/modules/<name>/`.** Each module owns its `routes.ts`,
  `schemas.ts` (the module's Zod schemas), and — when it has non-trivial logic — `service.ts`.
  Current modules: `auth`, `health`, `ingest`.
- **Cross-cutting infrastructure lives under `src/services/` and `src/lib/`.** `src/services/`
  holds long-lived application services (the AI pipeline under `src/services/ai/`, the
  `event-bus.ts`). `src/lib/` holds lower-level reusable utilities (`artifact-storage.ts`,
  `magic-bytes.ts`, `artifact-validation.ts`, the storage implementations).
- **Modules talk through shared seams, not into each other.** A module under `src/modules/X/`
  must not import from `src/modules/Y/`. Shared behavior is reached through `src/services/*`,
  `src/lib/*`, or `src/entities/*`. The EventBus (`src/services/event-bus.ts`) is the canonical
  decoupling seam — e.g. `ingest` publishes `run.ingested` and the AI pipeline subscribes,
  without either importing the other's module directory.
- **`buildApp()` is the composition root.** `src/app.ts` is the one place that wires modules,
  services, plugins, and DI seams together. It imports from every layer; nothing imports from it
  except `src/index.ts` (the process entry point).

### Ratified convention

- **No dedicated repository classes (André adjudicated 2026-05-19 — ratified, not drift).** The
  layer chain above names a "repository" layer; the codebase fills that layer with the MikroORM
  `EntityManager` directly — services call `em.find`/`em.persist` rather than going through
  `FooRepository` classes. This is consistent across the codebase and is the **intended
  convention**: persistence is encapsulated behind the service layer, accessed via the
  per-request `EntityManager`; dedicated repository classes are optional and should be
  introduced only when query logic is reused across services. A treats a service calling
  `request.em` directly as **conformant**, and flags as drift only a *route* or *template*
  querying the EM directly. (The "route → handler → service → repository → entity" wording in
  `auditarchitecture.md` describes the layer *roles*; the `EntityManager` is the repository
  role's implementation.)

---

## Code Conventions

> **[descriptive-from-code]** — captured from the majority pattern in `src/` as of 2026-05-19,
> cross-referenced with `skills/fastify-route-convention.md`, `skills/zod-schema-first.md`, and
> `skills/mikroorm-dual-dialect.md` **[derived-from-docs]**. This section is A's yardstick for
> the **naming**, **file structure**, **pattern consistency**, and **abstraction-level** audit
> dimensions. Each convention cites at least one canonical example file.

### Naming

| Kind | Convention | Canonical example |
|---|---|---|
| Source files | `kebab-case.ts` for utilities/services; `routes.ts` / `service.ts` / `schemas.ts` are fixed names inside a module | `src/lib/artifact-validation.ts`, `src/modules/ingest/service.ts` |
| Entity files | `PascalCase.ts`, one entity per file, file name == entity name | `src/entities/TestRun.ts` |
| Classes | `PascalCase`; service classes end in `Service` | `IngestService` (`src/modules/ingest/service.ts`) |
| Route registration fns | Canonical: default-exported `FastifyPluginAsync`. Variant (to be normalized — see below): named `register<Module>Routes` export | `ingestPlugin` default export (`src/modules/ingest/routes.ts`); `registerAuthRoutes` variant (`src/modules/auth/routes.ts`) |
| Functions / variables | `camelCase` | `categorizeRun`, `parseMaxJsonSize` |
| Constants | `UPPER_SNAKE_CASE` for module-level fixed values | `CHUNK_SIZE = 500` (`src/modules/ingest/service.ts`) |
| Zod schemas | `PascalCase` ending in `Schema`; derived type via `z.infer<>` | `CtrfReportSchema` → `type CtrfReport` (`src/modules/ingest/schemas.ts`) |
| MikroORM config | `mikro-orm.config.<dialect>.ts` | `mikro-orm.config.pg.ts`, `mikro-orm.config.sqlite.ts` |

> **Canonical shape (André adjudicated 2026-05-19).** The **canonical route-registration shape
> is a default-exported `FastifyPluginAsync`** (`ingest`). The named `register<Module>Routes`
> function form (`auth` — `registerAuthRoutes`) is a tolerated **variant, to be normalized to
> the canonical shape when AUTH-002 next touches the auth module**. Until then A treats both as
> conformant and flags only a route file that uses *neither* (e.g. a bare `setupRoutes` with no
> plugin encapsulation); both idioms appear in `skills/fastify-route-convention.md`.

### File organization within `src/`

```
src/
  app.ts                  — buildApp() composition root (the only wiring file)
  index.ts                — process entry point; calls buildApp(), listens
  auth.ts                 — buildAuth() — Better Auth instance factory
  types.ts                — shared app-level types (AppOptions DI seams)
  mikro-orm.config*.ts     — per-dialect ORM config
  modules/<name>/          — feature modules: routes.ts, schemas.ts, service.ts
  services/                — long-lived app services (ai/, event-bus.ts)
  lib/                     — lower-level reusable utilities
  entities/                — MikroORM entities (PascalCase, + index.ts barrel)
  views/                   — Eta templates: layouts/, pages/, partials/
  client/                  — browser-side JS (htmx-events.ts constants, etc.)
  assets/                  — vendored client assets + Tailwind input.css
  __tests__/               — tests (owned by Test-writer; F never edits)
```

- **Barrel files.** A directory with multiple related exports provides an `index.ts` barrel —
  `src/entities/index.ts`, `src/services/ai/pipeline/index.ts`. Import from the barrel, not the
  individual file, when consuming a directory's public surface.
- **One concern per file.** An entity per file; a module's HTTP surface in `routes.ts`, its logic
  in `service.ts`, its schemas in `schemas.ts`.
- **A trivial route may register inline in the composition root.** A module whose HTTP surface
  is a single trivial endpoint — e.g. `health`, whose route is `app.get('/health', …)` in
  `buildApp()` (`src/app.ts`) — may skip its own `routes.ts` and be registered directly in the
  composition root; the `health` module ships only `schemas.ts`. A should not flag a missing
  `routes.ts` for such a module.

### Zod-schema location (resolves N1)

Zod is the single source of truth for runtime validation **and** TypeScript types. Where a schema
lives is determined by its scope:

- **Module-scoped schemas** live in `src/modules/<m>/schemas.ts` — e.g. `CtrfReportSchema` in
  `src/modules/ingest/schemas.ts`, `HealthResponseSchema` in `src/modules/health/schemas.ts`.
- **Schemas are never defined ad-hoc inside a handler.** A route imports its schema from the
  module's `schemas.ts`; it never inlines a `z.object({...})` in the handler body. (This is the
  forbidden pattern in `CLAUDE.md` and `skills/zod-schema-first.md`.)
- **TypeScript types are derived, never hand-written.** `type CtrfReport = z.infer<typeof CtrfReportSchema>`
  — no parallel `interface` duplicates a schema's shape.

### Error handling

The codebase surfaces, logs, and swallows errors deliberately:

- **Surfaced to the user as a typed status response.** Routes map outcomes to explicit status
  codes with a structured body `{ error, code }`. Canonical example: `src/modules/ingest/routes.ts`
  returns `401` (`INVALID_API_KEY`), `403`, `404`, `422` (Zod validation failure), `400`. A
  `ZodError` caught in a handler becomes a `422`.
- **Service layer throws typed errors.** A service signals a business failure by throwing a named
  error class (e.g. `ReferenceOnlyError` in `src/modules/ingest/service.ts`); the route layer
  catches it and maps it to a status. Services do not set status codes themselves.
- **Logged via the Fastify logger.** Operational failures are logged through `request.log` /
  `app.log` (Pino) — never `console.*` in application code. The one sanctioned `console.error`
  is the last-resort startup-failure handler in `src/index.ts`, which carries an
  `eslint-disable` comment because it runs before a logger exists.
- **Swallowed only when explicitly safe.** Fire-and-forget paths (e.g. publishing a
  non-blocking `run.ingested` event) may swallow errors, but the decision is commented at the
  call site. Silent `catch {}` blocks with no comment are a `block`-severity drift.

### Route registration

- A route module is a **Fastify plugin**. The **canonical shape is a default-exported
  `FastifyPluginAsync`**; the named `register<Module>Routes(fastify, ...)` async-function form
  is a tolerated variant (`auth` — to be normalized to the canonical shape when AUTH-002 next
  touches the auth module). `buildApp()` registers each.
- Routes use the **ZodTypeProvider** (`@fastify/type-provider-zod`) so request/response schemas
  are validated and typed from Zod. **The one documented exception** is `src/modules/auth/routes.ts`:
  Better Auth owns its own request/response contract, so the `/api/auth/*` catch-all skips the
  ZodTypeProvider and is marked `config: { skipAuth: true }`. That exception is documented in the
  file's header JSDoc — no other route may skip the provider without equivalent justification.
- Per-route auth posture is declared via `config: { skipAuth: true }` for public routes; see
  [§Security → Global auth preHandler](#security).

### MikroORM usage

- **Always fork the EntityManager per request.** Use `request.em` (a per-request fork) for all
  data access. **Never use `fastify.orm.em`** (the root EM) — it is shared and not request-scoped.
- **Single entity definitions, dual dialect.** Entities are defined once with `defineEntity` + `p`
  helpers (`skills/mikroorm-dual-dialect.md`); the dialect (Postgres / SQLite) is selected by
  config at boot. Entities and any raw SQL must work on both dialects — Postgres-only SQL without
  a SQLite equivalent is a forbidden pattern (`CLAUDE.md`).
- **Schema is synced by the schema-generator at boot** (`orm.schema.updateSchema()`), not by
  migration files, for the MVP — see [§Schema sync at boot](#production-deployment) and INFRA-005.
- **No dedicated repository classes — this is the ratified convention, not drift.** Services
  access persistence through the per-request `EntityManager` (`request.em`) directly; dedicated
  `FooRepository` classes are *not* used — they are optional, introduced only when query logic
  is reused across services. A treats a service calling `request.em` directly as **conformant**
  (André adjudicated 2026-05-19); see
  [§Layering → Ratified convention](#layering-and-dependency-direction).

### Transaction boundaries

- **A request handler is the transaction boundary.** MikroORM's per-request EM accumulates a unit
  of work; the work is flushed within the request. A service does not span multiple HTTP requests
  in one transaction.
- **Bulk inserts are chunked.** Large multi-row inserts use the **500-row chunk** pattern with
  event-loop yielding between chunks — `CHUNK_SIZE = 500` in `src/modules/ingest/service.ts`,
  per `skills/ctrf-ingest-validation.md`. This keeps a large CTRF payload from blocking the event
  loop and bounds the size of a single flush.
- **Graceful shutdown waits for in-flight work.** The SIGTERM sequence (see [§Graceful shutdown](#production-deployment))
  lets an in-flight chunked insert finish rather than leaving a partial run in the DB.

### Logging

- **Pino via Fastify** is the only logger. Use `request.log` inside a request, `app.log` outside
  one. No `console.*` in `src/` except the documented pre-logger startup handler in `src/index.ts`.
- Log **operational events and failures**, not request bodies or secrets. The auth subsystem and
  ingest routes log decisions (e.g. invalid API key) without logging the token value.

### Abstraction level

- **Routes are thin, services are where logic lives, lib utilities are stateless.** A route that
  grows business logic, or a `lib/` utility that reaches for the EntityManager, is drift in both
  directions.
- **Match the altitude of your neighbors.** A new file in `src/modules/<m>/` should look like the
  existing module files; a new entity should look like `TestRun.ts`. Over-abstraction (a factory
  for a thing instantiated once) and under-abstraction (business logic inlined in a route) are
  both `warn`-to-`block` drift depending on leverage.
- **`buildApp()` carries the DI seams.** `AppOptions` exposes a small number of optional
  injection points so integration tests can substitute in-memory doubles without mocking. New
  cross-cutting dependencies that tests need to substitute belong on that seam, not as ambient
  module-level singletons.

---

## Operational Invariants

> Each rule below is **normative** and was baked into the codebase by a specific merged PR.
> These are invariants A should treat as established baseline and S should treat as spec when a
> story touches the relevant surface. Each cites its originating PR. **[derived-from-docs]** —
> the rules are derived from the merged PR diffs and PR bodies of #71–#75.

### Asset-pipeline bridging (PR #71)

- **Production serves static assets from `dist/assets/`.** `@fastify/static` is mounted with
  root `dist/assets/` (compiled at runtime from `src/app.ts §5`) and prefix `/assets/`.
- **The build stage MUST copy vendored assets `src/assets/* → dist/assets/`.** The `postinstall`
  hook (`scripts/copy-vendor-assets.mjs`) vendors client JS into `src/assets/`; the Dockerfile
  builder stage runs `cp -r src/assets/. dist/assets/` so production can serve them. Removing or
  reordering this copy is a regression — vendored client JS 404s at runtime without it.
- **The runner stage uses `--ignore-scripts`** on its `npm ci` so the `postinstall` hook does not
  re-fire against the source-free runner image; the vendored assets are already baked into
  `dist/assets/` by the builder.
- **Static assets bypass auth** via the `/assets/*` prefix branch in the global preHandler — see
  [§Security → Global auth preHandler](#security).
- *Cite:* PR #71 (`[ctrfhub-docker-build-fix]`, merge `142fb97`).

### Build-layer caching (PR #72)

- **Warm Docker builds must complete in well under 30 s** (measured 2–3 s with no source change;
  cold ≈ 57–60 s).
- **Both `npm ci` steps use BuildKit `RUN --mount=type=cache,target=/root/.npm`** so npm's
  package cache persists across builds independently of layer invalidation.
- **`scripts/docker-build-cached.sh` is the canonical verification command** (also exposed as
  `npm run docker:build:cached`). It builds with a buildx local cache; an F↔A iteration verifies
  a build change against it rather than re-running a cold `docker build`.
- **`.dockerignore` is kept tight** so the `COPY . .` layer is not invalidated by files unrelated
  to the build.
- *Cite:* PR #72 (`[ctrfhub-docker-build-cache]`, merge `c9f4beb`).

### Orchestrator constraint-override clause (PR #73)

- **The `Constraints` section of a brief is authoritative over a literal reading of the
  acceptance criteria.** When a brief's acceptance criteria, read literally, would conflict with
  its `Constraints` section (or with a binding Argos decision), the Constraints / binding
  decision win. F and A read acceptance criteria *through* the Constraints section, not around it.
- This is part of the orchestrator-autonomy hardening: routine phase-gate routing decisions are
  made autonomously and recorded in `decisions.md` rather than blocking the loop on an
  interactive popup; `escalation.md` is reserved for the exact, exhaustive set of escalation
  conditions defined in `.claude/agents/orchestrator.md`.
- *Cite:* PR #73 (`[orchestrator-autonomy-hardening]`, merge `4240e74`).

### Test-writer sizing (PR #74)

- **One test per distinct branch.** Coverage has a ceiling, not just a floor — a test file should
  have roughly one test per distinct code branch, not a fan-out of near-duplicates.
- **The 401/422/429/413 status matrix is a per-route ceiling, not a per-asset multiplier.** The
  matrix bounds how many status-code tests a *route* gets; it is not multiplied across every
  asset or input variant the route touches.
- **The Test-writer runs a pre-handoff isolation self-check** — confirming each test is
  load-bearing and not a flat duplicate — before handing off.
- The `audit-tests` metric is **tests-per-distinct-branch**, not raw test count.
- *Cite:* PR #74 (`[test-writer-discipline]`, merge `5aa281d`).

### Issue-management workflows (PR #75)

- **New-issue dedupe runs on `issues: opened`.** `dedupe-issues.yml` extracts keywords and runs
  `gh issue list --search` to surface 0–5 candidate prior issues as a comment. The 0-candidate
  path is **silent** — no comment is posted. No LLM/Claude call is made; GitHub search ranking
  does the matching.
- **A daily `actions/stale@v9` sweep** (`stale.yml`, `schedule` + `workflow_dispatch`) labels
  and, after a grace window, closes inactive issues and PRs.
- **Label semantics:** the `stale` label marks the warning state and is created idempotently by
  `sync-labels.yml`; the `pinned` label exempts an issue/PR from the stale sweep.
- Both workflows are **LLM-free** — zero recurring API cost — and are additive to `ci.yml`,
  `pr-review.yml`, `release.yml`.
- *Cite:* PR #75 (`[duplicate-issue-detection]`, merge `76715f2`).

---

## Document Authority and Exception Process

> **[derived-from-docs]** — derived from `CLAUDE.md`, `.claude/agents/architecture-reviewer.md`,
> `docs/orchestrator-workflows/auditarchitecture.md`, and this story's brief
> (`.argos/stories/architecture-augment/brief.md`).

### `architecture.md` is the canonical code/technical-architecture yardstick

This document — `docs/planning/architecture.md` — is **THE authoritative yardstick for the
Architecture Reviewer (A) in audit mode** for everything concerning the *technical and code
architecture* of CTRFHub: the stack, deployment topology, security posture, layering, dependency
direction, code conventions, and operational invariants. When A audits `src/` and needs the
established baseline, this is the document it reads.

### Relationship to `project-architecture.md` (discrepancy resolution)

Two architecture documents exist, and the audit pipeline previously cited them inconsistently.
**The resolution: both documents are kept; they are not duplicates and neither is renamed.** They
are split by *subject*, and this section is the authoritative statement of the split:

| Document | Subject | Audience |
|---|---|---|
| `docs/planning/architecture.md` (this doc) | **Code & technical architecture** — stack, layering, dependency direction, code conventions, security, deployment, operational invariants. | A in audit/review mode; F implementing; S spec-auditing technical conformance. |
| `docs/planning/project-architecture.md` | **Process & workflow architecture** — the multi-session agent workflow, actor roles, session flow, artifact layout, branch/commit/PR conventions, escalation paths. | Argos orchestrating; all agents understanding the loop. |

**Why this resolution (rationale).** The two documents do not overlap in content — one describes
how the *software* is built, the other describes how the *team* builds it. Merging them would
produce a single oversized document mixing two unrelated concerns; renaming either would break
the larger set of inbound citations (`project-architecture.md` is cited by the A role file and
the audit workflow as the *process* baseline, which is correct). The only real defect was a
**citation defect**, not a document defect: `auditarchitecture.md`'s checklist cited
`architecture.md §Layering` (a section that did not exist) and `project-architecture.md §Module
boundaries` (also not a section). This augmentation fixes the citation defect by **adding the
`§Layering and Dependency Direction` section to this document** — which is the correct home for
layering and module-boundary rules, since they are code architecture, not process architecture.

**Consequences for citations:**

- `auditarchitecture.md`'s `architecture.md §Layering` citation **now resolves** — to
  [§Layering and Dependency Direction](#layering-and-dependency-direction). The section's title
  leads with the literal word "Layering" so the anchor matches.
- `auditarchitecture.md`'s `project-architecture.md §Module boundaries` citation **still
  dangles** — `project-architecture.md` has no such section, and module-boundary rules now
  correctly live in *this* document's [§Layering and Dependency Direction](#layering-and-dependency-direction).
  **Open follow-up for André:** when `auditarchitecture.md` is next edited, repoint that citation
  to `docs/planning/architecture.md §Layering and Dependency Direction`. This story is forbidden
  from editing `auditarchitecture.md`, so the repoint is left as a flagged follow-up rather than
  resolved here.
- The A role file (`.claude/agents/architecture-reviewer.md`) instructs A in audit mode to read
  `project-architecture.md` "to understand which patterns are baseline." That instruction is
  **correct and unchanged** — `project-architecture.md` carries the *process* baseline. A reading
  `src/` for *code* baseline should additionally read this document. No change to the A role file
  was required by this story (the role file was not edited).

### The "never modify `docs/planning/*`" rule and its exception process

`CLAUDE.md` states that agents must **never modify `docs/planning/*`** — the planning docs are the
authoritative spec, and unilateral edits would let an implementer redefine the contract they are
being measured against. This rule stands.

**The exception process** — the only sanctioned way `docs/planning/*` is ever modified:

1. **A dedicated story is briefed for the change.** The change to a planning doc is itself the
   story's deliverable — not a side effect of a feature story.
2. **The story's `brief.md` explicitly authorizes the exception.** The brief must (a) name the
   specific planning file(s) the story is allowed to edit, (b) state the authorization in plain
   language ("F is authorized to edit `docs/planning/<file>`"), and (c) scope the edit narrowly —
   F may touch only the named files and only for the stated purpose.
3. **Argos (Orchestrator) issues the brief; André approves it.** The exception is an
   orchestrator-level decision recorded in the brief; André gates the resulting PR with extra
   care, exactly as `CLAUDE.md` directs for spec-adjacent changes.
4. **The PR is reviewed against the brief's narrow scope.** A and S verify the diff did not
   touch any `docs/planning/*` file outside the brief's authorization. A planning-doc edit
   appearing in a diff *without* a brief that authorizes it is a `block`-severity finding.

This very document section is the codification of that process, and this story
(`architecture-augment`) is its first instance: its brief explicitly authorized editing
`docs/planning/architecture.md` (and, narrowly, `docs/planning/project-architecture.md`), and
forbade touching any other planning file. Future exceptions follow the same four steps.

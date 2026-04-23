# CTRFHub Architecture

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
# Edit .env — set SESSION_SECRET and PUBLIC_URL at minimum; choose SQLITE or Postgres dialect

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

### Database migrations (dev)

```bash
# Postgres
docker compose -f compose.dev.yml exec app npm run migrate:pg

# SQLite
docker compose -f compose.dev.yml exec app npm run migrate:sqlite

# Generate a new migration after changing entities
docker compose -f compose.dev.yml exec app npm run migrate:create:pg
docker compose -f compose.dev.yml exec app npm run migrate:create:sqlite
```

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
  - npm ci
  - npx tsc (compile TypeScript → dist/)
  - npx @tailwindcss/cli --minify (generate dist/assets/tailwind.css)

Stage 2 — runner
  FROM node:22-alpine
  - Copy dist/ and node_modules/
  - No source files, no dev dependencies
  - CMD ["node", "dist/index.js"]
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SESSION_SECRET` | ✅ | — | Min 32-char random string; signs session cookies |
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

### Migrations in production

Migrations run automatically at container startup, but **only in the `api` container** (`dist/server.js`). The `worker` container (`dist/worker.js`) must never call `migrator.up()`.

```typescript
// src/server.ts  — api container entrypoint ONLY
const orm = await MikroORM.init(config);
const migrator = orm.getMigrator();
await migrator.up();   // run pending migrations — api entrypoint only
await startServer();

// src/worker.ts  — worker container entrypoint
// ❌ Do NOT call migrator.up() here.
// The worker depends_on the api container being started,
// which guarantees migrations have already run.
await startWorker();
```

**Why this matters:** Both `api` and `worker` start from the same image. If both called `migrator.up()` simultaneously, they would race to acquire MikroORM's advisory lock on the `mikro_orm_migrations` table. The race itself is safe (PostgreSQL advisory lock prevents double-execution), but the losing container will block at startup and may time out before the lock is released on very large migration sets.

For HA multi-instance deployments (multiple `api` replicas), run migrations as a dedicated one-shot init container before starting the app containers.

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

`GET /health` — unauthenticated. Readiness-shaped: returns 200 **only after the `api` process has completed boot** (including database migrations). Used by Docker compose `healthcheck`, upstream load balancers, and Kubernetes probes to decide whether to route traffic to this instance.

The process tracks a `bootState` value that transitions through: `booting → migrating → ready`. If migrations fail, `bootState` moves to `failed` and the process exits non-zero so the orchestrator restarts it.

**Response shape:**

```json
{ "status": "ok", "db": "ok", "bootState": "ready", "version": "1.0.0", "uptime": 3600 }
```

**Status codes:**

| `bootState` | HTTP | `status` | Notes |
|---|---|---|---|
| `booting` | 503 | `booting` | Process started; migrations haven't begun yet (rare, narrow window) |
| `migrating` | 503 | `migrating` | `migrator.up()` is running; **must return 503** to prevent LBs routing traffic to a DB undergoing DDL |
| `ready` | 200 | `ok` | Migrations complete, DB reachable, Redis reachable (if configured) |
| `ready` but DB unreachable | 503 | `error` | Pool exhaustion or connectivity failure after successful boot |

**Checks performed (only in `ready` state):**
- **DB:** `SELECT 1` — catches pool exhaustion and connectivity failures
- **Redis:** ping, only when `EVENT_BUS=redis`
- **Artifact storage:** not checked (adds latency; disk/S3 failures surface via ingest errors instead)

**Why readiness, not liveness:** A separate `GET /livez` (returns 200 whenever the process is running, ignoring DB and migrations) can be added later if k8s deployments need to distinguish "kill this pod" from "don't route to this pod". For MVP, single-container deployments don't benefit from the distinction — the Docker healthcheck behaviour we need is readiness (route to me when ready).

**Migration race window (why this contract matters):** If `/health` returned 200 before migrations finished, a load balancer could route traffic to an instance whose schema doesn't match the application's expectations, producing 500s on every request until migrations complete. The compose `start_period: 30s` is a fallback, not a guarantee — migrations on a large DB or a cold Postgres can exceed 30s. The 503-during-migration contract is the real guarantee.

**Worker startup (note on `depends_on: service_healthy`):** `deployment-architecture.md` uses `depends_on: { api: { condition: service_healthy } }` on the `worker` container specifically to guarantee migrations have completed before the worker boots. That `depends_on` clause is load-bearing — it is the only reason the worker can safely assume migrations are applied.

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

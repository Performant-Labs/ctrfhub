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
| **Rate limiting** | `@fastify/rate-limit` (keyed on `x-api-token` value for ingest routes; per-IP for UI routes; 300 req/min per user for artifact serving) |
| **Security headers** | `@fastify/helmet` — CSP, HSTS, X-Content-Type-Options, X-Frame-Options |
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

---

## AI Features

| Concern | Choice |
|---|---|
| **Failure categorization** | OpenAI / Groq / Anthropic SDK (configured via env) |
| **Model** | Provider-agnostic; controlled by `AI_PROVIDER` + `AI_MODEL` env vars |

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

---

## Security

### CSRF protection

HTMX makes all requests via XHR/fetch — not HTML form navigation. Browsers enforce `SameSite=Lax` on XHR/fetch: **the session cookie is not sent on cross-origin requests**. A malicious page on `evil.com` that attempts to POST to a CTRFHub instance cannot attach the session cookie; the attack fails at the browser before reaching the server.

**No explicit CSRF token is required.** Better Auth issues `SameSite=Lax` cookies by default. This setting must not be changed to `SameSite=None`.

---

### Content Security Policy (CSP)

Set via `@fastify/helmet`. The MVP policy is permissive but meaningful — it constrains frame sources and connection targets while allowing `unsafe-inline` for Alpine.js.

**Why `unsafe-inline` is required:** Alpine.js evaluates `x-data` and `x-on:*` attribute values as JavaScript expressions at runtime. A nonce-based strict CSP that eliminates `unsafe-inline` is achievable but requires per-request nonce injection; this is deferred to post-MVP.

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

Playwright HTML report iframes are served from the same origin (`/runs/:id/report/`) and rendered with `sandbox="allow-scripts allow-same-origin"` to prevent report content from accessing the parent frame's DOM or cookies.

---

### Artifact file serving — rate limit

`GET /api/files/*` is rate-limited to **300 req/min per authenticated session user** via `@fastify/rate-limit`. This applies only when `ARTIFACT_STORAGE=local`. S3/MinIO pre-signed URLs are single-use with a 1-hour expiry and cannot be replayed; no rate limit is required for them.

---

### Health endpoint

`GET /health` — unauthenticated. Returns:

```json
{ "status": "ok", "db": "ok", "version": "1.0.0", "uptime": 3600 }
```

Checks performed:
- **DB:** `SELECT 1` — catches pool exhaustion and connectivity failures
- **Redis:** ping, only when `EVENT_BUS=redis`
- **Artifact storage:** not checked (adds latency; disk/S3 failures surface via ingest errors instead)

Returns `503 { "status": "error", "db": "error" }` if the DB is unreachable.

Used by: Docker compose `healthcheck` on the `api` container; upstream load balancers; Kubernetes liveness/readiness probes.

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

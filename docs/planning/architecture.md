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
| **Rate limiting** | `@fastify/rate-limit` (keyed on API token hash for `/api/ingest`) |
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
# Edit .env — set BETTER_AUTH_SECRET, choose SQLITE or Postgres dialect

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
| `BETTER_AUTH_SECRET` | ✅ | — | Random 32-byte secret for session signing |
| `BETTER_AUTH_URL` | ✅ | — | Public base URL (e.g. `https://ctrfhub.example.com`) |
| `DATABASE_URL` | Postgres only | — | `postgresql://user:pass@db:5432/ctrfhub` |
| `SQLITE_PATH` | SQLite only | `/data/ctrfhub.db` | Path inside container |
| `RETENTION_DAYS` | ❌ | `90` | Days before old runs are pruned |
| `AI_PROVIDER` | ❌ | — | `openai` / `groq` / `anthropic` |
| `AI_API_KEY` | ❌ | — | API key for the chosen AI provider |
| `AI_MODEL` | ❌ | — | Model name (e.g. `gpt-4o-mini`) |
| `STORAGE_TYPE` | ❌ | `local` | `local` or `s3` |
| `S3_ENDPOINT` | S3 only | — | MinIO or S3 endpoint URL |
| `S3_BUCKET` | S3 only | — | Bucket name for artifacts |
| `S3_ACCESS_KEY` | S3 only | — | |
| `S3_SECRET_KEY` | S3 only | — | |
| `PORT` | ❌ | `3000` | HTTP port the app listens on |

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

Migrations run automatically at container startup before the server begins accepting requests:

```typescript
// src/index.ts
const orm = await MikroORM.init(config);
const migrator = orm.getMigrator();
await migrator.up();   // run pending migrations
await startServer();
```

This is safe for single-instance deployments. For multi-instance deployments, run migrations as a separate init container.

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
    curl -X POST ${{ vars.CTRFHUB_URL }}/api/ingest \
      -H "Authorization: Bearer ${{ secrets.CTRFHUB_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d @ctrf-report.json
```

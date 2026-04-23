# CTRFHub — Deployment Architecture

Covers the self-hosted Docker Compose deployment topology, container responsibilities, volume strategy, networking, and environment configuration.

---

## Container overview

CTRFHub runs as a multi-container Docker Compose application. Responsibilities are split so that no single container is doing too many jobs — in particular, background/cron work never runs inside the API server.

```
┌─────────────────────────────────────────────────────┐
│                     Host machine                    │
│                                                     │
│  ┌──────────┐   ports 80/443                        │
│  │  proxy   │◄──────────────── internet             │
│  │  (Caddy) │                                       │
│  └────┬─────┘                                       │
│       │ internal network                            │
│  ┌────▼─────┐   ┌──────────┐   ┌─────────────────┐ │
│  │   api    │   │  worker  │   │      redis       │ │
│  │ (Fastify)│   │  (cron + │   │  (optional MVP;  │ │
│  │          │   │  future  │   │  required for    │ │
│  └────┬─────┘   │  BullMQ) │   │  scale-out)      │ │
│       │         └────┬─────┘   └──────────────────┘ │
│       │              │                               │
│  ┌────▼──────────────▼──────┐                       │
│  │           db             │                       │
│  │       (PostgreSQL)       │                       │
│  └──────────────────────────┘                       │
└─────────────────────────────────────────────────────┘
```

---

## Services

### `proxy` — Caddy
- Handles TLS termination (automatic HTTPS via Let's Encrypt or ACME)
- Rate limiting: `limit_conn 20` per IP, `limit_req 50/s` burst 20 (per DD-012)
- Long-lived SSE connections: `flush_interval -1` (Caddy streams immediately)
- `X-Accel-Buffering: no` header for SSE routes
- The only container with ports exposed to the host (80, 443)
- All other containers are on the internal bridge network only

**Why Caddy over Nginx:** Automatic HTTPS with zero cert management. Self-hosters who aren't ops engineers benefit significantly. Nginx config is provided as an alternative in `docker/nginx/` for teams that already run Nginx.

### `api` — Fastify application server
- Serves the UI (Eta templates via HTMX)
- REST API (`/api/v1/...`)
- SSE endpoint (`/api/sse/...`)
- CTRF ingest endpoint (`POST /api/v1/projects/:slug/runs`)
- `GET /api/files/*` — local artifact serving; rate-limited to 300 req/min per session user (only active when `ARTIFACT_STORAGE=local`)
- `GET /health` — unauthenticated readiness check for Docker, load balancers, and Kubernetes probes. Returns 503 during boot/migration and 200 once `bootState = ready` (see `architecture.md` → Health endpoint for the full state machine)
- Does **not** run cron jobs or background processing
- Stateless — can be scaled horizontally behind the proxy (with Redis EventBus for SSE)

### `worker` — Background job runner
- Runs the nightly data retention sweep (PL-006)
- Runs scheduled reporting jobs (future)
- Runs BullMQ workers when queue-based ingest is enabled (PL-003 scale-out)
- Shares the same codebase as `api` but with a different entrypoint: `node dist/worker.js`
- Separate container ensures a slow retention sweep never delays API response times
- **Does NOT run database migrations** — only the `api` entrypoint calls `migrator.up()`. Worker startup assumes migrations have already been applied.

### `db` — PostgreSQL
- All application data
- Data directory on a **named Docker volume** (`db_data`) — never a bind mount in production
- Not exposed to host network; accessible only from `api` and `worker` on the internal network

### `redis` *(optional for MVP, required for scale-out)*
- EventBus Pub/Sub for multi-node SSE delivery (PL-002)
- BullMQ job queues for async ingest (PL-003 scale-out)
- Session store if/when session persistence across restarts is needed
- Data on a named volume (`redis_data`) with `appendonly yes` persistence
- For MVP (single node), `EVENT_BUS=memory` and Redis is not started

---

## Volume strategy

All persistent data lives on **named Docker volumes**, never bind-mounted paths. Named volumes are managed by Docker and survive container recreation.

| Volume | Container | Contents | Notes |
|---|---|---|---|
| `db_data` | `db` | PostgreSQL data directory | Most critical — back this up |
| `artifacts_data` | `api`, `worker` | Uploaded test artifacts (screenshots, videos, traces) | Back up alongside db_data; only used when `ARTIFACT_STORAGE=local` |
| `redis_data` | `redis` | Redis AOF persistence | Only needed when Redis is enabled |
| `caddy_data` | `proxy` | TLS certificate cache (Let's Encrypt) | Survives proxy container restarts |
| `caddy_config` | `proxy` | Caddy internal config state | Survives proxy container restarts |

**Backup targets:** `db_data` and `artifacts_data` (when using local storage) both require regular backup. When `ARTIFACT_STORAGE=s3`, artifact files live in the configured S3 bucket and `artifacts_data` is not used.

---

## Docker Compose structure

```yaml
# docker-compose.yml (abridged — full file in docker/docker-compose.yml)

services:
  proxy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - api

  api:
    build: .
    entrypoint: ["node", "dist/server.js"]
    environment:
      - DATABASE_URL
      - SESSION_SECRET
      - EVENT_BUS           # memory | redis
      - REDIS_URL           # required when EVENT_BUS=redis
      - MAX_CTRF_JSON_SIZE       # default: 10mb (PL-003) — caps the `ctrf` JSON field
      - MAX_ARTIFACT_SIZE_PER_RUN # default: 1gb — caps the multipart total (all file parts + JSON)
      - ARTIFACT_STORAGE    # local | s3 (default: local)
      - ARTIFACT_LOCAL_PATH # default: /data/artifacts
      - ARTIFACT_PUBLIC_URL # optional — separate artifact origin for GitHub-grade cookie isolation (DD-028 I2)
      - S3_ENDPOINT         # required when ARTIFACT_STORAGE=s3
      - S3_BUCKET
      - S3_KEY
      - S3_SECRET
      - PORT                # default: 3000
      - DEFAULT_TIMEZONE    # default: UTC (IANA zone fallback — DD-025)
    volumes:
      - artifacts_data:/data/artifacts  # only used when ARTIFACT_STORAGE=local
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      # /health is readiness-shaped: returns 503 while bootState ∈ {booting, migrating}
      # and 200 only when bootState = ready. See architecture.md → Health endpoint.
      # start_period is a fallback; the real migration guarantee is the 503 contract.
      test: ["CMD-SHELL", "wget -qO- http://localhost:$$PORT/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s  # fallback for slow cold-boot Postgres; migrations may exceed this on large DBs

  worker:
    build: .
    entrypoint: ["node", "dist/worker.js"]
    environment:
      - DATABASE_URL
      - EVENT_BUS
      - REDIS_URL
      - ARTIFACT_STORAGE
      - ARTIFACT_LOCAL_PATH
      - S3_ENDPOINT
      - S3_BUCKET
      - S3_KEY
      - S3_SECRET
    volumes:
      - artifacts_data:/data/artifacts  # worker deletes artifact files during retention sweep
    depends_on:
      db:
        condition: service_healthy
      api:
        condition: service_healthy  # guarantees migrations have run before worker boots

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=ctrfhub
      - POSTGRES_USER
      - POSTGRES_PASSWORD
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d ctrfhub"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    profiles:
      - scale-out   # only starts when --profile scale-out is passed

volumes:
  db_data:
  artifacts_data:   # Uploaded test artifacts — only used when ARTIFACT_STORAGE=local
  redis_data:
  caddy_data:
  caddy_config:
```

Redis uses a Docker Compose **profile** (`scale-out`) so it's not started for standard single-node MVP deployments. Running `docker compose --profile scale-out up` enables it automatically.

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✓ | — | PostgreSQL connection string |
| `POSTGRES_USER` | ✓ (db only) | — | DB container only |
| `POSTGRES_PASSWORD` | ✓ (db only) | — | DB container only |
| `SESSION_SECRET` | ✓ | — | Min 32 chars; used to sign session cookies |
| `EVENT_BUS` | | `memory` | `memory` \| `redis` |
| `REDIS_URL` | When `EVENT_BUS=redis` | — | e.g. `redis://redis:6379` |
| `MAX_CTRF_JSON_SIZE` | | `10mb` | Cap on the `ctrf` JSON field within a multipart ingest (enforced by `@fastify/multipart` `fields.limits.fieldSize`). Protects the event loop from large `JSON.parse()` calls — see PL-003. Applies equally to `application/json` (raw body) ingest. |
| `MAX_ARTIFACT_SIZE_PER_RUN` | | `1gb` | Cap on the total size of a single multipart ingest request (JSON + all artifact file parts). Applied as Fastify `bodyLimit` on the ingest route. Per-content-type file limits are configured separately in application code — see `database-design.md` §artifact-ingest. |
| `ARTIFACT_STORAGE` | | `local` | `local` \| `s3` |
| `ARTIFACT_LOCAL_PATH` | | `/data/artifacts` | Root path for local artifact storage |
| `S3_ENDPOINT` | When `ARTIFACT_STORAGE=s3` | — | e.g. `https://s3.amazonaws.com` or MinIO URL |
| `S3_BUCKET` | When `ARTIFACT_STORAGE=s3` | — | Bucket name |
| `S3_KEY` | When `ARTIFACT_STORAGE=s3` | — | Access key ID |
| `S3_SECRET` | When `ARTIFACT_STORAGE=s3` | — | Secret access key |
| `ARTIFACT_CORS_ORIGINS` | | `https://trace.playwright.dev` | Comma-separated list of origins allowed to fetch artifact URLs cross-origin. Required so the Playwright Trace Viewer can load zips from CTRFHub. Applied via `@fastify/cors` on the local artifact route; operators running `ARTIFACT_STORAGE=s3` must mirror this list into the bucket's CORS configuration (script: `scripts/apply-s3-cors.sh`). See `database-design.md` → Playwright artifact handling → CORS requirements. |
| `ARTIFACT_PUBLIC_URL` | | (unset) | Optional separate origin for serving user-uploaded artifacts (DD-028 I2). When set (e.g. `https://artifacts.ctrfhub.example.com`), the app rewrites rendered artifact URLs to point at that origin and emits `Cross-Origin-Resource-Policy: cross-origin` on artifact responses; operator configures their reverse proxy to route `/api/files/*` and `/runs/*/report/` on that subdomain back to the CTRFHub backend. Provides GitHub-grade cookie-jar isolation — XSS in artifact content cannot reach the main-app session cookie because the session cookie is domain-scoped to the main origin. When unset, artifacts serve from the main CTRFHub origin with DD-028 I3–I7 as the defence (still robust; the separate origin is an opt-in upgrade). See `docs/ops/artifact-origin.md` for nginx and Caddy snippets. |
| `AI_PROVIDER` | | — | `openai` \| `anthropic` \| `groq`. When unset, all AI features are hidden. |
| `AI_API_KEY` | When `AI_PROVIDER` is set | — | Provider API key |
| `AI_MODEL` | | Provider-specific default | Override default model (e.g. `gpt-4o-mini`) |
| `AI_CLOUD_PIPELINE` | | `off` | `off` \| `on`. When `off`, no managed-provider calls are made even if `AI_PROVIDER` / `AI_API_KEY` are set — infrastructure-level kill switch for regulated deployments. When `on`, an org admin must still ack the per-org consent dialog before any calls occur. See `ai-features.md` → Privacy and consent. |
| `ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` | | `false` | When `true`, outbound webhooks (DD-018) may target private IP ranges (RFC 1918, loopback, link-local). Off by default to block SSRF; enable only if a self-hoster routes webhooks through an internal proxy. |
| `ALLOW_INSECURE_WEBHOOK_DESTINATIONS` | | `false` | When `true`, outbound webhooks may use `http://` URLs. Intended for local development only. |
| `PUBLIC_URL` | | — | Canonical public URL of this CTRFHub instance (e.g. `https://ctrfhub.example.com`). Used to construct run-detail URLs in outbound webhook payloads. When unset, the `url` field is omitted rather than emitted as `localhost`. |
| `PORT` | | `3000` | Internal Fastify port (proxy forwards to this) |
| `LOG_LEVEL` | | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DEFAULT_TIMEZONE` | | `UTC` | IANA zone identifier (e.g. `America/Los_Angeles`, `Europe/Berlin`). Fallback when neither `users.settings.timezone` nor `organizations.settings.default_timezone` is set. See DD-025 for the full hierarchy (user > org > env > UTC) and the "which surface renders in which TZ" table. Only IANA names accepted; abbreviations like `PST` / `IST` rejected at boot. |
| `RETENTION_CRON_SCHEDULE` | | `0 3 * * *` | Cron expression for nightly retention sweep. Defaults to 03:00 UTC — the cron's trigger time is UTC regardless of `DEFAULT_TIMEZONE` (no DST transitions in UTC means the cron fires exactly once per day year-round). The cron's *cutoff calculation* resolves in org TZ per DD-025 — orthogonal to trigger time. |

---

## Internal networking

All containers share a single internal bridge network (`ctrfhub_internal`). Only `proxy` has host-exposed ports. `db` and `redis` are not reachable from outside the Docker network — no port mappings.

For development, `db` exposes port `5432` to the host via an override in `docker-compose.override.yml` (not checked in — generated during dev setup) so that database GUI clients (TablePlus, etc.) can connect.

---

## SQLite deployment (single-user / solo dev)

For Persona 3 (the solo developer on a cheap VPS), CTRFHub can run without PostgreSQL. The database is a SQLite file on a named Docker volume.

### Container topology

```
┌─────────────────────────────────────────┐
│               compose.sqlite.yml         │
│                                          │
│  proxy (Caddy)                           │
│  └── TLS + reverse proxy to api:3000    │
│                                          │
│  api (Fastify + SQLite)                  │
│  ├── Serves UI + REST API               │
│  ├── CTRF ingest                        │
│  ├── Nightly retention cron (in-process) │
│  └── sqlite_data volume (the DB file)   │
└─────────────────────────────────────────┘
```

No `db` container. No `worker` container. No `redis`.

```bash
docker compose -f compose.sqlite.yml up -d
```

### Why no separate worker container for SQLite

SQLite supports only one concurrent writer. If the `worker` container (retention sweep) and the `api` container (CTRF ingest) both attempt to write simultaneously, SQLite serialises them via a file lock — a long retention sweep can block ingest for seconds. WAL mode reduces this but does not eliminate write contention.

**For SQLite deployments the nightly retention cron runs inside the `api` process** using `node-cron`. Because there is only one process writing to the database, there is no contention. The cron is registered as a Fastify lifecycle hook during startup and respects the same `RETENTION_CRON_SCHEDULE` env var.

The separate `worker` container is a **PostgreSQL-only concern**. PostgreSQL handles concurrent writers correctly and benefits from process isolation (slow retention sweep never delays API responses).

### SQLite volumes

| Volume | Contents |
|---|---|
| `sqlite_data` | SQLite database file (`ctrfhub.db`) |
| `artifacts_data` | Uploaded artifacts (when `ARTIFACT_STORAGE=local`) |
| `caddy_data` | TLS certificates |
| `caddy_config` | Caddy config state |

### SQLite limitations

- Single-user or very small teams only (< 5 concurrent users)
- Not suitable at scale — see "When to graduate to PostgreSQL" below for the threshold and signals
- No horizontal scaling — SQLite is single-file, single-process
- Migrations still run automatically at `api` startup (same as PostgreSQL)

### SQLite writer contention with the AI pipeline

The AI pipeline (DD-017) adds a new class of write traffic on top of CTRF ingest: short reservation updates on `ai_pipeline_log`, 15-second heartbeat updates while a stage is running, and per-result category writes back to `test_results` from A1. On SQLite these all contend for the single writer lock together with ingest and UI writes. WAL mode (enabled by default) lets readers proceed during writes but does not lift the one-writer-at-a-time rule.

**Per-run write budget (estimated):**

| Source | Writes per run | Shape |
|---|---|---|
| CTRF ingest | 1 + N (N = result count, up to 500 chunked) | One transaction per chunk |
| A1 categorize — reservation, heartbeat, commit | ~3 + N/20 | Short single-row updates + N/20 chunked batches for per-result updates |
| A2 correlate — reservation, heartbeat, commit + 1 JSONB write to `test_runs` | ~4 | Small single-row updates |
| A3 summarize — reservation, heartbeat, commit + 1 text write to `test_runs` | ~4 | Small single-row updates |
| A4 anomaly — reservation, heartbeat, commit + 0–K inserts into `ai_anomalies` | ~3 + K | Small inserts |
| Sweeper (every 60s) | ~0–2 | Usually no-op; short updates |

For a representative run with 100 results the total write count is ~115 statements across ~30 seconds of wall time. Most are single-row updates that finish in <5ms on WAL-mode SQLite on modest hardware. The heartbeat cadence (15s × up to 4 stages sequentially) adds ~2–4 writes/minute per in-flight run — comfortably below any contention threshold.

**What breaks first under load:**

1. **Concurrent ingest bursts.** Ten CI jobs finishing at the same second each producing a 500-result upload will serialise on the SQLite writer lock. p99 ingest latency climbs from <500ms to several seconds.
2. **A1 per-result update fan-out.** For a 500-failure run, A1 writes ~25 chunked UPDATEs back to `test_results`. If two such runs are processing in parallel their A1 batches interleave and block ingest writes.
3. **UI writes colliding with the above.** Comments, assignments, and category overrides from several users feel laggy during ingest bursts.

The heartbeat / sweeper traffic from DD-017 is not what breaks first — it is small, single-row, and naturally spread across seconds.

### When to graduate to PostgreSQL

SQLite is the right choice when **all** of these hold:

| Signal | SQLite ceiling |
|---|---|
| CI runs ingested per day | ≤ 200 runs/day |
| Peak concurrent ingests (within any 60s window) | ≤ 3 |
| Concurrent active users (UI writes) | ≤ 5 |
| Average results per run | ≤ 500 |
| Concurrent AI pipeline runs in-flight | ≤ 5 |

Graduate to PostgreSQL when any of these hold, or when one of these observable signals appears for > 24 hours:

- p99 ingest latency (`POST /api/v1/projects/:slug/runs`) > 2000ms
- `ai_pipeline_log` rows routinely sitting in `pending` with `attempt > 0` (reservation contention: the sweeper is re-enqueuing before a worker got to it)
- `SQLITE_BUSY` errors in the Fastify logs at a rate > 1/min
- Noticeable UI write latency (> 500ms for comment creation or assignment) reported by users

**These numbers are planning estimates, not measurements.** They should be replaced with empirical values once load-testing (`load-testing-strategy.md`) covers the AI pipeline path — currently that scenario is not in scope (see gap-review item #17). The intent here is to give a solo-VPS operator a defensible "you're fine up to here; start planning PG above here" line, not a guaranteed ceiling.

Migration path: a one-time `sqlite3 → pg_dump → psql` export is documented in the operations runbook (to be written). No schema changes are required — MikroORM uses the same schema for both drivers.

---

## Horizontal scaling (post-MVP)

To run multiple `api` instances:
1. Switch `EVENT_BUS=redis` and enable the `redis` profile
2. Use a load balancer (the `proxy` layer, or an external LB) with sticky sessions OR configure session storage in Redis
3. The `worker` container should remain a **single instance** — multiple workers running the retention cron simultaneously would cause duplicate deletes (use a distributed lock via Redis if multi-worker is ever needed)

---

*Last updated: 2026-04-22*

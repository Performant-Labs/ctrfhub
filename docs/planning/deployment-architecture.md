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
- Serves the UI (Nunjucks templates via HTMX)
- REST API (`/api/v1/...`)
- SSE endpoint (`/api/sse/...`)
- CTRF ingest endpoint (`POST /api/v1/projects/:slug/runs`)
- Does **not** run cron jobs or background processing
- Stateless — can be scaled horizontally behind the proxy (with Redis EventBus for SSE)

### `worker` — Background job runner
- Runs the nightly data retention sweep (PL-006)
- Runs scheduled reporting jobs (future)
- Runs BullMQ workers when queue-based ingest is enabled (PL-003 scale-out)
- Shares the same codebase as `api` but with a different entrypoint: `node dist/worker.js`
- Separate container ensures a slow retention sweep never delays API response times

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
| `redis_data` | `redis` | Redis AOF persistence | Only needed when Redis is enabled |
| `caddy_data` | `proxy` | TLS certificate cache (Let's Encrypt) | Survives proxy container restarts |
| `caddy_config` | `proxy` | Caddy internal config state | Survives proxy container restarts |

**Backup target:** `db_data` is the only volume that requires regular backup. A `pg_dump` cron job (separate from the application cron) should run daily and write to external storage. This is the self-hoster's responsibility; CTRFHub should document it clearly but not implement it (it's too environment-specific).

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
      - MAX_PAYLOAD_SIZE    # default: 10mb (PL-003)
      - PORT                # default: 3000
    depends_on:
      db:
        condition: service_healthy

  worker:
    build: .
    entrypoint: ["node", "dist/worker.js"]
    environment:
      - DATABASE_URL
      - EVENT_BUS
      - REDIS_URL
    depends_on:
      db:
        condition: service_healthy

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
| `MAX_PAYLOAD_SIZE` | | `10mb` | CTRF ingest body size limit (PL-003) |
| `PORT` | | `3000` | Internal Fastify port (proxy forwards to this) |
| `LOG_LEVEL` | | `info` | `debug` \| `info` \| `warn` \| `error` |
| `RETENTION_CRON_SCHEDULE` | | `0 2 * * *` | Cron expression for nightly retention sweep (2am) |

---

## Internal networking

All containers share a single internal bridge network (`ctrfhub_internal`). Only `proxy` has host-exposed ports. `db` and `redis` are not reachable from outside the Docker network — no port mappings.

For development, `db` exposes port `5432` to the host via an override in `docker-compose.override.yml` (not checked in — generated during dev setup) so that database GUI clients (TablePlus, etc.) can connect.

---

## Horizontal scaling (post-MVP)

To run multiple `api` instances:
1. Switch `EVENT_BUS=redis` and enable the `redis` profile
2. Use a load balancer (the `proxy` layer, or an external LB) with sticky sessions OR configure session storage in Redis
3. The `worker` container should remain a **single instance** — multiple workers running the retention cron simultaneously would cause duplicate deletes (use a distributed lock via Redis if multi-worker is ever needed)

---

*Last updated: 2026-04-22*

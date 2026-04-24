# Docker Compose Conventions

> Applies to: all self-hosted Performant Labs applications (CTRFHub, OpenCloud, etc.)

---

## Core Principles

- **Separate container per responsibility** — API server, background worker, proxy, database. Never run cron jobs inside the API server.
- **Named volumes only** — all persistent data lives on named Docker volumes. Never use bind-mounted host paths for production data.
- **Only the proxy is exposed** — database and cache containers have no host port bindings. Only the reverse proxy container binds ports 80 and 443.
- **Profiles for optional services** — services not needed for single-node MVP (e.g. Redis) use `profiles:` so they are not started by default.

---

## Standard Container Topology

```
┌──────────────────────────────────────────┐
│               Host machine               │
│                                          │
│  ┌──────────┐  ports 80/443             │
│  │  proxy   │◄──────────── internet     │
│  │  (Caddy) │                           │
│  └────┬─────┘                           │
│       │ internal network                │
│  ┌────▼─────┐  ┌──────────┐            │
│  │   api    │  │  worker  │            │
│  │(Fastify) │  │  (cron / │            │
│  └────┬─────┘  │  BullMQ) │            │
│       │        └────┬─────┘            │
│  ┌────▼─────────────▼──┐  ┌─────────┐ │
│  │         db          │  │  redis  │ │
│  │    (PostgreSQL)      │  │(profile)│ │
│  └─────────────────────┘  └─────────┘ │
└──────────────────────────────────────────┘
```

| Container | Image | Exposes to host | Notes |
|---|---|---|---|
| `proxy` | `caddy:2-alpine` | 80, 443 | TLS termination, rate limiting |
| `api` | app image | none | Fastify HTTP server |
| `worker` | app image (different entrypoint) | none | Cron, BullMQ workers |
| `db` | `postgres:16-alpine` | none (dev override only) | Named volume for data |
| `redis` | `redis:7-alpine` | none | Optional; `scale-out` profile |

---

## docker-compose.yml Pattern

```yaml
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
    restart: unless-stopped

  api:
    build: .
    entrypoint: ["node", "dist/server.js"]
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  worker:
    build: .
    entrypoint: ["node", "dist/worker.js"]   # Different entrypoint, same image
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    env_file: .env                            # POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
    volumes:
      - db_data:/var/lib/postgresql/data      # Named volume — never bind-mount
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    profiles:
      - scale-out                              # Only starts with: docker compose --profile scale-out up
    restart: unless-stopped

volumes:
  db_data:        # PostgreSQL data — back this up
  redis_data:     # Redis AOF persistence
  caddy_data:     # TLS certificate cache (Let's Encrypt)
  caddy_config:   # Caddy internal config state
```

---

## Volume Strategy

| Volume | Container | Contents | Backup required? |
|---|---|---|---|
| `db_data` | `db` | PostgreSQL data directory | ✓ Critical — back up daily |
| `redis_data` | `redis` | Redis AOF persistence | Optional (recoverable from DB) |
| `caddy_data` | `proxy` | TLS certificate cache | No — auto-renewed by Caddy |
| `caddy_config` | `proxy` | Caddy internal state | No |

**Never** bind-mount the database data directory (`/var/lib/postgresql/data`) to a host path in production. Use only named volumes — they are managed by Docker and survive container recreation cleanly.

---

## Dev Override Pattern

Provide a `docker-compose.override.yml.example` that developers copy locally (not committed):

```yaml
# docker-compose.override.yml — local dev only, do not commit
services:
  db:
    ports:
      - "5432:5432"    # Expose DB port for TablePlus, psql, etc.

  proxy:
    # In dev, skip TLS — use http://localhost directly
    volumes:
      - ./docker/caddy/Caddyfile.dev:/etc/caddy/Caddyfile:ro
```

The `.gitignore` must include `docker-compose.override.yml` (but not `docker-compose.override.yml.example`).

---

## Worker Container Rules

- The `worker` container uses the **same Docker image** as `api` with a different `entrypoint`.
- Run only **one instance** of the `worker` container. Multiple concurrent workers running the same cron job (e.g. data retention sweep) will cause duplicate operations unless a distributed lock (Redis `SETNX`) is implemented.
- Build the worker entrypoint as a separate compiled file (`dist/worker.js`) that imports and runs only the job scheduler — not the HTTP server.

---

## Caddy Configuration

```
# docker/caddy/Caddyfile
{
    # Global options
}

your-domain.com {
    reverse_proxy api:3000 {
        flush_interval -1          # Disable buffering — required for SSE
        header_up X-Real-IP {remote_host}
    }

    # Rate limiting (requires caddy-ratelimit plugin or use Nginx)
    # Alternative: handle in @fastify/rate-limit at the application layer
}
```

Add `X-Accel-Buffering: no` in the Fastify SSE route response headers to disable any upstream buffering for SSE connections.

---

## Enabling Redis / Scale-Out

```bash
# Start with Redis enabled
docker compose --profile scale-out up

# Set in .env
EVENT_BUS=redis
REDIS_URL=redis://redis:6379
```

With `EVENT_BUS=redis`, the Fastify app and worker both connect to Redis for Pub/Sub. Multiple `api` replicas can then receive and deliver SSE events originating from any node.

---

## Common Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| SSE connection drops immediately | Caddy or Nginx buffering the response | Set `flush_interval -1` in Caddyfile; `X-Accel-Buffering: no` in Fastify headers |
| DB healthcheck fails on first start | PostgreSQL still initialising | The `condition: service_healthy` with retries handles this; don't remove it |
| Data lost after `docker compose down` | Used `--volumes` flag or bind-mounted data dir | Never use `docker compose down -v` in production; use named volumes only |
| Worker runs duplicate jobs | Multiple `worker` replicas started | Keep worker at 1 replica unless distributed locking is implemented |
| Redis not starting | Profile not specified | Run with `--profile scale-out` or remove profile for always-on |
| Port 5432 not reachable in prod | No host port binding (intentional) | Use `docker compose.override.yml` locally; never expose DB in production |

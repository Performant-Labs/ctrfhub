# Feature Handoff — CI-002: Docker Compose files (dev + prod + SQLite)

**Branch:** `story/CI-002`
**Commits on this branch since `main`:**
- d053555 chore(CI-002): assign
- (pending) feat(CI-002): Docker Compose files + .env.example + Dockerfile.dev

## What was built

- `.env.example` — Full canonical list of every environment variable from `architecture.md §Environment variables` and `deployment-architecture.md §Environment variables`. Each variable annotated with REQUIRED/OPTIONAL status, default values, and inline documentation. Grouped by concern (Core, Database, Server, Event Bus, AI, Artifacts, Ingest Limits, Retention, Timezone, Webhooks, Tugboat).
- `compose.dev.yml` — Local development stack. App service built from `Dockerfile.dev` with `tsx watch` + Tailwind `--watch` running concurrently. Postgres 16-alpine sidecar with healthcheck. Source volume-mounted for hot-reload. Port 5432 exposed to host for DB GUI clients.
- `compose.yml` — Production-like. Uses `ghcr.io/ctrfhub/ctrfhub:${CTRFHUB_TAG:-latest}` image (does not exist yet — CI-001 will publish). Postgres with named `db_data` volume. `stop_grace_period: 30s`. Healthcheck hits `/health`.
- `compose.sqlite.yml` — Single-container self-host. No Postgres service. SQLite file on `sqlite_data` named volume. `stop_grace_period: 30s`. Healthcheck hits `/health`.
- `Dockerfile.dev` — Minimal dev-only image based on `node:22-alpine`. Installs build deps for `better-sqlite3` native addon. Runs `tsx watch` + `@tailwindcss/cli --watch` concurrently via shell entrypoint.

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `docker compose -f compose.dev.yml config` — VALID (exits 0)
- `docker compose -f compose.yml config` (with required env vars set) — VALID (exits 0)
- `docker compose -f compose.sqlite.yml config` (with required env vars set) — VALID (exits 0)
- `docker compose -f compose.dev.yml up --build -d` — Both containers started successfully. App connected to Postgres, attempted migrations. **Migration failed with `TableNotFoundException: relation "organization" does not exist`** — this is a pre-existing migration ordering issue from INFRA-004 (PG migrations reference `organization` table in a FK before it's created), not a compose issue. The compose infrastructure itself is working correctly: image built, container started, Postgres healthcheck passed, app connected to DB and ran `tsx watch`.
- `docker compose -f compose.dev.yml down -v` — Clean teardown, all containers/volumes removed.

## Files created or modified

- `.env.example` — Overwritten with full canonical env var list (was a placeholder from INFRA-001)
- `compose.dev.yml` — New, development Docker Compose stack
- `compose.yml` — New, production Docker Compose stack
- `compose.sqlite.yml` — New, SQLite single-container stack
- `Dockerfile.dev` — New, minimal dev-only Dockerfile

## Decisions not covered by planning docs

- **`Dockerfile.dev` created instead of using raw `node:22-alpine` with inline `command:`.** The dev workflow requires both `tsx watch` AND `tailwind --watch` to run concurrently, plus `better-sqlite3` needs native build tools (`python3`, `make`, `g++`). A Dockerfile.dev is cleaner than embedding all that in the compose file's command/entrypoint. This adjoins the brief's optional provision for `Dockerfile.dev` (line 71).
- **`CTRFHUB_TAG` variable added to compose.yml and compose.sqlite.yml.** Allows deployers to pin a specific image tag (e.g. `CTRFHUB_TAG=v1.2.3`). Defaults to `latest`. Not in the planning docs but standard Docker practice. Deployers need this to pin versions.
- **`${VAR:?message}` syntax used for truly required vars in compose.yml and compose.sqlite.yml** (SESSION_SECRET, PUBLIC_URL, DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD). Docker Compose will refuse to start with a clear error message if these are missing. Dev compose uses default fallbacks instead for convenience.
- **No proxy service in any compose file.** The deployment-architecture.md shows Caddy as a proxy service, but the brief's acceptance criteria don't mention it, and the Caddy config files don't exist yet. Adding it would be scope creep. Deployers add their own reverse proxy.

## Known issues / follow-ups

- **PG migration ordering bug.** The PG migrations from INFRA-004 fail on a fresh Postgres DB with `relation "organization" does not exist`. This affects `compose.dev.yml` and `compose.yml` — the app can't boot past the migration step. The compose infrastructure is correct; this is a migration-ordering issue. Whoever fixes this (likely a follow-up on INFRA-004) should re-test `docker compose -f compose.dev.yml up --build`.
- **`compose.sqlite.yml` uses the ghcr.io image** which doesn't exist yet (CI-001). Can't fully test until CI-001 ships. `docker compose config` validates structure.
- NIT: No seeded admin user in dev compose — brief explicitly says AUTH-002 owns this, so the dev experience requires manual `/setup` flow. Once AUTH-002 lands, a dev convenience seed could be added.

## Next action (Test-writer)

No test tiers are required for CI-002 (meta — configuration only). The Orchestrator should proceed directly to spec-audit.

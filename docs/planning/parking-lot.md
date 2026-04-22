# CTRFHub — Parking Lot

Deferred decisions and infrastructure tasks that are not blockers for MVP scaffolding but must be resolved before production release or at the specified milestone.

---

## PL-001 — Docker Compose bundle must include a reference Nginx/Caddy config

**Source:** DD-012
**Milestone:** Before first public release / alpha
**See also:** `deployment-architecture.md`

DD-012 states that a reverse proxy is **required** for all production deployments and that CTRFHub ships a reference config in its Docker Compose bundle. The deployment topology is now documented in `deployment-architecture.md` (Caddy chosen as default; Nginx alternative provided). The actual config files still need to be created.

**What needs to be created:**

- `docker/caddy/Caddyfile` — with rate limiting, SSE flush config, HTTPS
- `docker/nginx/nginx.conf` — alternative for Nginx users
- `docker/docker-compose.yml` — full compose file per `deployment-architecture.md`
- `docker/docker-compose.override.yml.example` — dev override (exposes DB port, skips TLS)
- Deployment docs section: "Why a reverse proxy is required"

**Decision: Caddy** (confirmed). Nginx alternative provided in `docker/nginx/` for teams that already run Nginx.

---

## PL-002 — EventBus: implement in-memory version, document Redis Pub/Sub upgrade path

**Source:** DD-011
**Milestone:** Scaffolding (first implementation task)

The `EventBus` interface defined in DD-011 is the first concrete TypeScript interface for the codebase. The in-memory implementation is needed for MVP; the Redis Pub/Sub upgrade path needs to be documented so that horizontal scaling doesn't require rearchitecting.

**What needs to be created:**

- `src/lib/event-bus/types.ts` — the `EventBus` interface
- `src/lib/event-bus/memory-event-bus.ts` — in-memory EventEmitter implementation (MVP)
- `src/lib/event-bus/redis-event-bus.ts` — Redis Pub/Sub implementation (stub with TODO, or full implementation)
- `src/lib/event-bus/index.ts` — factory that selects implementation based on `EVENT_BUS` env var (`memory` | `redis`)

**Interface (from DD-011):**

```typescript
export interface EventBus {
  publish(channel: string, event: string, data: object): Promise<void>;
  subscribe(channel: string, handler: (event: string, data: object) => void): void;
  unsubscribe(channel: string, handler: (event: string, data: object) => void): void;
}
```

**Decision needed:** Should `redis-event-bus.ts` be a full implementation at scaffolding time, or a documented stub? Recommendation: **full implementation** — adding it later when the codebase is larger is significantly more disruptive. `ioredis` is the client library.

---

## PL-003 — Large CTRF ingest payloads: hard limit for MVP, BullMQ queue for scale

**Source:** DD-012 + design discussion
**Milestone:** MVP (limit only); scale-out (queue)

### The problem

`JSON.parse()` is synchronous and CPU-bound. A 10MB CTRF payload blocks the Node.js event loop for ~80ms, which is imperceptible. A 50MB payload blocks for ~500ms, which stalls concurrent UI requests. The event loop cannot serve any other request during that window.

Realistic payload sizes:
- 1,000 tests → ~100 KB (fine)
- 10,000 tests → ~1 MB (fine)
- 100,000 tests → ~10 MB (borderline)
- 500,000 tests → ~50 MB (problematic)

### MVP solution: hard payload limit + chunked DB writes

1. **10 MB hard limit** on the ingest endpoint (`Content-Length` check + `@fastify/multipart` or body size config). Self-hosters can raise this in `config.yaml`. Returns `413 Payload Too Large` with a message explaining how to split large reports.
2. **Chunked bulk inserts**: when writing `test_results` rows, insert in batches of 500 with `setImmediate()` between batches to yield the event loop.

```typescript
// Chunked insert example
for (let i = 0; i < results.length; i += 500) {
  const chunk = results.slice(i, i + 500);
  await em.persistAndFlush(chunk);
  await new Promise(resolve => setImmediate(resolve)); // yield event loop
}
```

### Scale-out solution: BullMQ job queue (deferred)

For installations with >100K tests/run or high-frequency CI pipelines:

1. Ingest endpoint accepts payload, writes it to a BullMQ job, returns `202 Accepted` with a `jobId`.
2. A background worker process does JSON parse + Zod validation + DB write.
3. On completion, worker fires the `run.created` SSE event via the EventBus.
4. Client can poll `GET /api/runs/job/:jobId` for status, or wait for the SSE event.

**Dependencies added:** BullMQ + Redis (Redis is already needed for PL-002 at scale).

**Decision needed:** Is the 10 MB limit acceptable for the initial release, or should BullMQ be implemented from day one? Recommendation: **10 MB limit for MVP** — the queue adds meaningful complexity (worker process, Redis dependency, job status API) that is not justified for the typical self-hosted team of 5–50 engineers running standard CI suites.

---

## PL-004 — Gaffer dialog design pattern to be adopted for all CTRFHub confirmation dialogs

**Source:** Design discussion (Gaffer `dialog_simple.jpg`)
**Milestone:** UI implementation

Gaffer uses a distinctive confirmation dialog pattern: dark background matching app chrome (no white card), bold left-aligned header, subtle divider, muted gray body text with full consequence description, left-aligned buttons with border-only Cancel and solid coral-red destructive CTA. No X close button.

This pattern should be applied consistently to all CTRFHub destructive confirmations:
- Delete project (Danger Zone)
- Delete test run
- Revoke API token
- Remove org member
- Archive project

**What needs to be created:**
- `src/ui/components/confirm-dialog.njk` (or equivalent template) implementing the Gaffer pattern
- CSS for the dialog using theme tokens (`--color-fail` for the destructive CTA, `--color-surface` for background)
- HTMX integration: dialog triggered by `hx-confirm` override or custom `hx-get` + `hx-target="#dialog-root"`

---

## PL-005 — Streaming ingest mode for high-frequency sources (future Business Edition)

**Source:** Design discussion — Option C from ingest flood analysis
**Milestone:** Post-MVP; Business Edition candidate

### Background

`project_tokens.rate_limit_per_hour` (from DD-012 amendment) allows high-frequency sources (IoT devices, embedded hardware-in-the-loop testing) to raise their per-token limit. However, even with an unlimited rate limit, the current CTRF-per-run batch model has architectural tensions at high frequency:

- **Storage explosion**: 1,000 runs/hour × 100 tests = 100,000 `test_results` rows/hour per project
- **UI noise**: the "↑ N new runs" banner becomes meaningless at high frequency
- **Model mismatch**: CTRF's "run" concept is a discrete completed event, not a continuous stream. High-frequency sources map better to a time-series / stream model.

### Proposed solution (deferred)

A separate endpoint `POST /api/v1/projects/:slug/stream` that accepts lightweight single-result payloads and aggregates them server-side into synthetic runs on a configurable time-window basis (e.g., "group all results from this token in any 60-second window into one run"). The SSE `run.created` event fires once per window, not once per result.

This requires:
- A new aggregation pipeline (separate from the standard ingest handler)
- Time-windowing logic (tumbling or sliding window)
- A way to signal "this run is still accumulating" vs "this run is complete"
- Storage strategy for high-volume result streams (possibly a separate hot table with TTL)

### Why deferred

Streaming aggregation is a meaningfully different product feature — closer to observability/telemetry than test reporting. It requires significant design work independent of the core CTRF reporting flow. The configurable `rate_limit_per_hour` on project tokens satisfies the immediate need for teams with moderately elevated ingest rates without committing to a streaming architecture.

---

## PL-006 — Data retention policy: auto-delete old runs on a nightly cron

**Source:** Storage growth analysis; `storage-growth-reference.md`
**Milestone:** MVP — must ship before first public release

### Why it's required

Without a retention policy, `test_results` grows unboundedly. At normal CI velocity (Active team scenario), the database accumulates ~60 GB/month. Self-hosters running large monorepos or device testing will fill modest servers within weeks if unchecked.

### Schema changes (already applied)

- `organizations.retention_days INT NOT NULL DEFAULT 90` — org-level default
- `projects.retention_days INT NULL` — NULL = inherit from org; set to override per project
- `0` = keep forever (explicit opt-out)

### What needs to be implemented

1. **Nightly cron job** (Fastify plugin or separate process) that runs at 02:00 local server time:
   - For each project, determine effective `retention_days` (`project.retention_days ?? org.retention_days`)
   - If `retention_days = 0`, skip
   - `DELETE FROM test_runs WHERE project_id = ? AND created_at < NOW() - INTERVAL '{N} days'` — cascade deletes `test_results`, `test_artifacts`, `test_result_comments`, `custom_field_values`
   - Chunk deletes at 1,000 runs per batch with a 100ms sleep between batches to avoid table locks

2. **Milestone protection** *(Business Edition)*: exclude runs where `milestone_id IS NOT NULL AND milestones.status = 'closed'` from deletion regardless of age.

3. **Settings UI**: `retention_days` field in:
   - Org Settings → General (org default, shown as "Keep runs for N days")
   - Project Settings → General (per-project override, with "Use org default (N days)" as placeholder)
   - Warning displayed when `retention_days = 0` AND any project token has `rate_limit_per_hour = 0`

4. **Audit log entry** *(Business Edition)*: record how many runs were deleted on each retention sweep.

### Decision needed

Should the cron run inside the Fastify process (using `node-cron`) or as a separate process/container in Docker Compose?

**Decision: separate `worker` container** (confirmed — see `deployment-architecture.md`). The worker shares the same Docker image as `api` but uses entrypoint `node dist/worker.js`. This keeps the API server focused on request handling and prevents a slow retention sweep from affecting API response times. The single-worker constraint (do not run multiple worker instances simultaneously without a distributed lock) is documented in `deployment-architecture.md`.

---

## PL-007 — "Full Report" view must render human-readable HTML, not raw JSON

**Source:** Gaffer gap observed in production (2026-04-22)
**Milestone:** MVP — core differentiator, must ship at launch

### The gap

When clicking "Full Report" in Gaffer, the user is shown the raw CTRF JSON payload. There is no rendering — no table, no formatting, no duration bars, nothing. It is a `application/json` dump in a browser tab.

### CTRFHub requirement

The Run Detail page **is** the "Full Report." It must render every CTRF field into a structured, human-readable layout:

| Section | Content |
|---|---|
| Header | Run name, status badge, pass rate progress bar, start time, duration |
| Summary row | Tests / Passed / Failed / Skipped counts with icons |
| Environment | `appName`, `buildName`, `buildNumber`, `commitSha`, `branch` as labeled chips |
| Test results table | Name, status icon, duration (ms), message (for failures/skips) |
| Failure detail | Expandable row showing `message` and `trace` if present |

### Design rules

- Status badges use `--color-pass` / `--color-fail` / `--color-skip` tokens (not hardcoded)
- Duration column rendered as `Xms` or `Xs` depending on magnitude
- Skipped tests shown in a muted style, not hidden
- Page is printable / shareable as a standalone URL (`/runs/:id`)
- No JSON visible anywhere to end users — JSON only accessible via `GET /api/runs/:id` for programmatic consumers

### Why this is a differentiator

Gaffer shows raw JSON. Any tool that ingests CTRF and then surfaces the raw file back to the user has missed the point. The entire value of a test reporting platform is turning machine-generated JSON into something a human can act on in 10 seconds.

---

*Last updated: 2026-04-22*

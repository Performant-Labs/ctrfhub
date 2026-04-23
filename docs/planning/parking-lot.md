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

1. **10 MB hard limit on the CTRF JSON field** (`MAX_CTRF_JSON_SIZE` env var; enforced by `@fastify/multipart` via `fields.limits.fieldSize`). This protects the event loop from `JSON.parse()` stalls and is independent of the multipart total. Applies equally to `application/json` (raw body) ingest. Self-hosters can raise this in `config.yaml`. Returns `413 Payload Too Large` with a message explaining how to split large reports. The multipart total cap (artifacts + JSON combined) is set separately via `MAX_ARTIFACT_SIZE_PER_RUN` (default 1 GB) so that uploading a 100 MB video alongside a 1 MB CTRF JSON is not rejected as "payload too large".
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
- `src/ui/components/confirm-dialog.eta` (or equivalent template) implementing the Gaffer pattern
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

### Decision (resolved)

**PostgreSQL deployments:** Cron runs in the separate `worker` container (`node dist/worker.js`). Process isolation means a slow retention sweep never delays API response times. See `deployment-architecture.md` for the full topology.

**SQLite deployments:** Cron runs inside the `api` process using `node-cron`, registered as a Fastify lifecycle hook. SQLite only supports one concurrent writer; a separate `worker` container would cause write contention. See `deployment-architecture.md` § "SQLite deployment" for details.

Both paths respect the `RETENTION_CRON_SCHEDULE` env var (default: `0 2 * * *`, runs at 2am).

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
| Summary row | Tests / Passed / Failed / Skipped / Blocked counts with icons (Blocked hidden when zero) |
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

## PL-008 — System Status: daily snapshots for growth trending and "time to fill" estimate

**Source:** DD-015 (System Status page)
**Milestone:** Post-MVP

### Why it's deferred

The System status page (DD-015) ships without this. All five sections (System Info, Database, Artifact Storage, Disk Space, Retention Policy) work from live queries and env vars. The missing piece is trend data — "at the current ingestion rate, your disk will fill in approximately X months."

### What needs to be built

**`system_snapshots` table** — one row written by the nightly worker at the same time as the retention sweep:

| Column | Type | Notes |
|---|---|---|
| id | BIGINT | PK |
| snapshot_at | TIMESTAMP | When the snapshot was taken |
| db_total_bytes | BIGINT | `pg_database_size(current_database())` |
| artifacts_total_bytes | BIGINT | `SUM(size_bytes)` from `test_artifacts` |
| disk_total_bytes | BIGINT | From `check-disk-space` |
| disk_free_bytes | BIGINT | From `check-disk-space` |
| total_runs | INT | `COUNT(*)` from `test_runs` |
| total_results | BIGINT | `COUNT(*)` from `test_results` |
| total_artifacts | INT | `COUNT(*)` from `test_artifacts` |

One row per day. 365 rows/year — negligible storage.

**Growth estimate query** (using last 30 days of snapshots):

```sql
SELECT
  (MAX(db_total_bytes + artifacts_total_bytes) -
   MIN(db_total_bytes + artifacts_total_bytes)) / 30.0 AS avg_bytes_per_day,
  MIN(disk_free_bytes) AS current_free_bytes
FROM system_snapshots
WHERE snapshot_at > NOW() - INTERVAL '30 days'
  AND snapshot_at = (SELECT MAX(snapshot_at) FROM system_snapshots WHERE snapshot_at > NOW() - INTERVAL '30 days');
-- days_until_full = current_free_bytes / avg_bytes_per_day
```

**UI addition:** A new "Growth Trend" card on the System page showing a sparkline of daily storage growth over the last 30 days, plus the "~X months until full" estimate. Hidden if fewer than 7 snapshots exist.

---

## PL-009 — Rich integrations: Slack / Teams / Discord / email / PagerDuty / ChatOps

**Source:** DD-018 (ships a generic signed HTTP webhook as the only MVP integration)
**Milestone:** Phase 2 (Slack native, Teams, Discord, email digest); Business Edition (PagerDuty, ChatOps, conditional rules, @mention routing)

### Why it's deferred

MVP ships a generic signed HTTP webhook per project with exactly one event (`run.failed`). That covers every integration need at v1 — users route the webhook to Slack via an incoming-webhook URL, to Teams via a connector URL, to PagerDuty via its Events API, to email via a transformer, to anything else via Zapier or a small serverless function. Native per-vendor adapters are polish: they add nicer formatting (Slack Block Kit, Teams Adaptive Cards) and direct OAuth app installation, but they don't unlock new capability. Shipping them in v1 would mean maintaining four vendor SDKs before we know which ones users actually care about.

### What needs to be built (Phase 2)

**New channel types — per vendor, not per URL.** `project_webhooks.channel_type` ENUM (currently implicit `generic_http`) becomes explicit: `generic_http | slack | teams | discord | email`. Each native type has its own payload formatter that turns the run.failed event into native-shaped content (Slack blocks with run summary, failed test list, AI root cause clusters, deep link).

**Richer event catalogue:**

| Event | When | Phase |
|---|---|---|
| `run.failed` | Run completes with failed > 0 | MVP (shipped in DD-018) |
| `run.regressed` | Pass-rate drop > 10% vs previous run on same branch/environment | Phase 2 — requires previous-run baseline lookup |
| `anomaly.detected` | Feature A4 fires an anomaly | Phase 2 — requires A4 (which itself requires 7+ runs of history) |
| `test.assigned_to_me` | User is assigned to a failed test | Phase 2 — requires per-user DM preferences |
| `comment.mentioned_me` | User is @mentioned in a comment | Phase 2 — requires @mention parser |
| `flaky.promoted` | Test crosses the flaky threshold | Phase 2 — requires A8 |

**Per-user DM preferences.** The `user_notification_preferences` table shipped in MVP per DD-027 (`database-design.md` §4.24) with channels `in_app | email`. Phase 2 adds the `slack_dm` channel to the ENUM and wires it through the dispatcher. Requires Slack OAuth (not just incoming-webhook URL) so CTRFHub can resolve user → Slack user ID via `user_slack_identities` (schema sketch in the migrations subsection below).

**Digest mode.** A project can be configured to batch notifications into a digest delivered at a fixed time (e.g. 9am daily). Outbound queue carries a `digest_key` column; delivery worker picks a digest window, aggregates, fires one message. Prevents incident-cascade spam (50 failing tests → 1 message).

**Conditional rules.** Project admins can constrain which events fire which webhooks (e.g. "only notify Slack #oncall for regressions on `main`, not feature branches"). Requires a rules DSL — even a minimal DSL (status + branch glob + environment match) is several days of design.

**ChatOps (Business Edition).**

- Slash commands: `/ctrfhub status :project`, `/ctrfhub assign :run/:result @user`, `/ctrfhub ack :anomaly_id`
- Interactive message buttons ("Acknowledge", "Assign to me", "Open in CTRFHub")
- Requires bidirectional Slack OAuth app, request signature verification, command router

**PagerDuty (Business Edition).** Native integration with PD's Events API. Different reliability requirements than Slack — PD users expect every page to land. The DD-018 outbox already meets this bar, but the PD adapter adds:
- Alert deduplication via PD incident keys (use CTRFHub's `run_id` as the dedup key so a re-ingest of the same run updates the existing incident rather than paging twice)
- On-call-aware routing (the PD user who is on-call for the service gets paged, not a channel)

**Admin surface — full delivery log UI.** Currently DD-018 ships a "last 5 deliveries inline per webhook" debugging surface. A full log view with filters (event type, status, date range, text search over payload) and raw-payload inspection is parking-lot. Useful but not MVP-critical.

### Schema migrations required

All additive — no breaking changes to DD-018's MVP schema:

- Add `project_webhooks.channel_type` ENUM (default `generic_http`); existing rows migrate cleanly
- Add `project_webhooks.rules` JSONB for conditional routing
- Add `webhook_deliveries.digest_key` VARCHAR for digest batching
- `user_notification_preferences` **ships in MVP** per DD-027 (`database-design.md` §4.24) with channels `in_app | email`. Promotion-day work is a migration that extends the `channel` ENUM with `slack_dm` and exposes the column in the settings UI.
- Add `slack_installations` for the org-level OAuth app install (bot token, workspace ID, scopes) — one row per `(org_id, slack_workspace_id)`.
- Add `user_slack_identities` for the per-user mapping produced by the user-level "Sign in with Slack" OAuth flow. Promotion-day starting schema:

  | Column | Type | Constraints | Notes |
  |---|---|---|---|
  | id | BIGINT | PK, AUTO_INCREMENT | |
  | user_id | BIGINT | NOT NULL, FK → users.id ON DELETE CASCADE | |
  | slack_installation_id | BIGINT | NOT NULL, FK → slack_installations.id ON DELETE CASCADE | Which workspace this identity belongs to |
  | slack_user_id | VARCHAR(32) | NOT NULL | Slack's `U…` identifier |
  | access_token_encrypted | TEXT | NOT NULL | Encrypted via `APP_ENCRYPTION_KEY` (DD-016 / DD-027) |
  | refresh_token_encrypted | TEXT | | For token-rotation Slack apps |
  | scopes | TEXT | NOT NULL | Space-delimited granted scope list; audited on every send |
  | connected_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
  | revoked_at | TIMESTAMPTZ | | Set when the user disconnects or Slack returns `token_revoked` |

  Constraints: `UNIQUE (slack_installation_id, slack_user_id)` and `UNIQUE (user_id, slack_installation_id)` — a CTRFHub user has at most one identity per Slack workspace they've connected.

### Success criteria for moving this out of the parking lot

Real user demand for a specific adapter — at least 3 self-hosted deployments asking for the same vendor before we commit to maintaining that adapter. Community feedback forum or a dedicated feature-request count on the repo is the signal.

---

## PL-010 — Two-factor authentication (2FA)

**Source:** B4 of the auth onboarding cluster (gap-review-solo-findings.md). Considered and deferred on 2026-04-22 before any DD was drafted.
**Milestone:** Phase 2 for Community (TOTP opt-in); Business Edition for org-level enforcement.

### Why it's deferred

2FA adds a lot of surface for a Community MVP whose primary users are operators bringing up a self-hosted instance on localhost or a private network. Even a minimal TOTP implementation requires: enrollment UX (QR code, verification step), backup-code issuance and single-use tracking, login-flow fork (password → code prompt), three recovery paths (backup codes, admin-initiated disable, CLI disable) to avoid self-induced lockouts, rate-limit envelopes for code submission, TOTP clock-skew handling, and encrypted-at-rest storage of the shared secret. That's real engineering cost and real ongoing support cost (lost-device recovery is the #1 support ticket for any system shipping 2FA).

MVP's threat model doesn't justify the cost yet. The core Community audience is:

- Solo developers / OSS maintainers on a $5 VPS — 2FA on a single-admin self-hosted instance is theatre. Losing the TOTP device here means losing access to a test-results dashboard.
- Small teams behind a VPN or reverse proxy with their own SSO layer — 2FA is already handled upstream.
- Ops engineers deploying via K8s or Terraform — expect to integrate their own auth (SSO via Business Edition) rather than managed passwords + 2FA in CTRFHub.

The population that most benefits from in-app 2FA is medium-to-large teams exposing CTRFHub to the public internet with only email/password login. That population is also the population most likely to upgrade to Business Edition for SSO, which supersedes in-app 2FA entirely (IdP handles MFA policy).

Alternatives already in place that close most of the practical threat:

- **Strong password policy** (DD-020 / DD-021): minimum 12 characters, Better Auth's common-password denylist, prevents reuse of the last-forgotten password.
- **Rate-limited login** (10 req/min per IP on the login endpoint).
- **Session invalidation on password change** (DD-021): a stolen session loses access the moment the user suspects compromise and resets.
- **No self-signup**: attackers can't create their own foothold; they need a valid invite.
- **SSO path available** for teams who need MFA: Business Edition SSO delegates auth to an IdP that enforces MFA.

### What would need to be built when this is promoted

**Schema.** Better Auth's two-factor plugin provides most of it — `users.twoFactorEnabled` boolean, encrypted `twoFactorSecret`, and a `two_factor_backup_codes` table (or equivalent) with single-use tracking. No new CTRFHub tables required beyond what Better Auth ships.

**Enrollment flow** (`/account/security` → Enable 2FA):
1. Generate TOTP secret + QR code + `otpauth://` URI.
2. User scans, enters 6-digit code to confirm shared secret.
3. Server issues 10 single-use backup codes, shown once on a "save these now" page with Copy / Download buttons.
4. Flip `twoFactorEnabled=true` only after confirmation code + backup-codes acknowledgement.

**Login flow.** After valid password, if `twoFactorEnabled`, prompt for 6-digit code. Accept current + previous 30s TOTP step (60s tolerance for clock skew). Constant-time comparison. Backup-code alternative link on the prompt page. Rate limit: 5 wrong codes / 15 min / user → temporary 15-minute lock.

**Three recovery paths** (mirrors DD-021 password-reset model):
- *Self-serve:* enter one of the 10 backup codes instead of a TOTP code. Each code single-use; user warned when they cross a threshold ("You have 3 backup codes remaining — regenerate?").
- *Admin-initiated:* `/admin/users` row action "Disable 2FA" — confirmation modal (type the user's email to confirm) + sends notification email to affected user ("Your 2FA was disabled by admin <name>") + emits audit log event in Business.
- *CLI:* `node dist/cli disable-2fa --email <email> [--force]`. Refuses non-admin targets without `--force` (same gate pattern as `reset-admin-password`).

**Enforcement** (deferred further, even within 2FA work):
- Community: opt-in per user; no org-level enforcement.
- Business: `organizations.require_2fa` boolean; when true, users without 2FA see a full-page enrollment wall on next login.
- Deliberately *not* in MVP 2FA work: "Admin role requires 2FA" (middle-ground that creates its own UX problems).

**Rate limits to add.** TOTP submission (5/15min/user), backup-code submission (5/15min/user), enrollment initiation (5/hour/user, prevents secret-rotation thrash).

**UI surface.** `/account/security` section in the settings navigation (already listed in settings-architecture.md §1.2 but currently parking-lot-flagged). Contents: Enable 2FA button → enrollment wizard; once enabled, show "Regenerate backup codes" and "Disable 2FA" (requires current TOTP code to confirm).

### Explicitly out of scope even when this lands

- **WebAuthn / passkeys.** Separate future work. Additive factor, not replacing TOTP.
- **SMS 2FA.** Never — SS7 attacks are a real threat model.
- **Email-code 2FA.** Useless — email is already the password-reset channel; if the email account is compromised, email-based 2FA is worthless.
- **Push notifications** (Authy / Duo / etc.). Vendor-specific; out of scope.
- **"Trust this device for 30 days".** Needs a `trusted_devices` table plus device-fingerprinting logic; straightforward but not free. Add if user feedback demands it.
- **Risk-based / step-up auth.** Business Edition territory if ever.

### Success criteria for moving this out of the parking lot

Any one of:

- A Community-deployment security incident or near-miss directly attributable to missing 2FA.
- 10+ users requesting 2FA on the public tracker.
- A potential Business Edition customer gating purchase on in-app 2FA (separate from SSO — some customers want both defence-in-depth).
- SOC 2 / ISO 27001 compliance timelines make it necessary.

Whichever hits first, open a dedicated DD at that point rather than reviving this PL entry in place — the six decisions from the B4 review (scope, factors, enforcement, recovery, trust-device, admin override) should be revisited with the then-current context, not auto-applied.

---

## PL-011 — Invitation token lifecycle (multi-user self-service onboarding)

**Source:** B5 of the auth onboarding cluster (gap-review-solo-findings.md). Considered and deferred on 2026-04-22 with the six design decisions frozen in — promotion should implement these decisions, not revisit them.
**Milestone:** Phase 2 for Community (when multi-user demand is visible); included by default in Business Edition as a precursor to SSO (both can coexist).

### What MVP ships without this

Community MVP is **single-admin-per-org** by default. The bootstrap admin (DD-020) is the only user-creation surface. Additional admins can be created via `node dist/cli bootstrap-admin --email --password --force` — intended as an operator escape hatch, not a first-class multi-user path. Multi-user Community deployments are expected to be behind a VPN or reverse proxy where the operator can shell into the container; multi-user public-internet deployments are expected to upgrade to Business Edition for SSO, which supersedes in-app invites entirely for that audience.

### Why it's deferred

Invitations sound like a one-evening implementation but the lifecycle is rich enough that shipping a good version is half a week of work: Better Auth organization-plugin schema adoption, acceptance flow (new-user and existing-user branches), re-invite with token rotation, cancel semantics, role-at-invite with role-promotion UI later, SMTP-not-configured fallback modal, pending-invites UI, email-deliverability observability. The design decisions are largely pattern-continuation from DD-021/DD-022, but the UI surface (pending-invites section on `/admin/users` with per-row actions) is real net-new work.

The threat model that justifies the cost is *"multiple non-admin users working in the same CTRFHub instance"* — which is a Business-Edition-shaped audience (teams/orgs with SSO needs) or a Phase-2-Community audience (small teams whose ops person doesn't want to run CLI commands to add colleagues). Neither is the MVP primary-persona focus (solo developers and small teams behind a VPN).

### Frozen decisions — implement these when promoted

The six B5 decisions are retained as the design. No "revisit" — promotion means building this:

**1. Schema: Better Auth organization plugin's native `invitations` table.** Fields: `id`, `email`, `inviterId` (FK to `users`), `organizationId` (FK), `role`, `status (pending | accepted | rejected | canceled)`, `expiresAt`. Status column is load-bearing for the invite lifecycle (cancel, expire, resend).

**2. TTL: 7 days.** Industry standard — matches GitHub, Slack, Notion. Generous enough for humans checking email after a weekend; short enough that stale invites don't pile up.

**3. Existing-user-in-different-org handling: associate existing user with the new org.** On acceptance, skip user creation, just add an `organization_members` row. No password reset needed; the existing user keeps their current credentials. A separate *"you've been added to <org>"* notification email fires at acceptance instead of a password-set screen. **Invites are "invite to org", not "invite to CTRFHub".** This matches every modern SaaS expectation (Slack, GitHub, Linear) and cleanly handles the "I already have a CTRFHub account at work, now I'm being invited to a consulting client's instance" case.

**4. Re-invite / resend: rotates the token.** "Resend" invalidates the old link, creates a new token, resets TTL to 7 days from now. Security-preferring default; if the old link leaked, it's dead.

**5. Already-invited email (pending invite exists): replace.** The admin's intent is clear. Confirmation modal highlights *"There's already a pending invite for this email — sending will replace it with a new link"*.

**6. Role at invite time: admin picks role at invite creation.** Community MVP has two roles (Admin, Viewer — see `product.md` Feature 5). Role stored on the invite row, copied to `organization_members` on acceptance. Principle-of-least-privilege says start as Viewer and promote, but in practice the admin usually knows the right role and forcing a two-step is friction. Confirmation modal highlights *"Inviting as Admin — this user will be able to invite others, manage tokens, and delete data"* for Admin-role invites.

### Acceptance flow (atomic transaction)

1. User clicks `/accept-invite?token=...` → invite row looked up, status/TTL checked.
2. **If target email already exists as a user:** present *"You've been invited to <org>. [Accept] [Decline]"* — no password prompt. On Accept, single transaction: add `organization_members` row, mark invite `status=accepted`, start session, redirect to `/`.
3. **If target email is new:** present password-set form (min 12 chars per DD-021 policy). On submit, single transaction: create `users` row with `emailVerified=true` (per DD-022 — the invite-link click proves email receipt), add `organization_members` row with the invite's role, mark invite `status=accepted`, start session, redirect.

### SMTP-not-configured path

Modal with copyable invite link + TTL display (*"This link expires on <date>"*). Admin delivers out-of-band (Slack / Signal / in-person). Matches DD-021 admin-initiated reset pattern. Consistent with the "refuse to show buttons that cannot work" principle from DD-021 and DD-022 — the Send button is not rendered in this mode; only the copyable-link flow.

### `/admin/users` additions

Currently `/admin/users` is MVP-scope-reduced to "list the admin + show session info" (see descope note in `product.md`). When PL-011 promotes, add:

- **"Invite user" button** in the top-right.
- **"Pending invites" section** above the member list: columns for email, role, invited-by, sent-at, expires-at, status. Per-row actions: Resend (rotates token), Cancel (deletes row), Copy link.
- **Role promotion/demotion** per member row — orthogonal to invites but the obvious place for it.

### Rate limits

- Invite creation: **20 per hour per admin** — prevents a compromised admin account becoming a spam cannon.
- Resend per invite: **3 per hour per invite** — prevents resend-spam.
- Invite-token acceptance (`GET /accept-invite?token=...`): covered by the general authenticated-API rate limit.

### Observability

- Events: `invite.sent`, `invite.accepted`, `invite.canceled`, `invite.expired`, `invite.resent`.
- Metric: `invite_acceptance_rate` over 7-day / 30-day windows. A drop is the canary for email deliverability (spam folder, SMTP misconfig, etc.).
- Structured log on `invite.accepted`: `{ inviterId, acceptedByExistingUser: boolean, durationSinceSentMs }`. The `durationSinceSent` p50 tells us whether 7-day TTL is right.

### Non-goals even when promoted

- **Bulk invites / CSV upload.** Phase-after-Phase-2. Most small teams invite 1–5 users at a time.
- **Open self-signup.** Never in Community. A public self-signup path defeats the whole "controlled access" model.
- **Magic-link invites** (one click, no password — the accepted user is immediately logged in without setting a password). Deferred along with magic-link login (see DD-021 non-goals).
- **Domain allowlist** (`*@company.com` auto-join). Business Edition territory.
- **Declination feedback** (*"Why are you declining?"*). Overkill — the invite is either accepted or it isn't.
- **Invite analytics dashboard.** The events above are logged; a dedicated UI is unnecessary until there's demonstrable operator need.

### Success criteria for moving this out of the parking lot

Any one of:

- 5+ Community users asking for self-service invites on the public tracker.
- Evidence that the CLI `bootstrap-admin --force` path is actively painful for real users (support thread, discord channel, GitHub issue).
- Business Edition roadmap starts — invites are a natural prerequisite and should land alongside SSO, not after.
- A specific Community use case emerges (e.g. university labs, OSS maintainer teams) where multi-user Community-without-SSO is a common shape.

Promotion is a build, not a redesign — the six decisions above are the design. When promoting, open a DD that cross-references PL-011 and points at the schema/flow already specified here.

---

## PL-012 — CLI bulk export (project / instance-wide)

**Source:** DD-023 (ships per-run JSON + ZIP export in MVP; per-project and instance-wide export deferred).
**Milestone:** Phase 2 for Community (when migration / compliance demand appears); Business Edition if audit-export SLAs become a purchase blocker.

### What MVP ships without this

Per-run export (`GET /api/v1/runs/:id/export.json` and `.zip` — see DD-023) covers the *"I want this one run's data"* case. Operators who need bulk export in MVP fall back to database-native tools: `pg_dump` for Postgres, file copy for SQLite; plus a recursive copy of the artifacts directory / an `aws s3 sync` on the S3 bucket. This is the correct answer for disaster-recovery backup anyway. PL-012 exists for the *portability* case — moving between CTRFHub instances, producing a SAR-compliant archive, archiving a project before deletion — where a CTRFHub-aware export is more useful than a raw DB dump.

### Why it's deferred

Per-run export from DD-023 already covers the individual-run case with the same JSON envelope PL-012 would use at scale. Bulk export adds real work on top: streaming tarball generation, progress reporting, resumable large exports, artifact-handling across local and S3 backends, manifest composition, scope selection (per-project vs. instance-wide), and admin-only CLI gating. None of it is hard; all of it is weeks of polish that don't block any user story MVP actually has.

The users most likely to need bulk export *today* can reach for `pg_dump` or a SQLite file copy. The users who'd most benefit from a CTRFHub-native CLI export are migrating between instances or producing compliance archives — workflows that don't exist until there are enough CTRFHub deployments to migrate between.

### Frozen decisions — implement these when promoted

**1. Command shape.** `node dist/cli export --project <slug> --out <path>` and `node dist/cli export --all --out <path>`. No mixing — you export one project or the whole instance, not a subset of projects.

**2. Output format.** Gzipped tarball (`.tar.gz`), not ZIP. Rationale: streaming tar is simpler to generate without buffering, and the audience for this command is operator-shaped — Linux hosts with `tar` already installed.

**3. Archive layout.**
```
ctrfhub-export-<project-slug-or-all>-<timestamp>/
├── manifest.json                  (version, scope, runCount, projectCount, exportedAt, ctrfhubVersion)
├── projects/
│   └── <slug>/
│       ├── project.json           (project metadata: name, slug, description, settings)
│       ├── runs/
│       │   ├── <runId>.json       (same envelope as DD-023 per-run JSON export)
│       │   └── …
│       └── artifacts/
│           └── <runId>/<resultId>/<filename>
└── README.md                       (human-readable index of what's inside)
```

**4. Scope: per-project or instance-wide (`--all`).** Instance-wide iterates projects. Admin-only (enforced by the CLI running inside the container with DB access, same as `bootstrap-admin` / `reset-admin-password` from DD-020/021). No per-org scoping in MVP promotion — reuse the invite/multi-org work from PL-011 if both land together.

**5. Artifact handling.** Mirrors DD-023's ZIP endpoint: local files copied into the tarball, S3 objects fetched server-side and streamed in. No pre-signed-URL-manifest mode — the whole point of export is self-containment.

**6. Progress reporting.** Structured log lines every N runs (`event=export.progress`, `runsExported`, `bytesWritten`). No interactive progress bar — this is a CLI run inside a container, output is probably going to a logfile.

**7. Resumability.** Not in the first PL-012 build. Add if users actually hit it. The simple path is a single-pass streaming tarball with a note in the docs that the operation should run in a screen/tmux session for long instance-wide exports.

### Endpoints

None — CLI-only. An HTTP-triggered async job with email-delivered download link was rejected because it needs a job queue and SMTP, both of which add surface in a workflow whose natural shape is shell access.

### Import symmetry

An export tarball must be re-ingestable into another CTRFHub instance via `node dist/cli import --from <path>`. Design the exporter with this in mind — every field in `manifest.json` exists to make import possible.

`ctrfhub import` is parked under the same PL entry: promoting export without import is half-a-loaf. Building export without building import turns the tarballs into write-only archives.

### Success criteria for moving this out of the parking lot

Any one of:

- Real migration traffic — someone moves from one CTRFHub instance to another and files a ticket about it being painful.
- Compliance export asks (SOC 2 auditor, GDPR SAR-at-scale, ISO-27001 evidence collection) — likely tied to Business Edition purchase conversations.
- Per-run export's weekly/monthly volume (from existing observability) crosses a threshold where batching becomes worthwhile.

Promotion is a build, not a redesign — the seven decisions above are the design.

---

## PL-013 — Orphaned-artifact reconciliation sweeper

**Source:** DD-023 (MVP uses cascade-only artifact cleanup; the post-DB-commit `unlink()` / S3 `DeleteObject` step can fail silently, leaving files with no DB referent).
**Milestone:** Phase 2 for Community; earlier if operator reports of disk-drift surface.

### What MVP ships without this

Cascade-only cleanup (DD-023). Delete-order is DB-first-then-unlink inside the same HTTP request. If the unlink fails (filesystem permissions, S3 API error, network blip mid-request), the DB is clean but the file persists as an orphan. A structured log line — `level=warn event=artifact.unlink_failed path=<…> reason=<…>` — fires on each failure so operators can spot the condition. Accumulation is bounded by user-initiated delete operations, not ingest volume: a slow drip, not a fast fill.

That's adequate for MVP because:

- The failure mode is **noisy, not silent** — every failure emits a log line.
- Bounded by user deletes means a single-admin self-hoster generates tens to hundreds of failures per year in the worst case, not millions.
- Recovery is a file system cleanup script operators can write (or PL-013 when promoted, which is that script shipped as a supported tool).
- The alternative — buffered deletion with a reconciliation sweeper — adds operational complexity for a slow leak most deployments will never notice.

### Why it's deferred

Running a nightly sweeper across every `test_result_artifacts` row against the backing store (filesystem walk or S3 `ListObjectsV2` pagination) is cheap for small deployments but scales linearly with artifact count. For a Community self-hoster with 50 K artifacts, it's fine; for a Business Edition instance at 50 M artifacts, it's a real cost line — and the orphan rate is still bounded by how often admins delete things, not how often CI ingests. Building the sweeper right (throttling, off-hours scheduling, safe-to-abort-and-resume, storage-backend-aware) is a week of work that MVP doesn't need.

### What needs to be built when promoted

**Schema addition.** `test_result_artifacts.deleted_at` TIMESTAMPTZ NULL. Two-phase delete: the cascade sets `deleted_at=NOW()` instead of DELETE; a separate sweeper actually removes rows + files after a configurable window (default 24h, protects against delete-mid-ingest races). Requires the delete endpoint to go through a service layer that soft-deletes, since FK `ON DELETE CASCADE` can't soft-delete.

**Reconciliation scan.** Nightly cron entry (reuse the retention-pruning infrastructure from Feature 7). Job logic:

1. Walk `test_result_artifacts` where `deleted_at IS NOT NULL AND deleted_at < NOW() - <window>` — hard-delete these rows and unlink their files.
2. Walk the backing store (filesystem tree or S3 `ListObjects` paginated). For each file, look up by path/key in `test_result_artifacts`. If no row exists and the file's mtime is older than the safety window, delete it (this catches the orphans from DD-023's unlink-failure path).

**CLI `ctrfhub fsck artifacts`.** Manual reconciliation for operators who spot disk-drift before the nightly sweeper runs (or who have disabled it). Same logic as the sweeper, with a `--dry-run` flag that prints what would be deleted without acting.

**Configuration.** `ARTIFACT_RECONCILIATION_ENABLED` (default `true`), `ARTIFACT_RECONCILIATION_WINDOW_HOURS` (default `24`), `ARTIFACT_RECONCILIATION_HOUR` (default `3` — 3 AM local time).

**Observability.** Metrics: `artifact_reconciliation_orphans_found`, `artifact_reconciliation_deleted`, `artifact_reconciliation_duration_seconds`. Log line per run.

### Not in scope even when promoted

- **Cross-region S3 replication awareness.** The sweeper hits the primary bucket only. Operators with replicated buckets either sync manually or ship their own reconciliation. Called out in the docs.
- **Pre-signed-URL-based scanning.** The sweeper runs server-side with native SDK calls, not via the pre-signed URL path.
- **Real-time orphan detection.** The nightly window is intentional; scanning every storage delete would double the write amplification.

### Success criteria for moving this out of the parking lot

Any one of:

- Operator report of disk-usage drift (DB reports `SUM(size_bytes)` much less than actual storage) — the canary.
- Sustained `artifact.unlink_failed` log volume (> 1 per 1000 delete operations) across multiple deployments.
- Business Edition enterprise customer gating purchase on "I need a cleanup job SLA."
- Large-scale deployment (> 10 M artifacts) adopts CTRFHub and wants a reconciliation story before going to production.

Promotion is a build, not a redesign — the schema + sweeper + CLI design above is the design.

---

## PL-014 — Observability platform (metrics, correlation, redaction, Sentry, slow-query, dashboards)

**Source:** Item D of the gap review (gap-review-solo-findings.md). MVP ships log-to-stdout (Pino) + an enriched `/health` payload (`bootState`, `startedAt`, `uptimeSec`, `version`, `commit`) only; all other observability surface deferred.
**Milestone:** Phase 2, with the sub-items graduating individually based on their promotion criteria — not as a single block.

### What MVP ships without this

- Pino structured JSON logging to stdout — operator ships it to wherever via Docker / journald / k8s / ELK.
- `LOG_LEVEL` env var (`info` default).
- Extended `/health` endpoint per product.md §Observability.
- Implicit rule that `Authorization` headers and API-token payloads are not logged.
- Per-feature `event:<name>` and `metric:<name>` log lines scattered across DDs (DD-017 AI pipeline, DD-018 webhooks, DD-019 ingest idempotency, DD-022 email verification, DD-023 artifact unlink failures). These are log-parseable but not unified under a single convention.

### Why it's deferred

MVP's operator audience is solo developers and small teams on single-container deployments where stdout + grep covers 80% of the debugging surface. The other 20% is meaningful — debugging a webhook delivery back to its originating ingest without a request-ID is guesswork — but the cost to build a real observability platform is several weeks of work that doesn't block any launch-critical user story. The recommendation made during the item D review was "all as recommended"; the call to park everything except `/health` is a deliberate MVP-minimalism choice, not a rejection of the underlying design. The design recorded below is what should be built when PL-014 promotes.

### Sub-items (promote individually)

Each sub-item carries its own promotion criteria. The list is roughly ordered by "how soon should this promote" — #1 is a slow-moving security concern that could justify earlier work than the rest.

---

**1. Log redaction deny-list (codified) — earliest-to-promote**

Today, the only redaction rule is the informal "`Authorization` values never logged" convention. A new developer adding a login-event log line who includes the request body by mistake doesn't have a guardrail. The risk is slow-moving (one leaked-secret incident from a future refactor) but the fix is cheap — maybe 30 minutes of work.

*What to build:* Pino `redact` config at logger init with an explicit deny-list:

- Headers: `authorization`, `cookie`, `x-api-token`, `x-ctrfhub-signature`
- Body fields: `password`, `currentPassword`, `newPassword`, `token`, `apiToken`, `apiKey`, `secret`, `smtpPassword`, `totpSecret` (when PL-010 promotes), `ai_api_key`
- Query strings: strip `?token=...` pattern from any URL before logging

Plus a unit test: feed known-sensitive payloads through the logger, assert the values don't appear in captured output. CI-blocking so regressions fail the build.

*Promotion trigger:* Any observability work starts here — redaction is a prerequisite for meaningful log aggregation. Alternatively promote standalone if a security review flags log leakage as a concern, or if operators report secrets showing up in shipped log pipelines.

---

**2. Request-ID correlation**

Today, a single user action that ingests a run → triggers AI pipeline stages → fires a webhook emits several disconnected log lines across the ingest handler, the AI worker, and the webhook delivery worker. Correlating them back to the originating request is eyeball-work on timestamps.

*What to build:*

- Fastify middleware that generates a UUID per inbound request (or accepts an incoming `X-Request-Id` header for upstream-proxy continuation), attaches it to the Pino child logger's bindings, echoes it in the response header.
- Propagate through AI pipeline jobs — store in `ai_pipeline_log.request_id` (new nullable VARCHAR(64) column).
- Propagate through webhook outbound deliveries — store in `webhook_deliveries.request_id` and send as `X-CTRFHub-Request-Id` on the outbound HTTP call so receivers can correlate.
- CLI flag `--request-id` on `node dist/cli *` commands — optional; when provided, threads through the same logger context so CLI operations land in the same correlation namespace.

*Schema changes:* Two nullable VARCHAR(64) column additions. Backfill-free; existing rows stay NULL.

*Promotion trigger:* First real production debugging incident where request correlation would have cut time-to-resolution materially. Also promote together with the metrics endpoint (sub-item 3) since `/metrics` dashboards become dramatically more useful when you can click a metric and see correlated request-IDs.

---

**3. Metrics surface (log-based formalization + Prometheus `/metrics` endpoint)**

Today the `metric:<name>` log-line convention is established in practice but never documented. There's no unified counter implementation, no standard for what to emit, and no scrape endpoint for operators with existing Prometheus infrastructure.

*What to build:*

- *Formalize the log-based convention.* A logging helper `logger.metric(name, value, labels?)` that emits `{ metric: '<name>', value, labels, timestamp }` with a stable JSON shape. Documented in a canonical metrics catalog so DDs don't each reinvent the naming.
- *Prometheus text endpoint.* In-process counters via `prom-client` (~3–5 MB RAM, acceptable at MVP's <500 MB target). Same counter increments both the log-helper and the Prometheus registry. Endpoint at `GET /metrics`, opt-in via `METRICS_ENABLED=true` env var, optionally bearer-token-gated via `METRICS_TOKEN` (required for any instance exposing `/metrics` on a public interface).
- *Core metric catalog:* `ingest_total`, `ingest_duration_seconds`, `ai_pipeline_pending_depth` (by stage), `ai_pipeline_stage_duration_seconds`, `webhook_delivery_total` (by status), `webhook_delivery_duration_seconds`, `sse_connections_active`, `db_query_duration_seconds`, `request_duration_seconds` (histogram by route and status code), `http_requests_total`. Plus the scattered per-feature metrics already referenced in DDs, migrated to the helper.

*Env vars:* `METRICS_ENABLED` (default `false`), `METRICS_TOKEN` (optional).

*Promotion trigger:* First self-hoster asks for Prometheus scraping, OR scaled deployments need throughput dashboards that grep'ing logs can't cheaply produce.

---

**4. Error reporting integration (Sentry optional)**

Today, unhandled exceptions hit the Pino log stream and exit with a stack trace; nothing captures them centrally. Operators can ship logs to Sentry's log ingestion, but native SDK integration gives better grouping, release tagging, breadcrumbs, and user-context.

*What to build:*

- Sentry SDK initialization via `SENTRY_DSN` env var — off by default, initialized if set.
- Fastify error-handler integration that captures unhandled exceptions with request-ID context (depends on sub-item 2 landing first for full value) and current user ID.
- Uncaught-promise-rejection and uncaught-exception handlers at the Node.js level.
- Release tagging from the `version` / `commit` already exposed on `/health`.
- PII-safe by default — rely on sub-item 1 (redaction) to keep secrets out of error payloads.

*Env vars:* `SENTRY_DSN` (optional), `SENTRY_ENVIRONMENT` (default: `production`), `SENTRY_SAMPLE_RATE` (default: `1.0`).

*Promotion trigger:* First operator asks for Sentry integration OR a production incident where grep'ing logs for "Error:" is demonstrably inadequate.

---

**5. Slow-query logging**

Today, MikroORM's query-timing hook is not enabled; no visibility into which queries are drifting slow until users complain about latency.

*What to build:*

- MikroORM query-logger hook with a configurable threshold — queries exceeding the threshold emit `event=slow_query` with query hash (SHA-256 of the parameterized query text, not values), table name, duration, and request-ID (from sub-item 2).
- `SLOW_QUERY_MS` env var (default: `500`).
- Pino log level is `warn` for slow queries — doesn't drown the default `info` stream but stays visible at baseline verbosity.

*Promotion trigger:* First latency regression where slow-query data would have cut investigation time. Low-cost to add in isolation — could promote standalone before the rest of PL-014 if it's cheap to do.

---

**6. Shipped dashboards and scrape config**

Today, operators who build a Prometheus/Grafana stack around CTRFHub start from scratch with no reference.

*What to build:*

- `/docs/observability/prometheus-scrape-config.yml` — ready-to-copy scrape job definition covering `/metrics` (from sub-item 3).
- `/docs/observability/grafana-dashboard.json` — a single dashboard with rows for: ingest throughput, AI pipeline depth and failure rate, webhook delivery success rate, p95 response time by route, DB query p99 latency, SSE connection count, slow-query rate.
- Documentation in `docs/operations/observability.md` explaining how to wire it up.

*Dependencies:* Requires sub-items 2 and 3 to have landed (dashboard panels are meaningful only if the metrics exist).

*Promotion trigger:* Promote alongside or shortly after sub-item 3. Effectively free once 3 lands.

---

### Schema impact (when sub-items 2, 3 promote together)

- `ai_pipeline_log.request_id` VARCHAR(64) NULL
- `webhook_deliveries.request_id` VARCHAR(64) NULL

Additive migrations, backfill-free.

### Non-goals even when PL-014 promotes

- **OpenTelemetry distributed tracing with span propagation.** Request-ID correlation covers 80% of the debugging value at 20% of the implementation cost. Real OTEL spans are a later call.
- **Custom in-product APM dashboard.** Grafana is the right tool; CTRFHub doesn't build its own.
- **User-visible activity feed / event log in the UI.** Ties to Business Edition audit log (B3), not to this PL.
- **Log retention / rotation inside CTRFHub.** Operator concern; stdout goes to their log pipeline.
- **Custom metrics authoring by end-users.** Not a Community use case.

### Success criteria for moving sub-items out of the parking lot

Each sub-item has its own trigger documented above. No single "observability platform" promotion event — graduate individually as needs surface.

Promotion is a build, not a redesign — the sub-items above are the design.

---

## PL-015 — Machine-readable OpenAPI 3.1 spec at `GET /api/v1/openapi.json`

Deferred 2026-04-22 during the item-E (API versioning) gap review. DD-024 commits to a specific stability contract for `/api/v1/*`; an OpenAPI spec is the *mechanism* that makes the contract verifiable — diffing the spec across releases surfaces breaks that code review misses. MVP ships without it because the risk/value ratio is low at pre-launch scale: zero external users whose CI we could break means the first such incident *is* the promotion trigger.

### What this is

Serve a machine-readable OpenAPI 3.1 document at `GET /api/v1/openapi.json`, generated from Fastify's existing schema definitions (Zod-validated routes already carry the shape metadata). The spec is the source of truth for:

- Client code generation (TypeScript clients, Python clients, Go clients — any language with an OpenAPI codegen).
- Contract diff-checking as a CI gate — a PR that breaks the v1 contract without also updating the sunset schedule fails CI.
- Interactive docs at `/api/v1/docs` via `@fastify/swagger-ui` (optional, same package).

### Implementation sketch

- Add `@fastify/swagger` + `@fastify/swagger-ui` dependencies.
- Register the plugin with title, description, and version read from `package.json`.
- Every existing Zod schema flows into the OpenAPI output via the `fastify-type-provider-zod` adapter already in use for request validation.
- CI gate: `npm run openapi:dump > openapi.snapshot.json` then `git diff --exit-code openapi.snapshot.json` on every PR. Any diff that removes or renames a field requires explicit `OPENAPI_BREAKING_CHANGE_ACKNOWLEDGED=true` in the commit trailer to pass.
- Keep the HTMX `/hx/*` routes **out** of the public spec — they're not part of the v1 contract. The Swagger UI registers only `/api/v1/*`.
- Operators running behind auth can gate the spec endpoint with the same session auth or keep it open for clients that need it pre-auth to generate code; default is open since the shape of public endpoints is not itself a secret.

### Estimated effort

~1 day of work once promoted. Fastify schema definitions are the hardest part and already exist.

### Promotion triggers

Any one of:

- **First accidental break slips past code review.** The moment we have an incident where a renamed field or tightened validation made it into a release without a sunset cycle, the spec+diff CI gate pays for itself immediately. This is the highest-probability trigger.
- **Community asks for codegen.** First request for "where's the OpenAPI spec so I can generate a Python client?" is a green light — the population of users who would ask has some non-trivial size behind it.
- **Business Edition launch.** Business customers come with procurement expectations. An OpenAPI spec is table-stakes for SaaS-adjacent commercial offerings and gets asked for in security reviews.
- **First-party SDK.** Shipping an official TypeScript or Python SDK requires a stable machine-readable source of truth. The SDK and the spec promote together.

### Non-goals even when PL-015 promotes

- **GraphQL schema.** Unchanged — `v1` is REST; no second surface.
- **gRPC / protobuf definitions.** Not pursued. Self-hosted operators aren't going to port their CI to gRPC.
- **API versioning via content negotiation** (`Accept: application/vnd.ctrfhub.v1+json`). DD-024 commits to URL-based versioning; PL-015 inherits that decision.
- **Spec-first development** (writing OpenAPI by hand, generating handlers from it). Not pursued — the codebase is schema-first via Zod and that stays the source of truth; OpenAPI is derived, not authored.

### Until PL-015 promotes

MVP accepts the risk surface that:
- Breaking changes can slip into `/api/v1/*` without being caught by a spec diff; they'd need to be caught by code review or by a downstream CI pipeline breaking noisily. The breaking-change definition in DD-024 is explicit enough that reviewers have something concrete to check against.
- No first-party SDK; CTRF reporters for Playwright / Cypress (Feature 6) are thin bespoke HTTP posters, not OpenAPI-generated clients.
- Third-party codegen requires the spec to exist — so third-party SDKs effectively require this PL to promote first.

Promotion is a build, not a redesign — the spec shape is derived from Zod schemas that are already the source of request/response validation.

---

## PL-016 — Bespoke `ctrfhub backup` / `ctrfhub restore` CLI

Deferred 2026-04-22 during the item-G (backup/restore/upgrade) gap review. DD-026 commits CTRFHub to a standard-tools posture for backup — `pg_dump`, `sqlite3 .backup`, `tar`, `rsync` — with three documented recipes in `docs/ops/backup-and-restore.md`. This is the pattern Mattermost has shipped at enterprise scale for years; self-hosted operators generally already own the tools.

A first-class `ctrfhub backup` / `ctrfhub restore` CLI would wrap those tools with CTRFHub-aware behaviour: version tagging, integrity checks, compatibility gating before applying. MVP ships without it because the three 6-to-10-line recipes are small enough that a wrapper is premature.

### What this is

```
ctrfhub backup [--out <path>] [--include-s3] [--stop-service]
ctrfhub restore --from <path> [--skip-version-check] [--confirm]
ctrfhub verify --from <path>
```

Responsibilities the CLI would own on top of the raw recipes:

- **Config-aware invocation** — read `DATABASE_URL` / SQLite path from the existing config, invoke `pg_dump` / `sqlite3` with correct args, handle Docker-Compose exec vs. bare-metal transparently.
- **Version-tagged archives** — embed `binary_version`, `schema_version`, `dialect`, `artifact_backend`, `created_at` in a `META` file inside the archive so `restore` can sanity-check before touching data.
- **Restore-time compatibility gate** — `ctrfhub restore` reads the META, refuses to proceed if schema version in the archive exceeds the current binary's expected version (mirrors the startup guardrail from DD-026, but at the CLI layer so operators learn before booting).
- **Optional S3 mirror** (`--include-s3`) — for operators who want a full self-contained archive, `aws s3 sync` the bucket into the tarball. Emits bandwidth + size warnings.
- **Integrity check** (`ctrfhub verify`) — runs `pg_restore --list` / `sqlite3 PRAGMA integrity_check` against the archive without applying; surfaces corrupt backups before a real incident.
- **Structured JSON output** — so operator scripts can pipe to monitoring / on-success S3 sync / retention pruning.

### Implementation sketch

- Reuse the existing CLI entry point `server/src/cli/index.ts` (already hosts `bootstrap-admin`, `reset-admin-password`, `migrate:up`, `migrate:down`, `migrate:check`, `migrate:status`).
- Backup command shells out to `pg_dump` / `sqlite3` using the same config-resolution path as the app.
- Restore command: (1) integrity-check archive via META + `pg_restore --list`, (2) compatibility check, (3) apply DB restore, (4) apply artifact restore, (5) run forward migrations if binary > schema, (6) emit structured completion event.
- No new dependencies — the whole thing is a wrapper over tools the image already carries.

### Estimated effort

~3 days: backup is a small wrapper; restore's compatibility-check branching carries the nuance (`--skip-version-check` escape hatch for experts, error-message wording for non-experts, exit-code taxonomy for scripts). Probably another day for `verify` and the S3 mirror path.

### Promotion triggers

Any one of:

- **First "how do I back this up?" support ticket** where the pointer-to-runbook answer visibly disappoints the asker. Demonstrates that the runbook isn't enough.
- **First pre-launch Business Edition customer** asks in a sales call and a one-sentence answer is needed. "Follow the runbook" isn't it.
- **First compliance/audit checklist** demands a backup CLI (a few frameworks ask for this literally).
- **First restore-went-sideways incident** where an operator restored to the wrong binary version and hit the startup guardrail from DD-026. The guardrail prevents corruption, but a CLI-level check before starting would have caught it earlier.
- **Mattermost-style downgrade UX ask.** Mattermost ships `mattermost db downgrade` as a first-class CLI command even though ours (`node dist/cli migrate:down`) already exists as a migration primitive. A user asking "why isn't there a `ctrfhub downgrade` that wraps the whole sequence?" is a promotion signal.

### Non-goals even when PL-016 promotes

- **GUI backup management.** CLI only. Self-hosted ops audience.
- **Incremental backups / PITR.** Full snapshots only; PITR moves toward WAL-archiving complexity that operators handle via pgBackRest / Barman / RDS.
- **Cross-dialect restore** (SQLite → Postgres, etc.). The migration path is already documented separately in `deployment-architecture.md`; PL-016 doesn't collapse into that.
- **Backup encryption.** Operators encrypt with `gpg` / `age` / SSE-KMS per DD-026; bundling GPG into the CLI duplicates OS-level tooling badly.
- **Cloud-backend adapters.** No S3 upload in the CLI beyond the `--include-s3` mirror; operators pipe output to whatever their backup target is.
- **Bundled scheduling.** Operators use cron / systemd timers / Kubernetes CronJobs.

### Until PL-016 promotes

Operators follow the three documented recipes in `docs/ops/backup-and-restore.md`. Each fits in 6–10 shell lines. The perceived friction that would promote PL-016 is specifically: when those shell lines stop being acceptable (operator unfamiliarity with `pg_dump -F c`, procurement-driven ask for a CLI, or a restore incident that a CLI check would have prevented).

---

## PL-017 — Malware scanning on uploaded artifacts (ClamAV sidecar)

**Source:** DD-028 out-of-scope list (artifact XSS hardening scope)
**Milestone:** Business Edition, first regulated-industry customer ask

### Why it's deferred

DD-028 makes the **execution-context** threat model solid — attacker-controllable HTML/SVG/PDF cannot execute JS in the CTRFHub-origin browser context, filenames cannot inject headers, polyglot files are rejected at ingest. What it does not cover is the **egress** threat model: a CI-pipeline-authored test artifact that contains malware — a zipped Windows binary, a PDF with a known exploit, a compromised trace.zip — that an engineer downloads from the run detail page and opens on their workstation. That's a real attack surface for teams where artifacts are routinely downloaded and inspected, but it's one every file-hosting tool ever built shares, and regulated-industry customers typically satisfy the requirement by running their own endpoint AV on download rather than relying on server-side scanning.

MVP's position: downloading an artifact is no different from downloading any other file from an internal tool; engineers bring their own workstation AV. Server-side scanning buys defence-in-depth but adds an operationally-non-trivial sidecar.

### What needs to be built when promoted

- **`clamav` sidecar** in the compose stack, volume-sharing `artifacts_data` (for `ARTIFACT_STORAGE=local`) or fetching from S3 on demand.
- **Upload-time scan:** multipart part buffered to disk, `clamdscan` invoked, infected parts rejected with `422 Unprocessable Content` and `event=ingest.malware_detected` logged (`project_id`, `token_id`, signature name).
- **Retroactive scan:** nightly cron that walks the artifact store, scans rows with `last_scanned_at IS NULL OR last_scanned_at < signature_db_updated_at`, writes `test_artifacts.malware_scan_status` (`clean | infected | error | skipped`) and `last_scanned_at`.
- **UI surface:** quarantined artifacts show a lock icon in the run detail view; a download attempt returns `403 Forbidden` with the signature name. Admins can override on a per-artifact basis after review.
- **Signature database updates:** `clamav-freshclam` runs in the sidecar; daily update cadence.
- **DD-028 integration:** magic-bytes validation runs first (cheap, catches polyglots), malware scan runs second (expensive, catches known-bad content that passes type validation).

### Schema migration when promoted

- Add `test_artifacts.malware_scan_status ENUM` (`clean | infected | error | skipped`, default `skipped` for pre-PL-017 rows).
- Add `test_artifacts.last_scanned_at TIMESTAMPTZ`.
- Add index `(malware_scan_status, last_scanned_at)` for the nightly rescan query.

### Success criteria for moving this out of the parking lot

(1) A regulated-industry customer (finance, healthcare, gov) explicitly asks during Business Edition sales. (2) A support incident where a user reported downloading an infected artifact from their CTRFHub install. (3) Community demand — 3+ deployments independently asking for it.

### Non-goals even when PL-017 promotes

- **Commercial AV engines** — ClamAV only in MVP-of-PL-017; operators wanting commercial engines can replace the sidecar image.
- **Deep inspection of archive contents beyond one level** — zip-in-zip-in-zip is out of scope; `clamdscan`'s default archive-depth is enough.
- **Quarantine timeline / review workflow UI** — admins can override infected status one-by-one; no batch quarantine management.
- **Offline signature updates** for airgapped deployments — operator-responsibility.

---

## PL-018 — HTML sanitisation of artifact bodies (DOMPurify or similar)

**Source:** DD-028 out-of-scope list
**Milestone:** First operator ask for belt-and-braces content filtering

### Why it's deferred

DD-028 I1 (opaque-origin iframe sandbox) already renders HTML-artifact XSS unexploitable for the CTRFHub-origin threat model — scripts in the iframe can't read session cookies or call CTRFHub APIs as the user. Adding a DOMPurify pass on every HTML artifact upload or render would be belt-and-braces, not a primary defence. Three costs: (1) an HTML parser on the upload hot path, which is fragile against mutation-XSS payloads that round-trip through the parser differently than browsers render; (2) sanitisation changes report content, which could break Playwright HTML reports in subtle layout/interaction ways; (3) maintenance burden — DOMPurify updates need to be tracked for new bypasses.

The opaque-origin sandbox is a **structural** defence; DOMPurify is a **content** defence. The structural defence is cheaper to get right and harder to bypass.

### What needs to be built when promoted

- **Upload-time sanitisation** of `text/html` artifact parts via DOMPurify (Node edition). Strips all `<script>`, event handlers, `javascript:` URLs, `<iframe>`, `<object>`, `<embed>`, `<form>`, and data-URI scripts. Store the sanitised body alongside the original (or overwrite — operator choice via `SANITISE_HTML_ARTIFACTS=strict|preserve-original`).
- **Playwright HTML report bundles** get a pass over `index.html` and any HTML assets inside the zip. Playwright's legitimate interactivity (filter chips, timeline scrubber) needs to survive — the sanitiser config must whitelist Playwright's attribute patterns.
- **Opt-in via env var** (`SANITISE_HTML_ARTIFACTS=off|strict|preserve-original`, default `off` — the DD-028 sandbox is sufficient for the stated threat model; this feature exists for operators who want the extra layer).

### Why this isn't urgent even for operators who ask for it

Ask the requester: "what attack does this block that the DD-028 sandbox doesn't?" Usually the honest answer is "defence in depth / compliance checkbox" — both legitimate, neither urgent. Often the right answer is to first ensure DD-028 I1's sandbox directive is actually being emitted in production (operational concern) before adding content filtering.

### Success criteria for moving this out of the parking lot

(1) A compliance auditor specifies HTML content sanitisation as a hard requirement. (2) A real exploit against DD-028 I1 surfaces (would be a significant browser bug, since opaque-origin sandboxes are standardised). (3) 5+ operator requests from self-hosters.

### Non-goals even when PL-018 promotes

- **Sanitising non-HTML content** (SVG stripping, PDF JS removal) — SVG and PDF already force-download per DD-028 I3; no rendering, no exploit surface.
- **Server-side HTML rendering preview** in run detail. If inline HTML preview ever lands, it uses the sandbox — the sanitiser is the secondary layer.
- **Per-org sanitisation policies.** Global env-var toggle only.

---

## PL-019 — Mobile-degraded-functional viewport posture (promotion from desktop-only MVP)

**Source:** DD-030 alternatives discussion
**Milestone:** First concrete on-call / triage-from-phone user surfaces, or a Business Edition customer asks during sales

### What MVP ships without this

DD-030 committed CTRFHub to a **desktop-only product, mobile-first authoring** posture — design target 1280×800 CSS px, `<meta name="viewport" content="width=1280">` pinning the rendered width so mobile browsers show the desktop layout at zoom, no mobile product story, no drawer-navigation design work, no column-priority hiding, no row-to-card transformation, QA at 1280 primary. A user opening CTRFHub on a phone today sees the full desktop UI rendered small and can pinch-zoom to read and interact — the Datadog / Snyk / CircleCI / Buildkite posture. This is sufficient for the primary user workflow (workstation triage) and is honest about what the design work has actually optimised for.

**What MVP already does**, because of the mobile-first authoring commitment: base Tailwind styles target narrow viewports with `md:` / `lg:` / `xl:` adding desktop enhancements; Flowbite components render at their responsive defaults (drawer-collapse, hamburger, responsive-table wrappers) rather than being stripped to desktop-always; tables exceeding narrow viewports get an `overflow-x-auto` wrapper; Playwright runs a two-viewport matrix (1280×800 primary + 375×800 narrow smoke — no `console.error`, no unexpected horizontal overflow). This is not a mobile product story — it's a CSS-drift regression guardrail and an authoring discipline that makes promotion cheap.

### Why it's deferred

The on-call-triage-from-phone use case is speculative at MVP:

- No persona in `product.md` explicitly requires mobile functional-use.
- No user has asked for it.
- The cost of full "desktop-primary, mobile-degraded-functional" posture — drawer-nav design, column-priority ladder for the Run Results table, mobile QA commitment, three-viewport Playwright test matrix, per-PR narrow-viewport design review, touch-target enforcement — is real and ongoing. Paying that tax on a workflow nobody uses is the wrong trade.

The failure mode of under-committing (DD-030's stance) is cheap: because authoring is already mobile-first, when the first real on-call user surfaces, PL-019 promotes and the work is QA commitment plus polish — not a rewrite. The failure mode of over-committing is expensive: ongoing design and review tax on a feature that doesn't serve users.

### What would be built when this is promoted

Because the mobile-first authoring commitment is already paid, promotion scope shrinks to:

- **Viewport-meta swap.** Swap `<meta name="viewport" content="width=1280">` to `content="width=device-width, initial-scale=1"` so mobile browsers render at their native width instead of at desktop-and-zoom. One line.
- **Run Results column-priority ladder.** The one screen where horizontal-scroll is not the right answer because the columns need selective visibility. `Status icon + Test name always; Duration ≥ sm; Assigned ≥ md; Created-at + Reporter ≥ lg; AI category ≥ xl`. Hidden columns remain in the DOM (`hidden sm:table-cell`) so keyboard nav, copy-paste, and screen readers still see every column. No row-to-card transformation — cards lose cross-row scan semantics.
- **Mobile QA commitment.** Adopt a three-tier viewport spec — desktop (≥ `lg`, 1024+) primary, tablet (`md`, 768–1023) supported, mobile (360–767) degraded-but-functional, < 360 not supported — and commit to reviewing new screens against these tiers. This is a process change (what gets reviewed, what blocks merge) more than a code change.
- **Playwright matrix expansion.** Upgrade the two-viewport matrix (1280 primary + 375 smoke) to three-viewport with full assertions at each: 360×800, 768×1024, 1280×800. Assertions: page renders without `console.error`, no unexpected horizontal overflow outside `.overflow-x-auto`, primary action button Tab-reachable within 10 keystrokes, hamburger toggles drawer on mobile.
- **Touch-target upgrade.** WCAG 2.1 AA 24×24 minimum floor (carried over from DD-030 accessibility commitment) upgraded to WCAG 2.2 44×44 recommendation on primary action rows (row-expanders, kebab menus, toggle switches, "assign to me" buttons). Icon-only buttons get `aria-label` + padding totalling 44×44.
- **Third-party content policy.** DD-028 sandboxed iframes (Playwright HTML report, `text/html` attachments) and video embeds render at their native sizing. Outer viewport has `initial-scale=1` (not `maximum-scale=1`) so users can pinch-zoom iframe content on mobile. No attempt to restyle third-party content.

**What promotion does NOT have to do**, thanks to the mobile-first authoring commitment: re-author base CSS (already unprefixed-narrow-first), retrofit `md:` / `lg:` breakpoints across the codebase (already present on screens that need them), swap Flowbite components for responsive variants (already responsive), wrap every table in `overflow-x-auto` (already the authoring rule), build a new narrow-viewport smoke harness (already in the Playwright matrix as a regression guardrail). That's the difference between "promotion is one sprint" and "promotion is a quarter-long rewrite."

### Schema impact when promoted

Zero. PL-019 is UI-only.

### Success criteria for moving this out of the parking lot

(1) **Concrete user ask.** A Community self-hoster or a Business customer says "I got paged at 2 AM and couldn't triage from my phone." One ask is enough — the speculative nature of the need is the current reason for deferral, and the first non-speculative surfacing removes the reason.
(2) **Business Edition sales trigger.** A prospect asks during a sales conversation whether CTRFHub works on mobile. Desktop-only is a defensible answer in MVP; at scale it starts to cost deals.
(3) **Design review surfaces a real story.** A future UX review identifies an interaction flow (e.g. a push-notification deep-link that lands the user on a run page) where the current "pinch-zoom to interact" UX is actively bad, not merely inelegant.

### Non-goals even when PL-019 promotes

- **Native mobile app (iOS/Android).** Separate product, separate codebase, separate maintenance; not on the CTRFHub roadmap.
- **PWA install / offline mode.** CTRFHub is always-online when the network path is available; offline adds no value.
- **Gestures (swipe-to-dismiss, pull-to-refresh).** Stock HTMX navigation and Alpine click handlers are the interaction model on every viewport.
- **Portrait-vs-landscape differentiation.** Handled implicitly by the breakpoint ladder.
- **Per-org "compact mode" / information density toggles.** Future-UI concern, not a viewport concern.
- **Server-side user-agent detection and separate mobile templates.** Explicitly rejected — one markup tree, CSS-only adaptation.
- **Visual-regression testing** (Percy/Chromatic-style screenshot diffs). Tracked separately; promote when design-system maturity or a mobile-rendering-bug incident demands it, not as part of PL-019.

---

*Last updated: 2026-04-23*

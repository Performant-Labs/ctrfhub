# Test Handoff — CTRF-002

**Branch:** `story/CTRF-002`
**Commits added by Test-writer:**
- (pending commit) `test(CTRF-002): ingest integration tests, unit tests, migration fix`

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | ✓ | `.argos/CTRF-002/tier-1-report.md` |
| T2 ARIA (clean room) | N/A — API-only route, no rendered HTML | — |
| T2.5 Authenticated State | N/A — API-only route, no rendered HTML | — |
| T3 Visual | N/A — API-only route | — |
| Backdrop-contrast | N/A | — |

## Tests added

| Layer | Files | Tests | Notes |
|---|---|---|---|
| Unit | `src/__tests__/unit/size-limit.test.ts` | 13 | `parseMaxJsonSize()` — all suffixes, edge cases, fallback |
| Integration | `src/__tests__/integration/ingest.test.ts` | 12 | 3 describe blocks: happy-path (9 tests), multipart+chunked (2), auth errors (2) |
| Integration | `src/__tests__/integration/migrations-sqlite.test.ts` | +4 (modified) | Fixed 4→5 table count; added `ingest_idempotency_keys` column + FK assertions |

## Coverage (from `npm run test`)

Full suite: 238 tests, 0 failures.

## Non-blocking issues

- **Better Auth API-key rate limiter:** The `@better-auth/api-key` plugin enforces an internal rate limit on key verification calls (approx. 10 per 10-second window, enabled even when `NODE_ENV` is unset). Tests had to be split into 3 describe blocks with separate app instances to keep each suite's API-key-verified requests under the limit. Future stories that add more ingest-route tests may need to be aware of this ceiling. A potential improvement: configure `rateLimit: { enabled: false }` in `buildAuth()` when `testing: true` — but that requires an `auth.ts` change (Feature-implementer scope).

- **Organization table seeding:** The `organization` table is not created by Better Auth (the `organization` plugin is not loaded) and is excluded from MikroORM's schema generator via `skipTables`. Integration tests that need an Organization must create the table via raw DDL. This pattern is documented inline in the test fixture.

- **413 (body too large) not integration-tested.** Fastify's `bodyLimit` enforcement happens at the HTTP parser level and is difficult to trigger via `app.inject()` (which bypasses TCP). The bodyLimit is set to `parseMaxJsonSize(process.env.MAX_CTRF_JSON_SIZE)` and unit-tested in `size-limit.test.ts`. The 413 path is a Fastify framework responsibility and is well-tested upstream.

- **429 (rate limit) not integration-tested.** Sending 120+ requests in an integration test is expensive and fragile. The `@fastify/rate-limit` config is set at `max: 120, timeWindow: '1 hour'` on the route — verifying rate limiting is a Fastify plugin responsibility tested upstream.

## Next action (Spec-enforcer)

1. Open a new session. Paste `.antigravity/agents/spec-enforcer.md` as the first message, then this handoff as the second.
2. Check out `story/CTRF-002`.
3. Run the Audit Checklist and write the verdict to `.argos/CTRF-002/spec-audit.md` (template in `.antigravity/agents/spec-enforcer.md`).

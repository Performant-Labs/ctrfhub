# Task Brief — audit-composition-root-S1: Align composition-root rate-limit + auth-failure logging with DD-012 / DD-029

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: none (S1 is independent of S2/S3 and of any open story)
- [x] No P0 gap blocks this story: gaps.md P0 items (G-P0-001..004) are Tailwind/Eta/settings-schema/AI-recovery — none touch rate-limit or auth logging
- [x] Branch cut: `story/audit-composition-root-S1` from `main` @ `b483f2b`
- [x] `tasks.md` flip: N/A — this story is decomposed from an architecture audit, not a `tasks.md` row (same shape as `audit-auth-S1`)
- [x] No other story mid-flight. PRs currently open (#79, #80, #81, #84) are doc/orchestration artifacts with **zero file overlap** with `src/app.ts`.

## Source

**Audit:** `audit-composition-root` (territory T6 of the codebase audit campaign).
**Findings:** `.argos/audits/audit-composition-root/findings.md` — Findings #1 and #6 (both `warn`, Theme T6-α).
**Decomposition entry:** `.argos/audits/audit-composition-root/decomposition.md §Story audit-composition-root-S1`.

Both files currently live on the unmerged `audits/audit-composition-root` branch (PR #84). They are referenced for traceability — F does not need them on `main` to do this story; everything F needs is inlined below.

## Story

**Description.** The composition root's global `@fastify/rate-limit` registration (`src/app.ts:226-229`) uses the library default key (IP) and ships no `errorResponseBuilder`, so the 429 response misses the DD-029 contract. Separately, the global auth preHandler's API-key invalid-key branch (`src/app.ts:569-582`) returns 401 with no log line, so a misconfigured CI sending a bad `x-api-token` silently fails — `architecture.md §Code Conventions → Logging` explicitly names "log decisions (e.g. invalid API key) without logging the token value" as the canonical pattern, and DD-029 spells out the matching observability shape (`event=*` Pino line). This story brings both into conformance.

**Acceptance criteria.**
- `@fastify/rate-limit` registration in `src/app.ts` declares a `keyGenerator` that keys on `request.user?.id` (the session user) *after* auth has resolved, falling back to `request.ip` for unauthenticated requests. Matches DD-012's `General authenticated API | 600 req/min | session-user-id` row (`docs/planning/database-design.md:1171`).
- An `errorResponseBuilder` emits the DD-029 429 contract verbatim:
  - **Headers (always):** `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (RFC 9728 draft), `Retry-After` (seconds, integer) for older-client compatibility. **Do NOT** emit the non-standard `X-RateLimit-*` family.
  - **Body for `/api/v1/*` routes:** JSON `{"error":"rate_limited","code":"too_many_requests","retry_after_s":<int>}`.
  - **Body for `/hx/*` routes:** empty body, plus `HX-Trigger: rate-limited` header for Alpine toast rendering. **No `/hx/*` routes exist today**; F must still implement the split (cheap insurance — when `/hx/*` lands, the contract is already in place). A code comment in the builder must name the two paths and cite DD-029.
  - **Pino observability:** every 429 emits `request.log.warn({ event: 'ratelimit.exceeded', keyHash: <first 8 hex of SHA-256 over the limiter key> }, '...')`. **Do NOT** log the raw key.
  - **Prometheus counter** (`ctrfhub_ratelimit_exceeded_total{endpoint,backend}`) is **explicitly out of scope** — no Prometheus integration exists yet; surface as a follow-up.
- A code comment on the rate-limit registration block cites `DD-012` and `DD-029` so the seam isn't silently re-reverted.
- The global auth preHandler's invalid-API-key branch (`src/app.ts:569-582`) emits a single Pino log line **before** the 401 reply. The line uses `request.log.warn` with `event: 'auth.api_key_invalid'`, an `ip: request.ip` field, and the message `"Invalid API key on x-api-token"`. The raw token value MUST NOT appear. **Implementer note on `tokenPrefix`:** finding #6's draft suggested `tokenPrefix: apiToken.slice(0, 8)` — but since `ctrf_*` tokens start with a known literal prefix, the first 8 chars leak a partial value. Match DD-029's observability convention instead: either omit the prefix entirely (correlation by IP alone) or hash the token first (`createHash('sha256').update(apiToken).digest('hex').slice(0, 8)`) and emit that as `keyHash`. F picks one and documents the choice.
- The existing SECURITY comment at `src/app.ts:567-568` ("Never log or echo the raw `x-api-token` value … Log only presence (truthy/falsy), never the token string itself") must remain — and the new log line is the implementation of "log presence" that the comment promises.
- `tsc --noEmit` clean; existing test suite passes.

**Test tiers required.**
- Unit: no.
- Integration: yes — exactly two:
  1. Force a 429 from the rate-limiter and assert the response body (for `/api/v1/*`), headers (`Retry-After`, `RateLimit-*`), and that the `event=ratelimit.exceeded` Pino line emits without the raw key. A small route under `/api/v1/` already exists (`/api/v1/projects/:slug/runs` via ingest) — or T may register a tiny test-only route at `/api/v1/__test__/rate-limit-probe`. If forcing the limiter in a test is impractical, T may stub `request.headers['x-test-force-429']` and have the `errorResponseBuilder` accept a test seam — F decides which is cleaner.
  2. POST with a bad `x-api-token` to any route guarded by the global preHandler and assert (a) the response is 401 with `code: 'INVALID_API_KEY'`, (b) a Pino log line with `event: 'auth.api_key_invalid'` was emitted, and (c) the raw token string does NOT appear in any captured log field.
- E2E: no.

**Page verification tiers.** none — `/api/*` routes are not rendered.

**Critical test paths.** The two integration tests above. Existing `src/__tests__/integration/auth.test.ts` (22 tests) and `static-asset-auth-bypass.test.ts` (31 tests) are the regression guards — they must still pass unchanged.

## Required reading

**Skills (full paths).**
- `skills/better-auth-session-and-api-tokens.md` — confirms the "log decisions, not values" posture for auth.

**Planning doc sections.**
- `docs/planning/database-design.md §DD-012` (`:1144`) — the Layer 2 rate-limit table. Row to match: line 1171 "General authenticated API | 600 req/min | session-user-id | `@fastify/rate-limit` default store".
- `docs/planning/database-design.md §DD-029` (`:3197`) — the rate-limit consolidation decision; spells out the 429 contract (point 4), enumeration-safety rule (point 5; not exercised here — no email/username-keyed limiter is touched), and the observability rule (point 7) that this story implements.
- `docs/planning/architecture.md §Backend → Rate limiting` — declares DD-012 the single canonical source for all numeric limits, keys, backends, and 429 response shape.
- `docs/planning/architecture.md §Code Conventions → Logging` (`:859`) — "the auth subsystem and ingest routes log decisions (e.g. invalid API key) without logging the token value." Finding #6's authoritative basis.

## Implementer notes (from the decomposition)

- **Care with `keyGenerator`.** Only key on `request.user?.id` *after* auth has resolved; pre-auth requests must fall back to `request.ip`. Otherwise unauthenticated traffic all keys to `undefined`, collapsing into a single shared bucket and breaking the limiter. The order matters because Fastify's `@fastify/rate-limit` plugin runs *before* the global auth preHandler — the limiter sees pre-auth state on the very first request from a session. The safe shape is `(req) => req.user?.id ?? req.apiKeyUser?.metadata?.userId ?? req.ip` so authenticated browser sessions key on user id, authenticated CI requests key on the API key's owner, and everything else falls back to IP.
- **DD-029's body shape is non-negotiable** — match it byte-for-byte. Downstream UI and CLI clients parse it.
- **`/hx/*` empty-body + HX-Trigger split.** No `/hx/*` routes exist on `main` today. Implement the split anyway — when the dashboard story lands, the contract is already correct. A `request.url.startsWith('/hx/')` discriminator in the `errorResponseBuilder` is the obvious shape; cite DD-029 in a comment so the next reader knows why.
- **High-stakes file.** `src/app.ts` is the composition root and contains the global auth preHandler. Keep the diff tight: the two changes named in the acceptance criteria, nothing else. Findings #2/#4/#7/#11 (Theme T6-β) and #3/#5/#8/#9/#10 (Theme T6-γ) are explicitly **out of scope** — they are `audit-composition-root-S2` and `-S3`. If F finds an adjacent issue, file a note in `feature-handoff.md`; do not fix it here.
- **`request.user` typing.** The brief uses `request.user?.id` as shorthand. The codebase currently augments `FastifyRequest` with `apiKeyUser` and (via Better Auth) a session user. F confirms the exact accessor at implementation time and uses whichever Better Auth-augmented property carries the session-user-id post-auth.

## Iteration tracking (for F's awareness)

This brief is F's input on **iteration 1**. On subsequent iterations F is spawned with:
- `architecture-review-<N-1>.md` (F↔A loop, iter N>1, cap 3)
- `fix-pass-notes.md` (Phase 5 fix-pass after T BLOCK)
- `spec-audit-<M-1>.md` (Phase 6b spec-remediation, cap 2; light remediation rule)

Each F invocation appends a `## Iteration <N>` (or `## Fix-pass`, `## Spec-remediation iter <M-1>`) section to `feature-handoff.md`.

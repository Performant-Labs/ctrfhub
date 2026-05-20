# Feature handoff — audit-composition-root-S1

## Iteration 1

**Date:** 2026-05-20
**Branch:** `story/audit-composition-root-S1`
**Commits added this iteration:**
- (pending, see "Commit" section below) `feat(audit-composition-root-S1): align rate-limit with DD-012/DD-029 and log invalid-API-key decision`

### What was built / fixed

1. The global `@fastify/rate-limit` registration in `src/app.ts` (step 4) now declares:
   - `enableDraftSpec: true` — switches the plugin's header family from the
     legacy `X-RateLimit-*` to the RFC 9728 draft `RateLimit-*` per DD-029
     point 4 ("non-standard `X-RateLimit-*` variant is deliberately not
     emitted").
   - `keyGenerator: (req) => req.user?.id ?? req.apiKeyUser?.referenceId ?? req.ip`
     matching DD-012's "General authenticated API | 600 req/min |
     session-user-id" row. The chain handles the pre-auth ordering trap
     (the plugin runs *before* the global auth preHandler) by falling
     through to IP for the first request from any new session.
   - `errorResponseBuilder` that shapes the JSON body for `/api/v1/*` and
     other non-`/hx/*` paths as the DD-029 canonical
     `{"error":"rate_limited","code":"too_many_requests","retry_after_s":<int>}`,
     and attaches a non-enumerable `headers: { 'HX-Trigger': 'rate-limited' }`
     property when the path starts with `/hx/`.
   - `onExceeded` that emits the DD-029 point 7 Pino structured-log line
     `event=ratelimit.exceeded` with the limiter key hashed (first 8 hex of
     SHA-256) and the endpoint method+path. No raw key is logged.
2. A paired global `onSend` hook (step 4a) detects 429 responses on `/hx/*`
   paths and rewrites the payload to zero bytes. This produces the
   "empty body + `HX-Trigger`" contract DD-029 mandates for the `/hx/*`
   row. No `/hx/*` routes exist on `main` today; the split is installed
   pre-emptively so the contract is correct when the dashboard story lands.
3. The global auth preHandler's invalid-API-key branch (step 9, ~line 569)
   now emits a single Pino `request.log.warn` line with
   `event: 'auth.api_key_invalid'` and `ip: request.ip` **before** the 401
   reply. Message: `"Invalid API key on x-api-token"`. The raw token value
   is never read into a log field. The pre-existing SECURITY comment at
   the original lines 567-568 is preserved unchanged.

### Commands run locally (results)

- `npx tsc --noEmit` — 0 errors.
- `npx vitest run src/__tests__/integration/auth.test.ts src/__tests__/integration/static-asset-auth-bypass.test.ts` — **54 passed, 0 failed** (the two named "regression guard" suites from the brief's Critical test paths). `auth.test.ts` has 23 tests on `main`, not 22 as the brief estimates; both files are clean.
- `npm test` — 495 passed, 4 failed. **The 4 failures are intentional contract drift in tests that pre-date DD-029** — see "Known issues / follow-ups" below. T owns aligning these.
- Dev server not exercised this pass (no DI seam touched; the changes are observable via the integration suite's `app.inject` path).

### Files created or modified

- `src/app.ts` — only file touched.
  - Added `import { createHash } from 'node:crypto'` (line 28).
  - Replaced the rate-limit registration block (step 4, ~lines 226-229 in the pre-change file) with the DD-012/DD-029-aligned `keyGenerator` + `errorResponseBuilder` + `onExceeded` configuration plus inline citation comments.
  - Added the new step 4a `onSend` hook to enforce empty-body for `/hx/*` 429 responses.
  - Inserted the `request.log.warn({ event: 'auth.api_key_invalid', ip })` line in the API-key invalid branch (step 9), immediately before the existing `return reply.status(401).send(...)`.

No new files created. No migration files needed (no entity changes).

### Decisions not covered by planning docs

These were the two F-picks the brief explicitly hands to the implementer.

1. **`keyGenerator` post-auth accessor chain.** I used
   `request.user?.id ?? request.apiKeyUser?.referenceId ?? request.ip`.
   The brief sketched `request.user?.id ?? request.apiKeyUser?.metadata?.userId ?? request.ip`,
   but the actual `ApiKeyUser` interface in `src/auth.ts` carries the
   owner's user-id on `referenceId` (Better Auth 1.x's canonical
   user-id field on an apikey row — the interface's JSDoc says so
   explicitly: *"`referenceId` is the userId that owns the key
   (Better Auth 1.x renamed `userId` → `referenceId`)"*).
   `metadata.userId` is only present if we explicitly set it at key
   creation — which the code in `src/auth.ts` does not do, and which
   no skill / planning doc mandates. `referenceId` is the type-safe,
   library-canonical accessor; it preserves the brief's intent
   (authenticated CI requests get their own per-owner bucket, not a
   collapsed bucket keyed on IP).
2. **API-key invalid-log token-prefix handling.** I picked the
   **omit entirely** branch the brief offered. Reasoning:
   - The brief itself warns that `apiToken.slice(0, 8)` leaks a partial
     value because `ctrf_*` tokens have a known literal 5-char prefix.
   - A hashed-prefix variant (parallel to the 429 observability hash)
     was considered but rejected for S1: it adds correlator ambiguity
     ("is this a key hash or a user hash?") and an operator cannot
     usefully correlate two separate invalid-key submissions of *the
     same wrong key* across requests when the real diagnostic value is
     "what client is sending this?". IP gives that diagnostic directly.
   - DD-029 point 7's guidance is "no raw emails or IPs" in the
     limiter-exceeded log specifically (because that log can fire
     thousands of times under attack); the auth-failure log is a
     once-per-CI-misconfiguration event where `request.ip` is the
     primary actionable field. The two log lines therefore have
     different log-volume profiles and different right-shapes.
   - **If A or T disagrees**, switching to `keyHash: createHash('sha256').update(apiToken).digest('hex').slice(0, 8)` is a one-line change — the import is already present.

### Findings addressed

N/A — this is iteration 1 from `brief.md`, not a review-driven iteration.

### Known issues / follow-ups

- **Four pre-DD-029 tests now fail** by intentionally asserting the legacy `X-RateLimit-*` header family that DD-029 explicitly forbids:
  - `src/__tests__/integration/health.test.ts` lines 177-190 — three tests in the `rate-limit headers` describe block asserting `x-ratelimit-limit` / `x-ratelimit-remaining`.
  - `src/__tests__/integration/layout.test.ts` line 190 — one test asserting `x-ratelimit-limit: 600`.

  These were written before DD-029 codified the contract. **T must update them in Phase 4** to assert the DD-029-correct draft-spec family: `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, and `retry-after`. The lowercase form is what `enableDraftSpec: true` emits (see `node_modules/@fastify/rate-limit/index.js:20-25`).

  The brief's Critical test paths section names only `auth.test.ts` and `static-asset-auth-bypass.test.ts` as "regression guards [that] must still pass unchanged" — those still do (54/54). The brief did not enumerate `health.test.ts` / `layout.test.ts` as regression guards, which is consistent with their assertions being targets for the contract update.
- **No Prometheus counter** (`ctrfhub_ratelimit_exceeded_total{endpoint,backend}`). DD-029 point 7 mentions it but the brief explicitly scopes it out: *"Prometheus counter is **explicitly out of scope** — no Prometheus integration exists yet; surface as a follow-up."* This block will gain the increment alongside whichever future story wires Prometheus.
- **No `/hx/*` routes exist today.** The path discriminator in the `errorResponseBuilder` and the paired `onSend` empty-body rewrite are installed pre-emptively per the brief's instruction. When the first `/hx/*` route lands (probably the dashboard story), an integration test for the empty-body contract becomes possible and should be added.
- **Two other audit themes deferred**, per the brief: findings #2/#4/#7/#11 (Theme T6-β) → story `audit-composition-root-S2`; findings #3/#5/#8/#9/#10 (Theme T6-γ) → story `audit-composition-root-S3`. I did not touch any code outside the two named edit sites in `src/app.ts`.

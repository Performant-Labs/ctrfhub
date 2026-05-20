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

## Iteration 2

**Date:** 2026-05-20
**Branch:** `story/audit-composition-root-S1`
**Commits added this iteration:**
- `c49ba70` fix(audit-composition-root-S1): address arch review iter 1

### What was built / fixed

Iter-1 A review (BLOCK) raised 1 block + 2 warns + 1 nit, all centred on
`src/app.ts` step 4 (rate-limit registration block, `errorResponseBuilder`
and `onExceeded` hooks). All four findings addressed in this single commit.
The keyGenerator chain, `enableDraftSpec: true`, the `errorResponseBuilder`+
`onSend` pairing, the auth-failure log line, the SECURITY comment, and the
two F-picks A ratified (referenceId accessor; IP-only correlation in the
auth-failure log) were not touched.

1. **Block #1 — `statusCode` leak into the JSON body** (`src/app.ts:292-316`).
   The iter-1 body literal included `statusCode: 429` as an enumerable key,
   producing a four-key JSON serialization. DD-029 (`database-design.md:1191-1198`
   and `:3208`) pins the wire body to exactly three keys: `error`, `code`,
   `retry_after_s`. A's prescribed fix applied verbatim — set `statusCode`
   non-enumerably via `Object.defineProperty`, mirroring the existing pattern
   for `headers`. The TS literal type also drops `statusCode` (Nit #4) so the
   typed view of `body` matches the wire-format view; the runtime-only
   property is documented in the block comment immediately above.

   New body construction (verbatim, `src/app.ts:292-327`):

   ```ts
   // DD-029 (`docs/planning/database-design.md:1191-1198`) fixes the
   // serialized body to exactly three keys: `error`, `code`,
   // `retry_after_s`. The TypeScript literal type matches the wire-format
   // view. `statusCode` is set non-enumerably below because Fastify's
   // `setErrorStatusCode` reads `err.statusCode` off the thrown body to
   // set the reply code (`node_modules/fastify/lib/error-handler.js`), but
   // it must not appear in the JSON serialization.
   const body: {
     error: string;
     code: string;
     retry_after_s: number;
   } = {
     error: 'rate_limited',
     code: 'too_many_requests',
     retry_after_s: retryAfterS,
   };

   // `statusCode` is read by Fastify's `setErrorStatusCode` via direct
   // property access (not iteration), so making it non-enumerable keeps
   // it out of the JSON-serialized body while still driving the reply
   // status code. Same trick as `headers` below.
   Object.defineProperty(body, 'statusCode', {
     value: 429,
     enumerable: false,
   });

   if (isHxRoute) {
     // `headers` is read by Fastify's `setErrorHeaders` via direct property
     // access (not iteration), so making it non-enumerable keeps it out of
     // the JSON-serialized body. The paired `onSend` hook below rewrites
     // the `/hx/*` body to empty bytes per the DD-029 `/hx/*` row.
     Object.defineProperty(body, 'headers', {
       value: { 'HX-Trigger': 'rate-limited' },
       enumerable: false,
     });
   }

   return body;
   ```

   Independently verified via a Node REPL one-shot construction:
   `Object.keys(body)` returns `[ 'error', 'code', 'retry_after_s' ]`;
   `JSON.stringify(body)` returns
   `{"error":"rate_limited","code":"too_many_requests","retry_after_s":42}`;
   `body.statusCode` and `body.headers` are still accessible to Fastify via
   direct property access. The `/api/v1/*` 429 JSON now has **exactly 3 keys**.

2. **Warn #2 — missing `limit` / `backend` in observability log** and
   **Warn #3 — `keyHash` → `key_hash`** (`src/app.ts:331-349`). DD-029
   point 7 (`database-design.md:1233-1241`) specifies the canonical
   five-field shape with `limit` (numeric `max` for this route's row in the
   DD-012 table — global default 600 over a 1-minute window → `"600/1m"`)
   and `backend` (the library identifier — global registration uses the
   library default store → `"fastify-rate-limit"`, matching the DD's
   verbatim sample at `:1240`). All field names snake_case per the DD's
   canonical sample and Pino convention.

   New Pino log line (verbatim, `src/app.ts:331-349`):

   ```ts
   onExceeded: (request: FastifyRequest, key: string) => {
     // DD-029 point 7 (`docs/planning/database-design.md:1233-1241`): hash
     // the limiter key (first 8 hex of SHA-256) so repeat-offender patterns
     // surface in the log without leaking raw IPs / user-ids / token-ids.
     // Field names are snake_case per DD-029's canonical sample; `limit`
     // and `backend` are derived from this registration block (max=600,
     // timeWindow='1 minute' → "600/1m"; library default store →
     // "fastify-rate-limit").
     const keyHash = createHash('sha256').update(String(key)).digest('hex').slice(0, 8);
     request.log.warn(
       {
         event: 'ratelimit.exceeded',
         endpoint: `${request.method} ${request.url.split('?')[0] ?? ''}`,
         key_hash: keyHash,
         limit: '600/1m',
         backend: 'fastify-rate-limit',
       },
       'Rate limit exceeded',
     );
   },
   ```

3. **Nit #4 — cosmetic: TS literal type vs runtime-only properties.**
   Addressed inline as part of the Block #1 fix (the literal type for
   `body` now declares only the three DD-029 wire-format keys; `statusCode`
   and `headers` are assigned via `Object.defineProperty` and documented
   in the block comment). A flagged this as "cosmetic; tackle as part of
   the Finding #1 fix" — done.

### Commands run locally (results)

- `npx tsc --noEmit` — 0 errors.
- `npx vitest run src/__tests__/integration/auth.test.ts src/__tests__/integration/static-asset-auth-bypass.test.ts` — **54 passed, 0 failed** (both regression-guard suites still green; no new regressions from the iter-2 edits).
- `npm test` — 495 passed, 4 failed. **Same 4 failures as iter 1** (the pre-DD-029 `X-RateLimit-*` assertions in `health.test.ts:177-190` and `layout.test.ts:188-191`). No new test failures introduced by iter 2.
- Node REPL one-shot (independent of test infra) confirmed `Object.keys(body)` = `['error','code','retry_after_s']` and `JSON.stringify(body)` matches DD-029's byte-for-byte body exactly.
- Dev server not exercised — same rationale as iter 1 (no DI seam touched; behaviour observable via the integration suite's `app.inject` path).

### Files created or modified

- `src/app.ts` — only file touched. Iter-2 edits are localised to two adjacent blocks:
  - **Lines 292-327** — `errorResponseBuilder`'s `body` construction. TS literal type narrowed from 4 keys to 3; new `Object.defineProperty(body, 'statusCode', { value: 429, enumerable: false })` call inserted between the literal and the existing `/hx/*` `headers` branch; updated explanatory comment cites `database-design.md:1191-1198` and the Fastify direct-property-access mechanic.
  - **Lines 331-349** — `onExceeded` Pino log fields. Renamed `keyHash` → `key_hash`; added `limit: '600/1m'` and `backend: 'fastify-rate-limit'`; updated explanatory comment cites `database-design.md:1233-1241` and explains how `limit` / `backend` are derived from the registration block.

No new files created. No migration files needed (no entity changes). The `import { createHash } from 'node:crypto'` line and the rest of step 4 (`max`, `timeWindow`, `enableDraftSpec`, `keyGenerator`) and step 4a (the paired `onSend` hook) are unchanged from iter 1.

### Decisions not covered by planning docs

- **`backend` field value: `"fastify-rate-limit"` (no `@` prefix).** A's iter-1 review (Finding #2 suggested fix) prescribes `'fastify-rate-limit'`, matching DD-029's verbatim canonical sample at `database-design.md:1240`. The iter-2 brief sketched the value as `"@fastify/rate-limit"` (one of an enumerated list with the npm package name's `@scope/` prefix), but the brief explicitly told the implementer that DD-029 is authoritative when the brief abbreviates. I followed DD-029's literal text. If A wants the `@`-prefixed npm-package-name form instead, that's a one-line fix.

### Findings addressed

| Source row | File:line | What you changed | Status |
|---|---|---|---|
| #1 (block) | `src/app.ts:292-316` | Made `statusCode` non-enumerable on the rate-limit error body; narrowed the TS literal type to the three DD-029 wire-format keys. Body now serializes to exactly `{"error":"rate_limited","code":"too_many_requests","retry_after_s":N}`. | resolved |
| #2 (warn) | `src/app.ts:341-347` | Added `limit: '600/1m'` and `backend: 'fastify-rate-limit'` to the Pino `event=ratelimit.exceeded` log fields. | resolved |
| #3 (warn) | `src/app.ts:344` | Renamed log field `keyHash` → `key_hash` (snake_case per DD-029 canonical sample). | resolved |
| #4 (nit) | `src/app.ts:299-303` | Dropped `statusCode` from the TS literal type for `body`; both runtime-only properties (`statusCode`, `headers`) now set via `Object.defineProperty` so the typed view matches the wire-format view. | resolved |

### Known issues / follow-ups

- **Same four pre-DD-029 tests still fail** (carried forward from iter 1): three in `src/__tests__/integration/health.test.ts:177-190` and one in `src/__tests__/integration/layout.test.ts:188-191`, all asserting the legacy `X-RateLimit-*` header family that DD-029 explicitly forbids. **T owns aligning these in Phase 4** to assert the draft-spec family (`ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after`, lowercase per Node header convention). No iter-2 code change affects these failures — they are pre-existing contract drift in the test layer, not new regressions.
- **No Prometheus counter** — unchanged from iter 1; explicitly scoped out by the brief. Tracked for a future story.
- **No `/hx/*` routes exist today** — unchanged from iter 1. The path discriminator and paired `onSend` empty-body rewrite are installed pre-emptively per the brief.
- The two deferred audit themes (`audit-composition-root-S2`, `audit-composition-root-S3`) remain untouched. Scope discipline preserved.


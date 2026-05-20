# Architecture review — audit-composition-root-S1 — iteration 1

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-20
**Verdict:** BLOCK
**Diff base:** main @ b483f2b6
**Diff head:** story/audit-composition-root-S1 @ cddda53e

## Summary

One `block`-severity drift from DD-029's "byte-for-byte" body contract: the
`/api/v1/*` 429 response carries an extra enumerable `statusCode: 429` field
that DD-029 (`:1191-1198`, also restated in §DD-029 point 4 at `:3208`) does
not include. F correctly identified that `Object.defineProperty` with
`enumerable: false` keeps a property out of JSON serialization (and used the
trick for `headers`), but did not apply the same trick to `statusCode`,
which Fastify's `setErrorStatusCode` reads off the thrown body to set the
reply code. Two related observability-shape `warn`s also surface where F's
log fields track the brief's abbreviated shape instead of DD-029's broader
canonical shape. Everything else is in order: the `keyGenerator` chain,
`enableDraftSpec: true`, the `errorResponseBuilder`+`onSend` pairing, the
auth-failure log placement, and the high-stakes-file scope discipline are
all correct.

## Findings

| # | Severity | File:line | Drift dimension | Finding | Suggested fix |
|---|---|---|---|---|---|
| 1 | block | `src/app.ts:292-302` | pattern consistency / spec contract | The 429 response body for `/api/v1/*` (and any non-`/hx/*` path) serializes as `{"statusCode":429,"error":"rate_limited","code":"too_many_requests","retry_after_s":<int>}`. DD-029 (`docs/planning/database-design.md:1191-1198` and `:3208`) and the brief (line 27) both spell the contract as exactly three keys: `error`, `code`, `retry_after_s`. The `statusCode` field is needed at the JS-object level because Fastify's `setErrorStatusCode` (`node_modules/fastify/lib/error-status.js:9`) reads `err.statusCode` off the thrown body to set the reply code — but it must be hidden from JSON serialization. F already proved they know the trick: `headers` is set non-enumerably at `src/app.ts:309-312` for exactly this reason. | Apply the same `Object.defineProperty(body, 'statusCode', { value: 429, enumerable: false })` pattern to `statusCode`. The TS type literal at lines 292-297 should drop `statusCode` and document the runtime-only property in the comment. Confirm with an `app.inject` call in the integration tests T writes that the serialized body is exactly three keys. |
| 2 | warn | `src/app.ts:317-330` | pattern consistency / spec contract | The `event=ratelimit.exceeded` log line emits three fields (`event`, `keyHash`, `endpoint`) but DD-029's observability sample at `docs/planning/database-design.md:1233-1241` declares five (`event`, `endpoint`, `key_hash`, `limit`, `backend`). F followed the brief's abbreviated shape (brief line 29 only mentions `event` and `keyHash`), but the canonical spec is the DD. Missing `limit` (`"600/1m"` for this row) and `backend` (`"fastify-rate-limit"`) make the log line harder to filter when multiple rate-limit rows eventually fire from different backends. | Add `limit: '600/1m'` and `backend: 'fastify-rate-limit'` to the log fields. Both are derivable from the registration block; no extra plumbing needed. |
| 3 | warn | `src/app.ts:322-329` | naming | The log field is named `keyHash` (camelCase) but DD-029's sample (`docs/planning/database-design.md:1238`) names it `key_hash` (snake_case). The brief uses `keyHash` (line 29), so F was following the brief — but the canonical spec is the DD, and the DD's snake_case matches the rest of the structured-log shape (`event` is not `Event`; this is Pino convention). | Rename to `key_hash`. Same change inside the auth-failure log at `src/app.ts:725-731` is N/A — that line uses `ip` which is already lowercase and unambiguous. |
| 4 | nit | `src/app.ts:285-316` | abstraction level | The `errorResponseBuilder` `body` declares `statusCode` in its TypeScript literal type (line 292-297) but the post-fix shape (Finding #1) will set it via `Object.defineProperty`. The TS literal will then have a runtime-only key not declared in the type. Consider keeping the literal type to the three DD-029 fields (`{ error, code, retry_after_s }`) and assigning the `statusCode`/`headers` properties via `Object.defineProperty` calls, so the TS view of the body matches the wire-format view. | Cosmetic; tackle as part of the Finding #1 fix. |

## Prior-iteration check (iteration > 1 only)

N/A — this is iteration 1.

## F-pick rulings (Orchestrator-requested)

1. **`keyGenerator` accessor — `request.apiKeyUser?.referenceId` (F's pick).** **Concur.** Verified against `src/auth.ts:62-74`: the `ApiKeyUser` interface declares `referenceId: string` as required, with the JSDoc at lines 63-65 explicitly stating *"`referenceId` is the userId that owns the key (Better Auth 1.x renamed `userId` → `referenceId`)"*. The brief's `metadata?.userId` was a sketch — `metadata` is typed `Record<string, unknown> | null` and is not populated by `src/auth.ts`'s apikey-creation code. F's pick is the type-safe, library-canonical accessor and preserves the brief's intent (per-CI-owner buckets, not collapsed-to-IP buckets) better than the sketch would.

2. **Auth-failure log token-shape — prefix omitted, IP-only correlation (F's pick).** **Concur.** F's three-part argument is sound: (a) the brief explicitly flagged that `apiToken.slice(0, 8)` leaks a known literal prefix; (b) the auth-failure log is a once-per-misconfig event where IP is the actionable correlator, not a high-volume stream where hash-based correlation matters; (c) the hashed-prefix variant would invite the "is this a key hash or a user hash?" ambiguity at the log-grep level. The decision is documented at `src/app.ts:713-724` and in the handoff. A symmetric hashed-prefix shape (parallel to the 429 line) is defensible too, but not enough leverage to demand it; F's choice is the simpler one. Not a finding.

## `errorResponseBuilder` + `onSend` pairing

**Acceptable, well-explained.** The pairing is structurally necessary: `errorResponseBuilder`'s return value is JSON-serialized by Fastify's default error path (`node_modules/fastify/lib/error-handler.js:100` → `reply.send(error)`), so the builder alone cannot produce a zero-byte body. Only a downstream hook can rewrite the payload bytes, and `onSend` is the right altitude (the alternative — a custom error handler at the app level — would have broader blast radius). F's comments at `src/app.ts:333-346` cross-reference the builder and explain *why* the split exists; the narrow trigger (`status 429 AND path-prefix /hx/`) keeps the hook a no-op for every other response. The mild altitude split (header set in builder, body stripped in `onSend`) is the cost of working with the plugin's "builder must return JSON" contract; it is not drift.

One subtlety verified manually: F's use of `Object.defineProperty(body, 'headers', { value: ..., enumerable: false })` works because `Fastify`'s `setErrorHeaders` (`node_modules/fastify/lib/error-handler.js:158-160`) reads `error.headers` via direct property access (works regardless of enumerable), then calls `reply.headers(error.headers)` which iterates the *inner* object's keys — those are plain-literal enumerable. So `HX-Trigger: rate-limited` lands on the reply correctly while staying out of the JSON body. This is the same pattern Finding #1 asks F to apply to `statusCode`.

## Notes for the implementer (BLOCK only)

To clear Finding #1, change the `body` construction so `statusCode` is set non-enumerably, mirroring the `headers` pattern F already wrote:

```ts
const body = {
  error: 'rate_limited',
  code: 'too_many_requests',
  retry_after_s: retryAfterS,
};
Object.defineProperty(body, 'statusCode', { value: 429, enumerable: false });
if (isHxRoute) {
  Object.defineProperty(body, 'headers', {
    value: { 'HX-Trigger': 'rate-limited' },
    enumerable: false,
  });
}
return body;
```

The TypeScript literal type that declared `statusCode` should also drop it (Finding #4). The integration test T writes for the brief's "Test tiers required" item 1 should assert `Object.keys(JSON.parse(res.payload))` is exactly `['error', 'code', 'retry_after_s']` — that locks in the DD-029 byte-for-byte contract going forward.

Findings #2 and #3 (warn) do not block, but tackling them in the same fix-pass is cheap and brings the observability log to canonical shape.

## Patterns referenced

- `docs/planning/database-design.md §DD-012` (`:1144-1243`) — Layer 2 table, 429 response contract, observability sample.
- `docs/planning/database-design.md §DD-029` (`:3197-3239`), specifically point 4 (`:3208`) — body shape and header family.
- `docs/planning/architecture.md §Code Conventions → Logging` (`:855-859`) — "log decisions, not values" rule for auth.
- `src/auth.ts:62-82` — `ApiKeyUser` interface declares `referenceId: string` as the canonical owner-id field; basis for F-pick 1 ruling.
- `node_modules/@fastify/rate-limit/index.js:20-25, 314-334` — confirms `enableDraftSpec: true` switches the header family to `ratelimit-*` and the plugin throws the `errorResponseBuilder` return value as the error.
- `node_modules/fastify/lib/error-handler.js:82-100, 152-168` — confirms the default error handler reads `error.headers` (enumerable-agnostic) and `error.statusCode`, then calls `reply.send(error)` (which JSON-serializes enumerable keys only); basis for Finding #1.

## Out of scope but noticed (informational, not findings against F)

- **Four pre-DD-029 tests fail by asserting the legacy `X-RateLimit-*` header family.** `src/__tests__/integration/health.test.ts:177-190` (three tests) and `src/__tests__/integration/layout.test.ts:188-191` (one test) lock in the wrong contract that DD-029 explicitly forbids. F correctly did not edit them (F never edits tests). These are **T's territory in Phase 4** — T must update them to assert the DD-029 draft-spec family (`ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after` — lowercase per Node.js header convention). Not a finding against F's code change; routed to T.
- **Auth preHandler is still registered as `addHook('onRequest', ...)` (`src/app.ts:627`).** The `onRequest` → `preHandler` rename is S3 scope, not S1, and the brief's "high-stakes-file hygiene" item names this explicitly. Untouched — correct.
- **`/assets/*` bypass intact (`src/app.ts:636-638`), empty-users branch intact (`src/app.ts:640-679`), session/HTMX-401/skipAuth branches intact.** The SECURITY comment at `src/app.ts:693-694` is unchanged. The diff is laser-tight: imports + step 4 rewrite + new step 4a hook + step 9 log line. Findings #2/#4/#7/#11 (Theme T6-β, story S2) and #3/#5/#8/#9/#10 (Theme T6-γ, story S3) are untouched — confirmed by reading the whole `src/app.ts` diff. Scope discipline is excellent.

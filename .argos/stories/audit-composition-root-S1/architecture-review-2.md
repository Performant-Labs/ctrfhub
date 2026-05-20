# Architecture review — audit-composition-root-S1 — iteration 2

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-20
**Verdict:** PASS
**Diff base:** main @ b483f2b6
**Diff head:** story/audit-composition-root-S1 @ 864c2b2f

## Summary

All four iter-1 findings (1 block + 2 warn + 1 nit) are cleanly addressed in
the single iter-2 fix commit `864c2b2`. The 429 JSON body now serializes to
exactly the three DD-029 keys (`error`, `code`, `retry_after_s`) byte-for-byte,
with `statusCode` set non-enumerably so Fastify's `setErrorStatusCode` still
reads it via direct property access. The Pino observability log line now
carries the full DD-029 canonical five-field shape with snake_case names. The
iter-2 delta is laser-tight — exactly the lines named in the iter-1 review,
with nothing else touched.

## Findings

No drift detected.

## Prior-iteration check

| Iter-1 row | Severity | Status | Evidence |
|---|---|---|---|
| #1 | block | resolved | `src/app.ts:299-316` — TS literal type narrowed to the three DD-029 keys; `Object.defineProperty(body, 'statusCode', { value: 429, enumerable: false })` mirrors the existing `headers` pattern. Empirically verified: `Object.keys(body)` = `['error','code','retry_after_s']`; `JSON.stringify(body)` = `{"error":"rate_limited","code":"too_many_requests","retry_after_s":42}`. `body.statusCode` is still readable via direct property access; `node_modules/fastify/lib/error-status.js:9` confirms `setErrorStatusCode` uses `err.statusCode` (direct), not iteration, so `enumerable: false` is the right knob (`writable: false` would have been a mis-fix). |
| #2 | warn | resolved | `src/app.ts:344-346` — added `limit: '600/1m'` and `backend: 'fastify-rate-limit'` to the Pino fields. Both values match `database-design.md:1233-1241` canonical sample. |
| #3 | warn | resolved | `src/app.ts:344` — `keyHash` → `key_hash`, matching DD-029's `:1238` snake_case form and Pino-convention field naming. The `endpoint` and `event` fields were already lowercase, so the whole structured-log payload is now consistently cased. |
| #4 | nit | resolved | `src/app.ts:299-303` — the TS literal type for `body` now declares only `{ error, code, retry_after_s }`; both runtime-only properties (`statusCode`, `headers`) are assigned via `Object.defineProperty` and documented in the block comment immediately above. The typed view matches the wire-format view. |

## Iter-2-specific verifications

1. **DD-029 byte-for-byte body shape.** Reproduced F's construction in a
   throwaway Node REPL: `JSON.stringify(body)` produces exactly
   `{"error":"rate_limited","code":"too_many_requests","retry_after_s":42}`
   — three keys, no `statusCode`, no `headers`. Matches
   `database-design.md:1191-1198` to the byte.

2. **Non-enumerable but readable.** Confirmed `body.statusCode === 429` via
   direct property access in the same REPL. Confirmed Fastify's
   `setErrorStatusCode` at `node_modules/fastify/lib/error-status.js:9` reads
   `err.statusCode || err.status` (direct, not via iteration), so
   `enumerable: false` keeps the field out of JSON serialization while still
   letting Fastify drive the reply code to 429. The same mechanic was
   independently verified for `headers` in the iter-1 review and remains
   correct here.

3. **`/api/v1/*` (non-`/hx/*`) path.** In the non-hx branch, the body has no
   `headers` property at all (the `if (isHxRoute)` guard skips that
   `defineProperty` call), so Fastify's `setErrorHeaders` is a no-op for
   `/api/v1/*` responses and the `HX-Trigger` header does not leak onto
   non-HTMX clients. Verified by mimicking the non-hx branch in the REPL —
   `body.headers === undefined`.

4. **Observability shape.** The log line at `src/app.ts:340-348` emits
   exactly five fields plus the message string: `event`, `endpoint`,
   `key_hash`, `limit`, `backend`. Matches DD-029's canonical sample at
   `:1233-1241` field-for-field, in casing and in count. Raw key still
   hashed (first 8 hex of SHA-256 over `String(key)`); raw IP / user-id /
   token-id never enter the log payload.

5. **`backend` value choice (F-pick).** **Concur with F's
   `"fastify-rate-limit"`.** DD-029's verbatim canonical sample at
   `database-design.md:1240` literally reads `"backend": "fastify-rate-limit"`
   — no `@` prefix, no `/`. F correctly applied the brief's escape-hatch
   ("DD-029 is authoritative when the brief abbreviates") and the iter-1
   review's prescribed fix (Finding #2 suggested `'fastify-rate-limit'`
   verbatim). The npm-package-name form `"@fastify/rate-limit"` would have
   been defensible (and ergonomically grep-able for "which library is
   emitting this row?"), but DD-029 declares the field a *backend identifier*,
   not a package name, and pins the string. F's choice is the right one.

## Iter-1 ratifications — regression check

All seven items the iter-1 review ratified or otherwise validated are intact:

- **`keyGenerator` chain** (`src/app.ts:274-284`) — `request.user?.id ?? request.apiKeyUser?.referenceId ?? request.ip` unchanged.
- **`enableDraftSpec: true`** (`src/app.ts:273`) — unchanged.
- **`errorResponseBuilder` + `onSend` pairing** (`src/app.ts:285-329` builder, `:367-375` onSend) — pairing structurally identical; only the body-construction sub-block was modified.
- **Auth-failure log line** (`src/app.ts:745-751`) — `event=auth.api_key_invalid`, `ip: request.ip`, message `"Invalid API key on x-api-token"`. No token prefix, no hash. Untouched from iter-1.
- **SECURITY comment** (`src/app.ts:713-714`) — verbatim *"SECURITY: Never log or echo the raw `x-api-token` value. Log only presence (truthy/falsy), never the token string itself."* — unchanged.
- **`addHook('onRequest', ...)`** for the global auth preHandler (`src/app.ts:647`) — still `onRequest`, not renamed to `preHandler` (correctly deferred to S3 per the brief).
- **`/assets/*` bypass, empty-users branch, session/HTMX-401/skipAuth branches** — all unchanged (read full file 220-380 and 700-780; only the four targeted lines moved).

`git diff cddda53..864c2b2 -- src/app.ts` confirms the iter-2 delta is exactly
the four findings (32 insertions, 4 deletions, all clustered in the body
construction and `onExceeded` blocks). No drive-by edits.

## Scope discipline

- Diff scope is `src/app.ts` + `.argos/stories/audit-composition-root-S1/{brief.md,feature-handoff.md}` per `git diff main..story/audit-composition-root-S1 --stat`. No creep into S2 (Theme T6-β) or S3 (Theme T6-γ) territory.
- F did not commit an `architecture-review-1.md` to the branch (it lives in `.argos/stories/audit-composition-root-S1/` in the working tree but isn't in the diff against `main`). Either way, no source code outside the named edit sites was touched.

## Local verification (read-only)

- `npx tsc --noEmit` — 0 errors.
- `npx vitest run src/__tests__/integration/auth.test.ts src/__tests__/integration/static-asset-auth-bypass.test.ts` — 54 passed, 0 failed. Both regression-guard suites still green.
- `node -e "..."` REPL one-shot independently confirmed the body-key set, JSON serialization byte-shape, and direct-property-access readability of `statusCode` and `headers`.
- Four pre-existing test failures in `health.test.ts:177-190` (three) and `layout.test.ts:188-191` (one) that assert the legacy `X-RateLimit-*` header family are **T's territory in Phase 4** per the iter-2 prompt and the iter-1 "Out of scope but noticed" entry. They are tests that lock in a pre-DD-029 contract F's code has correctly stopped emitting, not regressions caused by F.

## Patterns referenced

- `docs/planning/database-design.md §DD-029` (`:1191-1198` body shape, `:1233-1241` observability sample) — primary spec.
- `docs/planning/database-design.md §DD-012` (`:1144-1243`) — Layer 2 row and rate-limit contract.
- `node_modules/fastify/lib/error-status.js:7-12` — confirms `setErrorStatusCode` uses direct `err.statusCode` property access; basis for the `enumerable: false` (not `writable: false`) choice.
- `node_modules/fastify/lib/error-handler.js:84` — confirms `setErrorStatusCode(reply, error)` is called on every error flow; basis for needing `statusCode` accessible at all.
- `src/auth.ts:62-82` — `ApiKeyUser.referenceId` accessor for the `keyGenerator` chain (iter-1 ratification).

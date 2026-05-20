# [audit-composition-root-S1] Align composition-root rate-limit + auth-failure logging with DD-012 / DD-029

## Summary

Brings two slices of `src/app.ts` into conformance with the canonical rate-limit
spec (DD-012 / DD-029):

1. The global `@fastify/rate-limit` registration now declares a DD-012-correct
   `keyGenerator` and an `errorResponseBuilder`+`onSend` pair that emits the DD-029
   429 contract byte-for-byte (RFC 9728 draft `RateLimit-*` headers + `Retry-After`;
   `/api/v1/*` 3-key JSON body; `/hx/*` empty-body + `HX-Trigger: rate-limited`
   header; Pino `event=ratelimit.exceeded` with hashed key; no `X-RateLimit-*`).
2. The global auth preHandler's invalid-API-key branch now emits a single Pino
   `event=auth.api_key_invalid` log line before the 401 (IP-only correlation; raw
   token never logged). Implements the "log decisions without the value" rule that
   `architecture.md §Code Conventions → Logging` line 859 names as canonical.

Decomposed from the `audit-composition-root` architecture audit (Theme T6-α —
findings #1 + #6; PR #84).

## Acceptance criteria

- [x] `keyGenerator: (req) => req.user?.id ?? req.apiKeyUser?.referenceId ?? req.ip` — matches DD-012 row "General authenticated API | 600 req/min | session-user-id" (`database-design.md:1171`)
- [x] `errorResponseBuilder` emits the DD-029 contract for `/api/v1/*`: body `{"error":"rate_limited","code":"too_many_requests","retry_after_s":<int>}` — exactly three keys (no `statusCode` leak); headers `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` + `Retry-After`; **no** `X-RateLimit-*` legacy headers
- [x] `/hx/*` branch: empty body + `HX-Trigger: rate-limited` header (pre-emptive — no `/hx/*` routes ship today; contract is in place for when they do)
- [x] Pino `event=ratelimit.exceeded` line with snake_case fields `key_hash` (first 8 hex of SHA-256), `limit` ("600/1m"), `backend` ("fastify-rate-limit"), `endpoint`
- [x] Auth invalid-API-key branch emits `event=auth.api_key_invalid` Pino warn with `ip` and message `"Invalid API key on x-api-token"`; raw token absent from every log field; SECURITY comment at `app.ts:567-568` unchanged
- [x] Code comments on both edit sites cite DD-012 / DD-029
- [x] `tsc --noEmit` clean
- [x] Full test suite: **512/512 passing** (was 495/499; the 4 pre-existing `X-RateLimit-*` assertions in `health.test.ts` / `layout.test.ts` were locked in against the pre-DD-029 contract and have been updated to the draft-spec headers with inline DD-029 citations — same intent, corrected contract)

## Test tiers

| Layer | Declared in brief | Present in diff | Notes |
|---|---|---|---|
| Unit | no | N/A | No pure-function logic added |
| Integration | yes | ✓ | **13 new tests** in `src/__tests__/integration/rate-limit-and-auth-log.test.ts` — 9 for the DD-029 429 contract, 4 for the invalid-API-key observability |
| E2E | no | N/A | No rendered route changed |

## Page verification tiers

None — neither edit site touches a rendered route. T1/T2/T2.5/T3 all N/A.

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | BLOCK (1 block, 2 warn, 1 nit) | `.argos/stories/audit-composition-root-S1/architecture-review-1.md` |
| 2 | PASS (0 block, 0 warn, 0 nit) | `.argos/stories/audit-composition-root-S1/architecture-review-2.md` |

Iter-1 block: `errorResponseBuilder` emitted `statusCode` as an enumerable JSON field, making `/api/v1/*` bodies 4 keys instead of DD-029's byte-for-byte 3. Iter-2 (`864c2b2`) applied `Object.defineProperty(body, 'statusCode', { value: 429, enumerable: false })` mirroring the same pattern F had already used for `headers`. The 2 warns (Pino log missing `limit`/`backend`; `keyHash` → `key_hash`) were rolled into the same fix-pass.

## Decisions that deviate from spec

- **`keyGenerator` accessor — `request.apiKeyUser?.referenceId` over the brief's `metadata?.userId` shorthand.** `ApiKeyUser` in `src/auth.ts:67-74` declares `referenceId: string` as Better Auth 1.x's renamed canonical owner-user-id field; `metadata.userId` is only present if explicitly set at key creation, which the codebase does not do. A iter-1 + A iter-2 concurred. (Documented in `feature-handoff.md` and `architecture-review-1.md`.)
- **Auth-failure log token shape — prefix omitted, IP-only correlation.** Finding #6's draft suggested `tokenPrefix: apiToken.slice(0, 8)` but `ctrf_*` tokens begin with a known literal prefix, so a raw 8-char slice would leak a partial value. F chose IP-only correlation as the low-volume diagnostic shape; a symmetric hashed-prefix variant remains a one-line follow-up if you prefer it. A iter-1 + A iter-2 concurred.
- **`backend` field value `"fastify-rate-limit"` (matching DD-029's verbatim sample at `database-design.md:1240`) rather than the brief's sketched `"@fastify/rate-limit"`.** A iter-2 concurred — DD-029 is authoritative when the brief abbreviates.
- **4 pre-existing tests updated, not the story-author's tests.** T deliverable (b) corrected `health.test.ts:183-196` (3 assertions) + `layout.test.ts:188-198` (1 assertion) — these had locked in the DD-029-forbidden `X-RateLimit-*` header family. Same intent (verify rate-limit headers exist), corrected contract; each modified assertion carries an inline DD-029 citation. This is on-role test maintenance under T (not new authoring), and is the only path that makes the brief's "existing test suite passes" criterion deliverable alongside DD-029 conformance.

## Follow-ups (not in scope)

- **`audit-composition-root-S2`** — Theme T6-β (AI-pipeline extraction, `onClose` consolidation, EventBus runtime guard, `/health` 503-during-sync boot restructuring per finding #11). Will need your call at kickoff on the finding-#11 alternative (restructure code vs. update spec doc).
- **`audit-composition-root-S3`** — Theme T6-γ (typed decorations, `onRequest`→`preHandler` rename, redundant `/assets/` dedup, COUNT caching, inline-`/` classification).
- **Prometheus counter `ctrfhub_ratelimit_exceeded_total{endpoint,backend}`** — DD-029 point 7. Explicitly out of scope here (no Prometheus integration exists yet); surfaced for when one lands.
- **`/hx/*` 429 contract integration test** — no `/hx/*` route exists on `main` today; F installed the `onSend` rewrite pre-emptively and the contract test deferred to whenever the first `/hx/*` route lands.

## Gaps filed during this story

none

## Spec-enforcer verdict

**PASS** — see `.argos/stories/audit-composition-root-S1/spec-audit-1.md` (0 block, 0 warn, 0 nit). S concurred with A's verdicts on the three flagged decisions and confirmed T's 4 pre-existing-test updates are on-role contract correction (intent preserved; header-name strings updated to match DD-029 with inline citations).
**Date:** 2026-05-20

---
_Generated from `.argos/stories/audit-composition-root-S1/pr-body.md`._

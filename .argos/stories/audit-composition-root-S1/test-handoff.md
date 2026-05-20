# Test Handoff — audit-composition-root-S1

**Branch:** `story/audit-composition-root-S1`
**Date:** 2026-05-20
**Verdict:** **PASS**

Argos may proceed to Phase 6 close-out.

## Tier summary

| Tier | Status | Report |
|---|---|---|
| T1 Headless | N/A — non-UI story (brief §Page verification tiers: none) | `.argos/stories/audit-composition-root-S1/tier-1-report.md` |
| T2 ARIA | N/A — non-UI story | — |
| T2.5 Authenticated state | N/A — non-UI story | — |
| T3 Visual | N/A — non-UI story | — |
| Backdrop-contrast | N/A — no layout-token / backdrop / `[data-theme]` changes in diff | — |

The brief declares **Unit: no · Integration: yes (exactly two) · E2E: no · Page verification: none**. Both declared integration tests are present (deliverable (a)) and the four pre-DD-029 assertions are updated to the draft-spec contract (deliverable (b)).

## Diff scope confirmation

`git diff --stat main..story/audit-composition-root-S1` reports the source-code diff is scoped to **`src/app.ts` + `.argos/stories/audit-composition-root-S1/{brief.md, feature-handoff.md, architecture-review-1.md, architecture-review-2.md, tier-1-report.md, test-handoff.md}` + the three test-file changes below**. No application source under `src/` (outside `__tests__/`) was touched by Test-writer.

Test-writer additions:
- `src/__tests__/integration/rate-limit-and-auth-log.test.ts` — NEW, 13 tests, +355 lines.
- `src/__tests__/integration/health.test.ts` — MODIFIED, header-name assertions updated in the `rate-limit headers` describe block (`:174-196` in the post-change file).
- `src/__tests__/integration/layout.test.ts` — MODIFIED, single header-name assertion updated in the security-headers describe block (`:188-198` in the post-change file).

## Tests added

### Deliverable (a) — new integration tests

**File:** `src/__tests__/integration/rate-limit-and-auth-log.test.ts` (13 tests, 2 describe suites)

| # | Suite §1 — DD-029 429 contract for /api/v1/* | Pre-handoff self-check |
|---|---|---|
| 1 | `first request under the limit returns 200` | Fails in isolation if probe route not wired correctly. |
| 2 | `over-the-limit request returns 429` | Fails in isolation if `errorResponseBuilder` absent or rate-limit broken. |
| 3 | `429 body has exactly the three DD-029 wire-format keys (no statusCode leak)` | Fails in isolation if the iter-1 `statusCode` leak regression reappears. |
| 4 | `429 body fields match DD-029 byte-for-byte` | Fails in isolation if `error` / `code` / `retry_after_s` field values drift. |
| 5 | `429 emits the RFC 9728 draft-spec ratelimit-* headers (DD-029)` | Fails in isolation if `enableDraftSpec: true` is removed. |
| 6 | `429 does NOT emit the legacy x-ratelimit-* header family (DD-029 :3208)` | Fails in isolation if the `@fastify/rate-limit` default headers reappear. |
| 7 | `emits a single ratelimit.exceeded log line with DD-029 canonical shape` | Fails in isolation if `onExceeded` log line is removed or fields drift. |
| 8 | `limiter key (raw IP / user-id) never appears in any log field` | Fails in isolation if a non-`key_hash` field accidentally carries the raw IP / user-id. |
| 9 | `key_hash matches first 8 hex of SHA-256 over the resolved limiter key (raw IP)` | Fails in isolation if the hash algorithm or truncation changes. |

| # | Suite §2 — invalid-API-key observability | Pre-handoff self-check |
|---|---|---|
| 10 | `returns 401 with INVALID_API_KEY code and the documented error body` | Fails in isolation if the invalid-key branch's response shape drifts. |
| 11 | `emits the auth.api_key_invalid warn line with ip and the canonical message` | Fails in isolation if the `request.log.warn` call is removed or message drifts. |
| 12 | `raw token bytes do NOT appear in any captured log field (IP-only correlation)` | Fails in isolation if a `tokenPrefix` / `ctrf_*` byte leak is reintroduced. |
| 13 | `preserves the SECURITY comment on the invalid-API-key branch (brief §AC)` | Fails in isolation if the SECURITY comment is removed or edited. |

**Pre-handoff self-check outcome:** confirmed — every test above fails in isolation if the relevant code clause is wrong. **None deleted.** Tests 7/8/9 share a call site but each isolates a different regression mode (shape vs leak-source vs hash-algorithm); tests 3/4 share a body but assert distinct contract clauses (key-set vs values); the ratio is justified by the multi-clause nature of DD-029.

**Tests-per-distinct-branch:** 13 tests / 4 distinct branches added (errorResponseBuilder, onExceeded, /hx/ onSend, auth.api_key_invalid log). Ratio ≈ 3.25. The /hx/ onSend branch is not exercised (no /hx/ routes exist; brief explicitly defers an integration test for it). The remaining three branches encode multiple DD-029 sub-invariants that are individually contract-defined, not matrix fan-out across input values. Each test fails in isolation per the self-check.

### Deliverable (b) — updated pre-existing assertions

The 4 pre-existing assertions that locked in the DD-029-forbidden `X-RateLimit-*` header family have been updated to the draft-spec family `RateLimit-*` (lowercase as Node header convention). Each modified assertion carries an inline comment citing DD-029 so the next reader understands the rename.

| # | File:line range (post-change) | Before → After |
|---|---|---|
| 1 | `src/__tests__/integration/health.test.ts:183-186` | `x-ratelimit-limit` → `ratelimit-limit` (title also updated to "RateLimit-Limit header (DD-029 draft-spec)") |
| 2 | `src/__tests__/integration/health.test.ts:188-191` | `x-ratelimit-limit` → `ratelimit-limit` for the `=== '600'` assertion (title updated to cite DD-012 :1171) |
| 3 | `src/__tests__/integration/health.test.ts:193-196` | `x-ratelimit-remaining` → `ratelimit-remaining` (title also updated) |
| 4 | `src/__tests__/integration/layout.test.ts:188-198` | `x-ratelimit-limit` → `ratelimit-limit` for the `=== '600'` assertion (title updated to "RateLimit-Limit: 600 (DD-029 draft-spec)") |

The surrounding test scaffolding (describe blocks, fixtures, helpers) was left unchanged. The titles were updated only to reflect the renamed header — they previously referenced the literal `X-RateLimit-*` form per the brief's note that such titles are the carve-out for retitling.

## Commands run

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | **512 passed / 0 failed (24 test files)** |

Baseline before this T-pass was **495 passed / 4 failed** (the 4 pre-existing DD-029-forbidden header assertions F flagged). After this T-pass the 4 failures are resolved (deliverable b) and 13 new tests are added (deliverable a), for a delta of **+17 passing / -4 failing**, landing at 512 / 0.

## Decisions / notes

- **No DI seam added.** Log capture is done via a prototype-level spy on `Object.getPrototypeOf(app.log).warn`. With `buildApp({ testing: true })` Fastify constructs with `logger: false`, in which `app.log === request.log` and the level methods live on the prototype — spying there captures every `request.log.warn(…)` call without touching application code, and is restored in `afterAll`. Documented inline in the helper.
- **429 forcing strategy.** Chose the per-route `config.rateLimit: { max: 1, timeWindow: '1 minute' }` override (the cleaner of the brief's two suggestions). The probe route is `/api/v1/__test__/rate-limit-probe` (matching the brief's literal suggestion) and carries `skipAuth: true` so the limiter is exercised in isolation of auth preHandler branches. The route is registered with `app.get(…)` after `buildApp(…)` — same pattern used by `auth.test.ts:506-515`.
- **Seeded user.** Both suites seed one Better Auth user so that the empty-DB Branch 1 redirect to `/setup` does not pre-empt the limiter / invalid-key path. Same pattern as `auth.test.ts buildSeededApp()`.
- **SECURITY comment assertion.** Asserts the comment text by reading `src/app.ts` at test runtime rather than by line number. The brief cites `:567-568` but iter-1 added an `import { createHash }` line that shifted the comment to `:713-714`; the contract is the text, not the line.

## Non-blocking issues

- None.

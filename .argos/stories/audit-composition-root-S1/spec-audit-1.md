# Spec-enforcer Audit — audit-composition-root-S1 — iteration 1

**Executed:** 2026-05-20
**Reviewer:** spec-enforcer (Claude Opus 4.7) — read-only
**Scope:** diff `main..story/audit-composition-root-S1` (commits `d9a6fee`, `cddda53`, `864c2b2`, `f3e63a0`, `e3a35c5`)
**Checklists run:** Architecture rules; Coverage; Planning-doc conformance (DD-012, DD-029, architecture.md §Code Conventions → Logging); Skills violations (better-auth-session-and-api-tokens, htmx-4-forward-compat — spot-check only, not exercised by this diff); Forbidden-pattern scan.

## Prior-iteration check

N/A — this is iteration 1 of the spec-enforcer audit. (F ran two iterations against A; A iter-1 BLOCK was cleanly cleared by iter-2 PASS, and T passed first try at 512/512. This is S's first pass.)

## Findings

No drift detected against `skills/` or `docs/planning/*`.

The implementation matches the DD-012/DD-029 canonical contract byte-for-byte:

- **`keyGenerator`** at `src/app.ts:274-284` — `request.user?.id ?? request.apiKeyUser?.referenceId ?? request.ip`. Pre-auth ordering trap correctly handled (limiter runs before auth preHandler; fall-through to IP is intended per DD-012's "unauthenticated traffic" intent). Inline citation comment on the registration block names both DDs.
- **`errorResponseBuilder`** at `src/app.ts:285-329` — `body` is a 3-key TS literal (`error`, `code`, `retry_after_s`); `statusCode` set via `Object.defineProperty(..., { enumerable: false })` so Fastify's `setErrorStatusCode` reads it via direct property access but it stays out of JSON serialization (DD-029 :1191-1198 byte-for-byte). `headers: { 'HX-Trigger': 'rate-limited' }` set the same way, behind the `isHxRoute` guard so it never leaks onto `/api/v1/*` responses.
- **Paired `onSend` hook** at `src/app.ts:367-375` — strips body to empty bytes when both `reply.statusCode === 429` and path starts with `/hx/`. Narrow trigger keeps it a no-op for every other response.
- **`enableDraftSpec: true`** at `src/app.ts:273` — switches the plugin's header family to RFC 9728 draft `RateLimit-*`. The legacy `X-RateLimit-*` family is no longer emitted (DD-029 :3208 forbids).
- **`onExceeded`** Pino log line at `src/app.ts:331-349` — emits exactly the DD-029 canonical 5-field shape: `event`, `endpoint`, `key_hash` (snake_case per DD's :1238 sample), `limit: '600/1m'`, `backend: 'fastify-rate-limit'`. `key_hash` is the first 8 hex chars of SHA-256(String(key)). No raw IPs / user-ids / token-ids in the payload.
- **Auth invalid-API-key log line** at `src/app.ts:745-751` — `request.log.warn({ event: 'auth.api_key_invalid', ip: request.ip }, 'Invalid API key on x-api-token')`. Emits **before** the 401 reply. Raw token never read into a log field. The 13-line block comment at `:727-744` documents the decision against `tokenPrefix` (DD-029 :3208 "no raw emails or IPs" intent + `ctrf_*` prefix leak avoidance).
- **SECURITY comment** at `src/app.ts:713-714` — preserved verbatim. Brief cited `:567-568`; the line shift is fully accounted for by the iter-1-added `createHash` import and the expanded step-4 rate-limit block. The test at `rate-limit-and-auth-log.test.ts:435-448` reads the file text to assert the comment, not a line number — correct posture.

## Coverage gaps

Coverage matches the story's declared Test tiers required and Page verification tiers.

The brief declared **Integration: yes (exactly two)** and **Page verification: none**. T delivered 13 tests across 2 describe suites in `src/__tests__/integration/rate-limit-and-auth-log.test.ts` — the "exactly two" referred to the two test areas (DD-029 429 contract + auth invalid-key observability), not a literal pair of `it()` blocks. The 13-test fan-out across the two suites maps to the multi-clause structure of DD-029 (body-shape, headers, observability, leak-prevention) and is consistent with the brief's "force a 429 and assert response body, headers, and Pino line" + "POST with a bad x-api-token and assert response, log line, and no raw token" decomposition. Each test isolates a distinct contract clause and fails in isolation per T's self-check.

Brief's "regression guards must still pass unchanged" — `auth.test.ts` (23 tests) and `static-asset-auth-bypass.test.ts` (31 tests) — confirmed green at 54/54 by A iter-2.

## Planning-doc conformance

- [x] **Rate-limit headers** are the RFC 9728 draft family (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`) + `Retry-After`; the legacy `X-RateLimit-*` family is absent — DD-029 (`database-design.md:1181-1188`, `:1202`, `:3208`). Asserted by `rate-limit-and-auth-log.test.ts:247-267` (positive + negative).
- [x] **`/api/v1/*` 429 body** has exactly 3 keys (`error`, `code`, `retry_after_s`); no `statusCode` leak — DD-029 (`database-design.md:1191-1198`). Asserted by `rate-limit-and-auth-log.test.ts:222-243`.
- [x] **`/hx/*` 429 contract** — empty body + `HX-Trigger: rate-limited` header — DD-029 (`database-design.md:1199-1201`). Implemented via `errorResponseBuilder` (header) + paired `onSend` (empty body); no live `/hx/*` route exists so the contract is pre-emptive per the brief.
- [x] **DD-012 keyGenerator** — `request.user?.id ?? request.apiKeyUser?.referenceId ?? request.ip` matches "General authenticated API | 600 req/min | session-user-id" (`database-design.md:1171`).
- [x] **DD-029 observability** — Pino `event=ratelimit.exceeded` warn line with snake_case `event`, `endpoint`, `key_hash`, `limit`, `backend` (`database-design.md:1233-1241`). Asserted by `rate-limit-and-auth-log.test.ts:271-316` including hash-algorithm verification and raw-IP-absence guards.
- [x] **architecture.md §Code Conventions → Logging** (line 859) — "the auth subsystem and ingest routes log decisions (e.g. invalid API key) without logging the token value." Implemented by `src/app.ts:745-751`. Asserted by `rate-limit-and-auth-log.test.ts:387-432`, including a `deepContainsString` recursive guard against `ctrf_*` / `DEADBEEF` / full-token leakage.
- [x] **API token values never appear in log output** — the `deepContainsString` guard at `rate-limit-and-auth-log.test.ts:408-432` proves this for the invalid-key path.

## Forbidden-pattern scan

- [x] No `hx-target`/`hx-swap` inherited from a parent — no template edits in this diff.
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — sole `htmx:trigger` mention is inside a comment block at `src/app.ts:256`; no client code added or modified.
- [x] No `hx-disable` anywhere — none added.
- [x] No Alpine `x-data` inside an HTMX swap target — no template / Alpine code in this diff.
- [x] No Postgres-only SQL / dialect-specific features — entities not touched.
- [x] No DB mocked in integration tests — both new suites use real SQLite via `buildApp({ testing: true, db: dbPath })` with `seedAuthSchema` migrations + real signup; verified at `rate-limit-and-auth-log.test.ts:60-65, 153-198, 336-357`.
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — non-UI story; T1/T2/T2.5/T3 all N/A per brief.
- [x] No layout-token change without a T2 backdrop-contrast re-check — no token / backdrop changes.
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — `src/app.ts:715-752` (the auth preHandler API-key branch) uses `auth.api.verifyApiKey({ body: { key: apiToken } })` exclusively; no raw cookie or CSRF token is read or echoed. The new log line takes only `ip` from the request and emits no token-derived field. SECURITY comment unchanged.
- [x] No Zod schema defined ad-hoc in a handler — no Zod usage added; no new routes (the test-only probe route is registered inside the test fixture and skipped for auth).
- [x] No `fastify.orm.em` used directly in a request handler — none added; the only `orm.em` occurrences in `src/app.ts` (`:474, :481, :823`) are the existing em-fork plumbing and the health-check connection ping, unchanged by this diff.
- [x] Integration tests call `afterAll(() => app.close())` — both new suites do (`rate-limit-and-auth-log.test.ts:200-210, 359-369`) and also unlink the temp SQLite file.

## Scope-discipline check

The diff is confined to `src/app.ts` plus the three test files T modified (one new, two pre-existing). Verified explicitly:

- No edits to AI-pipeline wiring (`src/app.ts:410-481` — the EM-fork preHandler region is unchanged; S2 territory).
- No `onClose` LIFO restructuring (S2 territory).
- No `/health` boot-state ordering change (S2 territory).
- No `FastifyInstance` type-augmentation changes (S3 territory).
- Global auth preHandler is still `addHook('onRequest', ...)` — `preHandler` rename deferred to S3 per brief.
- No `/assets/` dedup, no COUNT caching, no inline `/` classification (all S3 territory).

## T's pre-existing-test updates — concur

The 4 modifications in `health.test.ts` (3 assertions, lines 174-198 post-change) and `layout.test.ts` (1 assertion, lines 185-198 post-change) are on-role test maintenance, not unsanctioned rewriting. Verified:

1. Each modified test changes only the header-name string from `x-ratelimit-*` to `ratelimit-*` — every assertion's surrounding scaffolding, fixtures, and intent (verify that rate-limit headers are present and the limit value is 600) are preserved.
2. Each modified assertion carries an inline DD-029 citation comment naming the spec line (`:1181-1188`, `:1202`).
3. The pre-existing tests asserted a DD-029-forbidden contract — F's code change is correct, but the tests were locked-in to the old behaviour. Updating them is the only path to "existing test suite passes" alongside DD-029 conformance, and the brief explicitly anticipated this in the T-pass scope.
4. The test-title updates (e.g. `"includes X-RateLimit-Limit header"` → `"includes RateLimit-Limit header (DD-029 draft-spec)"`) are the carve-out for retitling allowed under T's role: the title must match the assertion's literal header string.

This is exactly the kind of "tests assert a contract that the spec has since changed" pattern that T is empowered to fix. PR body and `test-handoff.md` both document it transparently.

## F-pick decisions — concur on all three

1. **`keyGenerator` accessor — `request.apiKeyUser?.referenceId`** over the brief's `metadata?.userId` shorthand. **Concur.** `src/auth.ts:67-74` declares `referenceId: string` as required with JSDoc explicitly stating "`referenceId` is the userId that owns the key (Better Auth 1.x renamed `userId` → `referenceId`)". `metadata` is `Record<string, unknown> | null` and is not populated by the codebase. F's pick is the type-safe library-canonical accessor. A iter-1 + iter-2 concurred for the same reason.

2. **Auth-failure log token shape — prefix omitted, IP-only correlation.** **Concur.** The brief itself flagged that `apiToken.slice(0, 8)` leaks a known literal `ctrf_*` prefix; the auth-failure log is a once-per-misconfig diagnostic where IP is the actionable correlator (not a high-volume stream where hash-based correlation pays for itself); the hashed-prefix variant would invite "is this a key hash or a user hash?" ambiguity at log-grep time. The 13-line comment block at `src/app.ts:727-744` documents the rationale in-place. A iter-1 + iter-2 concurred.

3. **`backend` field value `"fastify-rate-limit"`** (matching DD-029's verbatim sample at `database-design.md:1240`) over the brief's sketched `"@fastify/rate-limit"`. **Concur.** DD-029's canonical sample literally reads `"backend": "fastify-rate-limit"` — no `@`, no `/`. The brief's escape-hatch ("DD-029 is authoritative when the brief abbreviates") applies cleanly. The npm-package-name form would have been ergonomically grep-able, but DD-029 declares the field a *backend identifier*, not a package name, and pins the string. A iter-2 concurred for the same reason.

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

All acceptance criteria from `brief.md §Acceptance criteria` are met. The DD-012 / DD-029 contract is implemented byte-for-byte, the observability shape is canonical, the auth-failure log line is in place with no raw-token leakage, the SECURITY comment is preserved, scope discipline is laser-tight (no creep into S2 / S3 territory), the four flagged test-file modifications are on-role contract corrections, and the three F-pick decisions are all defensible and well-documented. T's coverage matches the brief's declared tiers. No `block`-severity findings.

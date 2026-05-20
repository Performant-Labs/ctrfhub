# Spec-enforcer Audit — audit-composition-root-S3 — iteration 1

**Executed:** 2026-05-20 14:30
**Reviewer:** spec-enforcer (Claude Opus 4.7) — read-only
**Scope:** diff `origin/main..story/audit-composition-root-S3`
**Checklists run:** Architecture rules, Coverage, Planning-doc conformance (auth-hook stage + trivial-route clause), Skills violations (better-auth-session-and-api-tokens, mikroorm-dual-dialect spot-check, page-verification-hierarchy verification of T1/T2 deferral), Forbidden-pattern sweep

## Prior-iteration check

N/A — this is iteration 1; no prior `spec-audit-*.md` exists.

## Findings

No drift detected against `skills/` or `docs/planning/*`.

Verification trace (per finding):

- **Finding #3 (typed `FastifyInstance` augmentation).** Augmentation slots inside the existing `declare module 'fastify' { ... }` block at `src/app.ts:76` alongside the pre-existing `FastifyContextConfig` (line 77), `FastifyRequest` (line 111), and `FastifyReply` (line 120) augmentations — no parallel `declare module` block. The six fields at `src/app.ts:97-110` map 1:1 to the six `app.decorate(...)` call sites verified via `grep`:
  - `orm: MikroORM` ↔ line 522 (unconditional → required)
  - `eventBus: EventBus` ↔ line 573 (unconditional → required)
  - `artifactStorage?: ArtifactStorage` ↔ line 577, gated by `if (artifactStorage)` at line 576 (optional → `?` honest)
  - `aiProvider?: AiProvider` ↔ line 598, gated by `if (aiProvider)` at line 597 (optional → `?` honest)
  - `getBootState(): BootState` ↔ line 227 (unconditional → required)
  - `setBootState(state: BootState): void` ↔ line 233 (unconditional → required)
  Backing types (`EventBus`, `ArtifactStorage`, `AiProvider`) imported from `./types.js` (line 49); confirmed exported from `src/types.ts:19, 34, 45`. Pre-existing `FastifyRequest.em: any` (line 118) is untouched (out-of-scope guardrail respected per brief). `npx tsc --noEmit` returns 0 errors.

- **Finding #5 (`onRequest` → `preHandler` rename).** `grep -n addHook src/app.ts` confirms exactly one `preHandler` data-path hook (line 708, auth) and one `onRequest` data-path hook (line 533, EM-fork) — plus the unrelated `onSend` observability hook (line 393) and `onClose` shutdown hook (line 622). The JSDoc at lines 684-707 documents the stage choice and cites `architecture.md §Security` line 437 and `skills/better-auth-session-and-api-tokens.md`. Verified: `architecture.md:437` reads "single global `preHandler` hook"; `skills/better-auth-session-and-api-tokens.md:3,10,24,74,76,96` consistently say `preHandler`. The rename aligns code with spec; no doc edit was needed (F correctly flagged this).

- **Finding #8 (redundant `/assets/` removed from Branch 1).** The Branch 1 `isExemptFromEmptyCheck` OR-chain at lines 730-742 no longer contains a `rawPath.startsWith('/assets/')` clause; Branch 0 at lines 717-719 remains the single source of truth. New comment at lines 725-728 explains the asymmetry and names the drift risk a unified list would hide. F's decline of the optional `PUBLIC_PATH_PREFIXES` consolidation is rationally documented in `feature-handoff.md §Decisions not covered by planning docs` (Branch 0 = "never see auth" vs Branch 1 = "exempt from empty-users redirect" are semantically distinct allow-lists — explicitly out-of-scope for this audit per the brief).

- **Finding #9 (closure-scoped `usersBootstrapped` cache).** `let usersBootstrapped = false;` lives at `src/app.ts:682` — inside `buildApp()` (function body opens at line 194). The cache-aware gate at line 744 (`if (!isExemptFromEmptyCheck && !usersBootstrapped)`) is exception-safe: the `catch` block at lines 751-757 does not touch `usersBootstrapped`, and the comment at lines 755-756 documents that a thrown `em.count` leaves the cache `false`. The latch at line 772 only fires inside the gated block after a non-zero `userCount` — so an exempt request can never spuriously set the latch. Naming `usersBootstrapped` is consistent with sibling closure variables (`currentBootState` at line 221, `stopSweeper` at line 596).

- **Finding #10 (option (b) — inline + JSDoc).** F's option-(b) call is explicitly permitted by the brief and is therefore out of audit scope. Verifying the substance: the JSDoc at `src/app.ts:462-487` cites `architecture.md §Code Conventions → File organization` and PR #77, and names a substantive four-condition extraction threshold (handler grows beyond `reply.page()`, schema validation added, route-level config added, sibling routes accrete). Verified `architecture.md:777-781` contains the trivial-route clause exactly as cited (with `/health` as the canonical example). The JSDoc is genuinely substantive, not generic "this is a route" boilerplate — it gives a future maintainer concrete extraction triggers.

## Coverage gaps

Coverage matches the story's declared Test tiers required and Page verification tiers.

The brief's Test-tiers-required table marks every layer for findings #3, #5, #8, #10(b) as "no" (this is a deletion/refactor/rename story whose regression guard is the existing 513-test integration suite). For finding #9, the unit test was marked "optional" and conditional on F's discretion; F deferred to T per role boundary, and T's skip justification (in `test-handoff.md §Non-blocking issues`) is sound:

1. Spying on `request.em.count(User)` from outside `buildApp()` requires either `MikroORM.prototype` patching (test pollution risk) or new DI plumbing exclusively for one test;
2. The behavioural invariant (empty DB → /setup; seeded DB → no redirect) is already covered by `auth.test.ts` Branch 1 (5 tests) and `static-asset-auth-bypass.test.ts` Suites C+D (combined 10 tests);
3. The optimisation is correctness-preserving by construction (latch only flips on `userCount > 0`; exception path leaves the latch `false`) — a property A's iter-1 review verified by inspection;
4. The skipped test would assert only the **performance** invariant (no second COUNT query), not a behavioural correctness invariant — its absence does not weaken the regression signal.

This is a defensible cost/value call, not a test the spec requires. No coverage gap.

The full integration suite at 513/513 (T's `tier-1-report.md` Check #9) is the equivalent coverage signal for a refactor of this shape.

## Planning-doc conformance

- [x] **Zero `docs/planning/*` edits authorized; zero present.** `git diff --name-only origin/main..story/audit-composition-root-S3 -- docs/planning/` returns empty. Verified.
- [x] **Auth hook lives at `preHandler` stage** — matches `architecture.md §Security:437` ("single global `preHandler` hook") and `skills/better-auth-session-and-api-tokens.md:3,10,24,74,76,96` ("global `preHandler` hook").
- [x] **EM-fork hook stays at `onRequest` stage** — required so all downstream `preHandler` and handler code can read `request.em` per `skills/mikroorm-dual-dialect.md`. Verified at `src/app.ts:533`.
- [x] **Trivial-route inline registration permitted** — `architecture.md §Code Conventions → File organization` lines 777-781 explicitly carve out trivial routes (with `/health` as canonical example); F's finding-#10 option (b) takes this carve-out. JSDoc citation is verbatim-accurate.
- [x] **Composition root invariant preserved** — no new `app.register` / `app.addHook` / `app.decorate` calls outside `src/app.ts`. The new `FastifyInstance` interface makes the existing seams visible at type level, aligning with `architecture.md §Layering and Dependency Direction`.
- [x] **Test-file edits are documentation-only** — `src/__tests__/integration/static-asset-auth-bypass.test.ts` diff is confined to JSDoc comment lines (header block lines 6, 16, plus a one-paragraph rename note); no `it(…)` / `describe(…)` / `expect(…)` line in any test file is altered. T's role-boundary scope respected.
- [x] **Other `onRequest` mention in test tree deliberately retained** — `rate-limit-and-auth-log.test.ts:139` references `@fastify/rate-limit`'s own route-level `onRequest` hooks, not the global auth hook. Verified by reading the surrounding comment at lines 130-143; the reference remains accurate post-rename.

## Forbidden-pattern scan (from CLAUDE.md)

Diff scanned for each forbidden pattern; none found.

- [x] No `hx-target` / `hx-swap` inherited from a parent — no template files touched
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — no client-side TS touched
- [x] No `hx-disable` anywhere in templates — no templates touched
- [x] No Alpine `x-data` inside an HTMX swap target — no templates touched
- [x] No Postgres-only SQL / dialect-specific features — no entity or migration files touched
- [x] No DB mocked in integration tests — no test logic touched (only JSDoc comments)
- [x] No Tier 3 visual assertions without corresponding Tier 2 ARIA assertions — no new page-tier files added (F's option-(b) call eliminates the page-tier scope)
- [x] No layout-token change without a Tier 2 backdrop-contrast re-check — no layout-token / `position` / `z-index` / `@layer components` change in diff
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — only stage-string rename (`'onRequest'` → `'preHandler'`); auth-resolution branches stubbed pending AUTH-001
- [x] No Zod schema defined ad-hoc in a handler — no Zod schemas touched
- [x] No TypeScript interface duplicating a Zod schema — the new `FastifyInstance` interface augments a third-party type (Fastify) and types decorator slots; not a Zod-derived shape
- [x] No `/api/artifact` endpoint added — no routes added
- [x] No real AI API calls in tests — no test files added; no test imports changed
- [x] No `dark:` Tailwind variant in any Eta template — no templates touched
- [x] No `fastify.orm.em` used directly in a request handler — no handler code touched (the new `FastifyInstance.orm` typing documents that the root EM exists; the doc on the interface field at line 98 explicitly says "Per-request handlers must read `request.em`, not this")

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

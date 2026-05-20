# Feature handoff — `audit-composition-root-S3`

## Iteration 1

**Date:** 2026-05-20
**Branch:** `story/audit-composition-root-S3`
**Commits added this iteration:**

- `562864e` `refactor(audit-composition-root-S3): consistency cleanups — types, naming, dedup, caching, inline-route JSDoc`

(One consolidated commit rather than five tiny ones — the brief permits either. The diff is 110 lines in a single file; the "Findings addressed" table below maps each finding to its line range, which is the same isolation a per-finding split would provide for a reviewer.)

### What was built / fixed

- **Finding #3 — typed `FastifyInstance` augmentation.** Extended the existing `declare module 'fastify'` block (was already augmenting `FastifyContextConfig`, `FastifyRequest`, `FastifyReply`) with a new `interface FastifyInstance` that types all six `app.decorate(...)` call sites — `orm: MikroORM`, `eventBus: EventBus`, `artifactStorage?: ArtifactStorage`, `aiProvider?: AiProvider`, `getBootState(): BootState`, `setBootState(state: BootState): void`. Imported `ArtifactStorage`, `EventBus`, `AiProvider` from `./types.js` to back the interface. A typo like `app.aiProvier` now fails `tsc --noEmit` rather than silently typing as `unknown`. The pre-existing `FastifyRequest.em: any` augmentation was left untouched — out of S3 scope per the brief.

- **Finding #5 — `onRequest` → `preHandler` rename for the global auth hook.** The auth hook at `src/app.ts:616` (baseline) — the one running the five auth branches and the empty-users redirect — is now `app.addHook('preHandler', ...)`. Documents the rationale in a new JSDoc paragraph citing `architecture.md §Security` and `skills/better-auth-session-and-api-tokens.md`. The per-request EM-fork hook at baseline line 475 was deliberately left at `onRequest` (every downstream preHandler / handler reads `request.em`; the fork must be present before any preHandler runs). The full integration suite — including `auth.test.ts`, `static-asset-auth-bypass.test.ts`, `rate-limit-and-auth-log.test.ts` (which exercises the auth preHandler in every branch) — passes after the rename. No test depended on `onRequest`-stage semantics; the load-bearing-reason escape hatch in the brief did **not** trigger.

- **Finding #8 — removed redundant `/assets/` exemption.** Branch 0 of the auth hook unconditionally returns on `rawPath.startsWith('/assets/')` before Branch 1 runs, so the `/assets/` entry inside Branch 1's `isExemptFromEmptyCheck` list was unreachable. Removed and added a comment explaining why Branch 1 doesn't need to repeat the prefix. The drift risk (if one copy were updated, the other would silently rot) is closed.

- **Finding #9 — `usersBootstrapped` closure cache.** Added `let usersBootstrapped = false;` immediately above the auth hook (closure-scoped to `buildApp()`). The Branch 1 empty-users check now runs `em.count(User)` only while `!usersBootstrapped`; on the first non-zero count the cache latches to `true` and the COUNT is skipped forever after for that app instance. On a DB exception (e.g. `user` table not yet created) the cache stays `false` so the next request re-queries — preserves the "fresh install before `npx auth migrate`" fallback behaviour. Each `buildApp()` call gets a fresh closure → integration tests that rebuild per-test get an automatic reset.

- **Finding #10 — inline `GET /` decision (option (b)).** Picked option (b) per the rationale in *Decisions* below. Added a JSDoc block to the inline `app.get('/')` registration citing `architecture.md §File organization` (PR #77's trivial-route clause) and an explicit four-condition extraction threshold (handler grows beyond `reply.page()`, schema becomes necessary, route gains per-route config, sibling routes accrete).

### Commands run locally (results)

- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — **513 / 513 passing** across 25 test files (9.45 s wall time). Key suites: `auth.test.ts` (23 tests, all five preHandler branches), `static-asset-auth-bypass.test.ts` (31 tests, regression guard for #8), `rate-limit-and-auth-log.test.ts` (13 tests, regression guard for #5), `health.test.ts` (29 tests, empty-users-redirect regression guard for #9).
- `grep -n onRequest src/app.ts` — confirms only the EM-fork hook remains on `onRequest` (line 533 post-edit); the two other matches are docstring references.
- `npm run dev` — not run; the diff is type-augmentation + comments + a string literal change ('onRequest' → 'preHandler') + a control-flow `&&` clause. TSC + the full integration suite booting `buildApp()` 25 times is the equivalent boot proof.

### Files created or modified

- `src/app.ts` — single file touched. 110 lines added, 5 deleted. Diff is concentrated in three regions: the `declare module 'fastify'` block (lines ~108–141 post-edit), the `GET /` JSDoc (lines ~467–490 post-edit), the auth hook + its preceding cache `let` and the Branch 1 empty-users-check body.

### Decisions not covered by planning docs

- **Finding #10 — picked option (b) (inline + JSDoc), not option (a) (extract to `src/modules/home/`).** Rationale: the `GET /` handler is a single `reply.page('home')` call with no schema, no service layer, no service-class to host. Extracting it to a four-file module (`routes.ts` + optional `schemas.ts` + optional `service.ts` + a new tests directory) for a one-line handler is structure-for-structure's-sake, and would prematurely commit to the module shape before any actual sibling routes (`/about`, `/pricing`, etc.) exist to share the directory. `architecture.md §File organization` explicitly permits the trivial-route clause for exactly this case (`/health` is the canonical example, but the clause is general). The JSDoc records a four-condition extraction threshold so a future maintainer doesn't re-litigate the call when the home page grows.
  - **T scope implication:** per the brief's "Test tiers required" table, option (b) means **no new page tiers** are needed for `GET /`. T should skip `tier-1-report.md` / `tier-2-report.md` for this route. No e2e fixture changes needed. The existing E2E `layout.spec.ts` already exercises `GET /` rendering as part of broader layout assertions.

- **Finding #5 — auth hook rename committed; load-bearing-reason escape hatch did NOT trigger.** The brief told F to leave the hook on `onRequest` and flag the finding if the existing integration tests broke. They did not break (513/513 passing), so I went ahead with the rename per the brief's default. No test asserts `onRequest`-stage semantics for the auth hook; the closest text reference is a comment in `static-asset-auth-bypass.test.ts:6,16` that calls it the "global `onRequest` auth hook" — that comment is now slightly stale but no behaviour depends on it, and updating test files is outside F's scope per role contract.

- **Finding #8 — skipped the optional `PUBLIC_PATH_PREFIXES` consolidation.** Branch 0 and Branch 1 encode different concerns: Branch 0 means "this URL should never see auth at all" (only `/assets/*` qualifies — they're static bytes with no session and no API token); Branch 1 means "this URL should bypass the empty-users redirect but still go through API-key / session checks" (e.g. `/setup` itself, `/api/auth/*`, `/__test__/*`). Merging them into one constant would visually unify two semantically distinct allow-lists and would actually obscure the distinction the original two-branch structure preserves. Documented in the new Branch-1 comment.

- **Finding #9 — skipped the optional unit/integration test.** Per my F role contract (`.claude/agents/feature-implementer.md` §Boundaries: "Never write any file under `src/__tests__/`, `tests/`, or `e2e/tests/`. Test authorship belongs exclusively to the Test-writer"), the optional test the brief mentioned ("F's call to include") is outside F's authoring permission. The brief's optional-test clause and my hard boundary conflicted; my role file's boundary wins. T can add a small "second authenticated request doesn't re-query `em.count(User)`" assertion if the test tier owner deems it useful. The existing `auth.test.ts` and `health.test.ts` empty-users-redirect cases serve as the regression guard for the **behavioural** invariant; the new test would only assert the **performance** optimisation.

- **One commit, not five.** The brief permitted either ("One big commit is also acceptable if cleaner"). The diff is 110 lines in one file; the "Findings addressed" table below provides the per-finding isolation a reviewer needs without the noise of five tiny separate commits.

### Findings addressed

| Finding | File:line (post-edit) | What changed | Commit | Status |
|---|---|---|---|---|
| #3 (typed `FastifyInstance`) | `src/app.ts:108–141` (`interface FastifyInstance` block inside `declare module 'fastify'`) | Added `interface FastifyInstance { orm; eventBus; artifactStorage?; aiProvider?; getBootState(); setBootState(); }`. Imported backing types from `./types.js`. | `562864e` | resolved |
| #5 (`onRequest` → `preHandler` for auth hook) | `src/app.ts:712` (was baseline 616) | Changed `app.addHook('onRequest', ...)` to `app.addHook('preHandler', ...)` on the global auth hook only; left EM-fork hook (`src/app.ts:533`) on `onRequest`. Added JSDoc paragraph explaining the stage choice. | `562864e` | resolved |
| #8 (dead `/assets/` exemption) | `src/app.ts:723–745` (Branch 1's `isExemptFromEmptyCheck`) | Removed the `rawPath.startsWith('/assets/')` clause from the OR-chain. Updated the comment above to record why Branch 1 doesn't list `/assets/` (Branch 0 already handles it). | `562864e` | resolved |
| #9 (users-bootstrapped cache) | `src/app.ts:670–691` (`let usersBootstrapped`) + `src/app.ts:746–778` (cache-aware check) | New closure-scoped `let usersBootstrapped = false`; gated the COUNT block with `&& !usersBootstrapped`; latched to `true` after the first non-zero count. DB-exception path leaves the cache `false` so the next request re-queries. | `562864e` | resolved |
| #10 (inline `GET /` — option (b)) | `src/app.ts:451–490` | Added a JSDoc block citing `architecture.md §File organization` and listing the extraction threshold (4 conditions). No code-shape change; the registration itself is unchanged. | `562864e` | resolved (option (b)) |

### Known issues / follow-ups

- **`static-asset-auth-bypass.test.ts:6,16` comments are slightly stale.** They call the auth hook "global `onRequest` auth hook" — accurate before this story, slightly out-of-date now. The comments don't drive behaviour and updating tests is outside F's scope; T may want to refresh them on a future pass when touching that file for unrelated reasons.

- **No `docs/planning/*` mismatches surfaced.** During this story I cross-checked: `architecture.md §Security` (line 437 + 823 + 895 all say "preHandler" already, so the rename **aligns** the code with the doc — no doc edit needed); `skills/better-auth-session-and-api-tokens.md` (says "global `preHandler` hook" in §Rule and How-to-apply — aligned); no other planning text references the `onRequest`/`preHandler` stage name for this hook. The story remains "zero authorized planning-doc edits" — no flag to raise.

- **Performance gain from finding #9 is observable only under load.** A single test invocation rebuilds the app and exercises a handful of requests; the COUNT-elimination becomes meaningful once a sustained dashboard session sends 50+ requests per page (HTMX swaps, partial refreshes, etc.). The optimisation is correctness-preserving even at scale because the `users empty → users present` transition is one-way for the lifetime of an app instance.

- **T scope for this story (next phase).** Per the brief's "Test tiers required" table and my finding-#10 option-(b) choice: **no new page-tier reports needed** (`tier-1-report.md` / `tier-2-report.md` are N/A for `GET /` because the route's shape didn't change). The existing integration tests are the regression guard for findings #3, #5, #8, #9. The only optional addition T may consider is a small "second authenticated request on the same app instance does not re-query `em.count(User)`" assertion for #9; the existing empty-users-redirect integration tests already cover the **behavioural** path.

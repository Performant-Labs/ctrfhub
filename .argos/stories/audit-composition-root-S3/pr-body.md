# [audit-composition-root-S3] Composition-root consistency cleanups — types, naming, dedup, caching, inline-route JSDoc

## Summary

Closes findings #3, #5, #8, #9, #10 from `.argos/audits/audit-composition-root/findings.md` — the final story decomposed from the composition-root audit (Theme T6-γ: five small consistency fixes bundled). With this PR merged, the audit's full eleven-finding output is closed (Theme T6-α in PR #85, T6-β in PR #86, T6-γ here).

Net code change is small and contained: 110 added / 5 removed in `src/app.ts`, zero new modules, zero new behaviour. Every change tightens a type, renames a Fastify lifecycle stage, removes a dead clause, adds a closure-scoped cache around an already-tested code path, or documents a deliberately-inline route. All five findings landed in a single refactor commit (with full per-finding isolation in `feature-handoff.md`'s table).

## Acceptance criteria

*Finding #3 — typed `FastifyInstance` augmentation*
- [x] The existing `declare module 'fastify' { … }` block (`src/app.ts:76–110`) now also augments `FastifyInstance` with the six fields decorated by `buildApp()`: `orm: MikroORM`, `eventBus: EventBus`, `artifactStorage?: ArtifactStorage`, `aiProvider?: AiProvider`, `getBootState(): BootState`, `setBootState(state: BootState): void`. Optionality (`?`) is on the two truly-gated fields only.
- [x] The six `app.decorate(...)` calls type-check against the augmentation (`tsc --noEmit` clean). A hypothetical `app.aiProvier` would now fail at compile time rather than typing as `unknown`.

*Finding #5 — `onRequest` → `preHandler` rename for the global auth hook*
- [x] The global auth hook is renamed to `addHook('preHandler', …)` (now at `src/app.ts:708`), matching `architecture.md §Security` line 437 and `skills/better-auth-session-and-api-tokens.md`.
- [x] The per-request EM-fork hook (`src/app.ts:533`) **stays at `onRequest`** — it must run before any handler can read `request.em`. JSDoc above the auth hook explicitly documents why each hook lives at its respective stage.
- [x] The load-bearing-reason escape hatch did **not** trigger — the existing integration suite passed unchanged at 513/513 after the rename.

*Finding #8 — remove the redundant `/assets/` exemption in Branch 1*
- [x] The `rawPath.startsWith('/assets/')` line is removed from the Branch 1 (`isExemptFromEmptyCheck`) exemption list. Branch 0's short-circuit at the top of the auth hook is now the single source of truth for asset bypass.
- [x] A new comment explains why a unified `PUBLIC_PATH_PREFIXES` list was **deliberately not** introduced — Branch 0 (asset-only auth bypass) and Branch 1 (empty-users-state exemptions) encode semantically distinct allow-lists; collapsing them would obscure the asymmetry. F's documented call (in `feature-handoff.md §Decisions not covered by planning docs`).

*Finding #9 — closure-scoped `usersBootstrapped` cache*
- [x] The per-request `request.em.count(User)` at the original `src/app.ts:652` is gated by a closure-scoped `let usersBootstrapped = false` (now `src/app.ts:682`) — query DB only while `false`, latch to `true` on first `count > 0`, never query again.
- [x] Cache lives inside the `buildApp()` closure (not module-scope) — one cache per app instance; per-test naturally fresh.
- [x] Exception path leaves the cache `false` (a failed `em.count` doesn't lie about the bootstrapped state).

*Finding #10 — inline `GET /` decision: **F picked option (b)** (inline + JSDoc)*
- [x] The inline `app.get('/', ...)` registration (now at `src/app.ts:462–487`) carries a substantive JSDoc citing the `architecture.md §File organization` trivial-route clause (PR #77), naming a four-condition extraction threshold ("extract when the handler grows beyond a single `reply.page()` call, or when authentication branching, per-request loading, or schema validation is added").
- [x] No new module file; no new rendered route → no page-tier scope change for T.

*Cross-cutting*
- [x] `npx tsc --noEmit` — exit 0, no diagnostics.
- [x] `npx vitest run` — **513 / 513 tests pass** across 25 files (matches F's pre-handoff baseline).
- [x] Zero `docs/planning/*` edits (no exception authorized for this story).
- [x] Zero test-logic edits — the two `static-asset-auth-bypass.test.ts` lines T touched (6, 16) are JSDoc-comment alignment after the rename, not test-authoring.

## Test tiers

| Layer | Declared in brief | Present in diff | Notes |
|---|---|---|---|
| Unit | optional (F skipped — role boundary; T also skipped — justified) | 0 | Optional finding-#9 spy was skipped: spying on `request.em.count(User)` from outside `buildApp()` is non-trivial (the EM is forked per-request inside the existing `onRequest` EM-fork hook); the behavioural invariant is already covered by `auth.test.ts` Branch 1 (5 tests) and `static-asset-auth-bypass.test.ts` Suites C+D (10 tests). The latch's exception-safety was verified by A's iter-1 inspection. Justification in `test-handoff.md §Non-blocking issues` |
| Integration | no new tests | 0 | Existing integration suite is the regression guard for #3 (compile contract), #5 (auth hook stage), #8 (asset bypass), #9 (empty-users-redirect), #10 (`GET /` rendering). All green at 513/513 |
| E2E | no | 0 | Composition-root refactor + JSDoc only; no new rendered routes touched |

## Page verification tiers

**None** — F picked finding-#10 option (b) (inline + JSDoc), so no new rendered route requires page tiers. All page tiers correctly marked N/A by T.

| Tier | Declared | Result | Report |
|---|---|---|---|
| T1 Headless | yes (full vitest suite as regression check) | ✓ 513/513 | `.argos/stories/audit-composition-root-S3/tier-1-report.md` |
| T2 ARIA | N/A — no new rendered route (F's option b) | — | — |
| T2.5 Authenticated State | N/A — same reason as T2 | — | — |
| T3 Visual | N/A — no visual surface changed | — | — |

## Architecture reviews

| # | Verdict | File |
|---|---|---|
| 1 | PASS (0 block, 0 warn, 0 nit) | `.argos/stories/audit-composition-root-S3/architecture-review-1.md` |

Iter-1 cleared first time with no findings at all. A verified each of the five fixes by direct line-citation: the `FastifyInstance` interface fields map 1:1 to the six `app.decorate(...)` call sites with honest optionality; `grep addHook` confirms exactly one `onRequest` (the EM-fork hook) and one `preHandler` (the auth hook); the redundant `/assets/` check is gone with the asymmetry-justifying comment in its place; the `usersBootstrapped` cache is closure-scoped (not module-scope) and exception-safe; the inline-route JSDoc is substantive (cites the §File organization clause, names PR #77, gives the four-condition extraction threshold).

## Decisions that deviate from spec

- **Finding #10 → option (b) (inline + JSDoc).** Single-line handler with no auth branching or per-request loading — extraction would be net-negative diff churn for zero clarity gain. JSDoc names the threshold at which a future story should extract. Brief explicitly permitted F to pick either option. Documented in `feature-handoff.md §Decisions not covered by planning docs`.
- **Finding #8 → optional `PUBLIC_PATH_PREFIXES` consolidation skipped.** Branch 0 (auth-bypass for static assets) and Branch 1 (empty-users-state exemptions) encode semantically distinct allow-lists. Collapsing them into one constant would obscure why an entry might appear in one branch and not the other; a new comment explains the asymmetry. Brief explicitly permitted F to decline.
- **Finding #9 → optional unit test skipped.** F's role boundary forbids test authoring; T evaluated whether to add it and concluded the existing integration suite already covers the behavioural invariant (empty DB → /setup; seeded DB → no redirect); the optimization is correctness-preserving by construction (latch flips only on `count > 0`; exception leaves it `false`); A's iter-1 inspection verified the safety. Spying on a buried per-request EM method would add maintenance cost without strengthening the regression signal. Brief permitted T to skip with justification; justification recorded in `test-handoff.md §Non-blocking issues`.

## Argos's non-obvious autonomous calls

See `.argos/stories/audit-composition-root-S3/decisions.md`:

- **D-1** — Branched `story/audit-composition-root-S3` from `origin/main @ 76604f4` (the PR #86 merge — post-S1/S2 baseline) rather than local `main`, because local `main` still carries the divergent unpushed `7319025 docs(agents)…` commit unrelated to this story.
- **D-2** — Brief framed finding #10 as F-decides with two equally-defensible options, making T's tier scope conditional on F's iter-1 call. T routed against F's documented option-(b) call automatically; no Phase-1 over-spec.

## Comment-alignment edits in this PR (T's authorized scope)

- `src/__tests__/integration/static-asset-auth-bypass.test.ts:6, 16` — two stale `onRequest`-hook references in JSDoc updated to `preHandler` after finding #5's rename. Comments only; no test logic changed. Verified by re-running `static-asset-auth-bypass.test.ts` post-edit (31/31 pass). Other `onRequest` hits in the test tree (`rate-limit-and-auth-log.test.ts:139`) were intentionally left intact — that reference is about `@fastify/rate-limit`'s own route-level hooks, not the global auth hook.

## Gaps filed during this story

None.

## Follow-ups (not in scope for this story)

- **Audit campaign progress.** With S1, S2, S3 all closed, territory T6 (`audit-composition-root`) of the codebase audit campaign is complete. Per `.argos/audits/audit-scoping/campaign-plan.md`, the next recommended territory is **T2** (`audit-ingest`).
- **Future `GET /` extraction.** The inline-route JSDoc names four conditions under which a future story should extract `GET /` to `src/modules/home/routes.ts`: handler grows beyond a single `reply.page()` call, or adds auth branching, per-request loading, or schema validation. If a `home`-dashboard story (PL-005 or similar) lands, that's the trigger.
- **Optional finding-#9 spy test.** Skipped this PR with documented justification. If a future story needs a clean `em.count(User)` injection point, the natural shape is a small extension of the `AppOptions` DI seam (e.g. an optional `usersCounter?: (em) => Promise<number>` hook). Out of scope here — the existing integration tests cover the invariant.

## Spec-enforcer verdict

**PASS** — see `.argos/stories/audit-composition-root-S3/spec-audit-1.md` (0 block, 0 warn, 0 nit; iteration 1, no remediation needed). S confirmed (a) zero `docs/planning/*` edits — `git diff --name-only -- docs/planning/` empty; (b) T's test-file edits are JSDoc-only (lines 6, 16 of `static-asset-auth-bypass.test.ts` — no `it(…)`/`describe(…)`/`expect(…)` altered); (c) all five findings close per the canonical patterns named in `architecture.md` / `skills/*`: `FastifyInstance` augmentation slots cleanly with 1:1 field-to-decoration mapping and honest optionality; auth hook renamed to `preHandler` with JSDoc citing `architecture.md §Security:437` and the better-auth skill; redundant `/assets/` line removed with an asymmetry-justifying comment; `usersBootstrapped` cache closure-scoped and exception-safe; inline-`GET /` JSDoc substantive and cites the §File organization trivial-route clause verbatim with a four-condition extraction threshold; (d) T's skip of the optional finding-#9 unit test is well-justified (spying on per-request EM is non-trivial; existing integration coverage guards the behavioural invariant); (e) forbidden-pattern sweep clean; (f) the `rate-limit-and-auth-log.test.ts:139` `onRequest` reference correctly survives the rename — it refers to `@fastify/rate-limit`'s route-level hooks, not the auth hook.
**Date:** 2026-05-20

---
_Generated from `.argos/stories/audit-composition-root-S3/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._

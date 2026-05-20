# Task Brief — audit-composition-root-S3: Composition-root consistency cleanups — types, naming, dedup, caching

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: per the audit decomposition, S3 is "best sequenced AFTER S2." Both prerequisite PRs are now merged — PR #85 (S1, `991c8d3`) and PR #86 (S2, `76604f4`) — so the post-S1/S2 baseline is on `origin/main` and S3 reads cleanly against it.
- [x] No P0 gap blocks this story: `gaps.md` P0 items G-P0-001..003 are Tailwind/Eta/settings-schema (none touch the composition root); G-P0-004 (AI pipeline restart-recovery) is **closed**.
- [x] Branch cut: `story/audit-composition-root-S3` from `origin/main` @ `76604f4` (the PR #86 merge commit).
- [x] `tasks.md` flip: N/A — this story is decomposed from an architecture audit, not a `tasks.md` row (same shape as `audit-auth-S1`, `audit-composition-root-S1`, `audit-composition-root-S2`).
- [x] No other story mid-flight: zero `.argos/stories/<otherId>/` directories with an unclosed pipeline; only `chore/agents-add-hephaestus` (PR #61) is open and it doesn't touch `src/app.ts` or `docs/planning/architecture.md`.

## Source

**Audit:** `audit-composition-root` (territory T6 of the codebase audit campaign).
**Findings:** `.argos/audits/audit-composition-root/findings.md` — Findings #3, #5, #8, #9, #10 (all `warn`, Theme T6-γ).
**Decomposition entry:** `.argos/audits/audit-composition-root/decomposition.md §Story audit-composition-root-S3`.

Both files are on `origin/main` (merged via PR #84) — F can read them directly.

## Story

**Description.** Five small consistency cleanups bundled into one PR that together raise the composition root from "works" to "easy to maintain." None are blocking individually; together they close out the `audit-composition-root` audit's Theme T6-γ (the last open theme — Theme T6-α shipped in PR #85, Theme T6-β in PR #86). All five fixes are in `src/app.ts`; F may choose to extract `GET /` to its own module for finding #10 (option a), which adds one new file under `src/modules/home/`.

**Acceptance criteria.**

*Finding #3 — typed `FastifyInstance` augmentations:*
- The existing `declare module 'fastify' { … }` block at `src/app.ts:76–106` is extended (or augmented in a sibling block) with an `interface FastifyInstance { … }` that types the six current `app.decorate(...)` calls:
  - `orm: MikroORM` (decorated at `src/app.ts:464`)
  - `eventBus: EventBus` (decorated at `src/app.ts:515`)
  - `artifactStorage?: ArtifactStorage` (decorated at `src/app.ts:519` — conditional, hence `?`)
  - `aiProvider?: AiProvider` (decorated at `src/app.ts:540` — conditional, hence `?`)
  - `getBootState(): BootState` (decorated at `src/app.ts:196`)
  - `setBootState(state: BootState): void` (decorated at `src/app.ts:202`)
- After the augmentation, the six `app.decorate(...)` calls type-check against it (`tsc --noEmit` still clean — and a hypothetical typo like `app.aiProvier` would now fail compilation rather than silently typing as `unknown`).
- Note about types currently `any`: the `FastifyRequest.em` augmentation at line 86 is intentionally typed as `any` per its comment. **Do not change this** — it's out of S3 scope. Only add the `FastifyInstance` interface; don't refactor the existing augmentations.

*Finding #5 — `onRequest` → `preHandler` rename for the global auth hook:*
- The global auth hook currently at `src/app.ts:616` (`app.addHook('onRequest', async (request, reply) => { … })` — the one that runs the auth branches and the empty-users redirect) is renamed to `app.addHook('preHandler', ...)` to match `architecture.md §Security` line 437 (which calls it "the single global preHandler hook") and `skills/better-auth-session-and-api-tokens.md`.
- The **per-request EM-fork hook** at `src/app.ts:475` (also `addHook('onRequest', …)`) is **not** renamed — it must run before any handler can read `request.em`, so `onRequest` is the correct stage for it.
- **Load-bearing-reason escape hatch.** If F discovers an existing integration/E2E test that depends on `onRequest`-stage semantics for the auth hook (e.g. a test that asserts auth runs before body parsing), F **flags the finding rather than renaming** and updates the brief in `feature-handoff.md §Decisions not covered by planning docs`. The brief's default is the rename; the test suite is the load-bearing-reason oracle.

*Finding #8 — remove the redundant `/assets/` exemption in Branch 1:*
- Branch 0 at `src/app.ts:625` (`if (rawPath.startsWith('/assets/')) { return; }`) already short-circuits on `/assets/*` before the empty-users check runs. The redundant `rawPath.startsWith('/assets/')` at `src/app.ts:639` (inside the `isExemptFromEmptyCheck` list) is therefore unreachable.
- Remove the `/assets/` entry from the Branch 1 exemption list.
- **Optional consolidation** (F's call, document the choice in `feature-handoff.md`): hoist a single `PUBLIC_PATH_PREFIXES` constant at module scope listing the prefixes both branches care about, and have Branch 0 + Branch 1 reference it. If F goes this route, do not change the set of paths exempt under either branch — this is a refactor, not a behaviour change.

*Finding #9 — cache "users bootstrapped" boolean:*
- The per-request `request.em.count(User)` at `src/app.ts:652` is replaced with a module-local `let usersBootstrapped = false` cache scoped to the `buildApp()` closure (one cache per app instance — naturally per-test because each test rebuilds the app).
- Logic: while `usersBootstrapped === false`, query `request.em.count(User)`; if `count > 0`, set `usersBootstrapped = true` and never query again. If `count === 0`, leave the cache `false` and continue redirecting to `/setup`.
- **Test-suite implication.** Each `buildApp()` call gets a fresh closure, so existing tests that rely on "no users → redirect to /setup" still behave correctly within their own app instance. F does **not** need to add a reset hook; the per-test app-rebuild is the reset.
- **Optional unit/integration test** (per decomposition): F may add a test asserting the second authenticated request on the same `buildApp()` instance does **not** invoke `em.count(User)` (e.g. via a spy or by counting query log entries). If trivial, include it; the existing integration tests are the regression guard otherwise.

*Finding #10 — inline `GET /` decision (F picks, documents in `feature-handoff.md`):*
- **Option (a) — extract to `src/modules/home/routes.ts`:** Move the `app.get('/', ...)` registration at `src/app.ts:431–433` into a new `src/modules/home/routes.ts` exporting a `FastifyPluginAsync` (matching the canonical shape of `src/modules/ingest/routes.ts` and `src/modules/health/`; `home/schemas.ts` is optional — `GET /` has no Zod-validated body or query). `buildApp()` then `await app.register(homeRoutes)` once. The `pages/home.eta` template stays where it is.
- **Option (b) — keep inline + document:** Add a JSDoc comment above the inline registration referencing `architecture.md §File organization` (the trivial-route clause adjudicated in PR #77) and naming the threshold at which extraction becomes required (e.g. "extract when the handler grows beyond a single `reply.page()` call, or when authentication branching or per-request loading is added").
- **F decides which option; documents the call in `feature-handoff.md §Decisions not covered by planning docs`.** Option (a) is forward-cleaner; option (b) keeps the diff smaller. Either is defensible.
- **Test-tier implication is conditional on this choice** — see "Test tiers required" below.

*Cross-cutting:*
- `npx tsc --noEmit` clean.
- `npx vitest run` — the existing test suite passes. Coverage delta should be ≥ 0 (a small new unit/integration test for finding #9 is optional and additive; the `GET /` extraction in finding #10's option (a) is covered by new page-tiers, not by unit tests).

**Test tiers required.**

| Finding | Unit | Integration | E2E | Page T1 | Page T2 / T2.5 | Page T3 | Notes |
|---|---|---|---|---|---|---|---|
| #3 typed augmentations | no | no | no | — | — | — | Type-level only; `tsc --noEmit` is the verification |
| #5 hook rename | no | no | no | — | — | — | Existing auth integration tests at `src/__tests__/integration/auth.test.ts` are the regression guard |
| #8 dedup | no | no | no | — | — | — | Refactor; existing tests under `src/__tests__/integration/static-asset-auth-bypass.test.ts` are the regression guard |
| #9 users-cache | optional | optional | no | — | — | — | One small test asserting the second request doesn't query `em.count(User)` — F's call to include. The existing empty-users-redirect integration tests are the regression guard otherwise |
| #10 option (a) | no | no | no | **yes** | **yes** | no | New rendered route in its own module → T1 (`/` reachable, 200, renders `home.eta`) + T2 (ARIA — clean room since `/` is publicly accessible after first user exists) |
| #10 option (b) | no | no | no | no | no | no | Inline registration unchanged in shape; no new rendered route → no page tiers |

**Critical assumption for T:** the test tiers T must produce depend on F's option-(a)-or-(b) call for finding #10. T must read F's `feature-handoff.md` (specifically the "Decisions not covered by planning docs" section) to know whether to produce `tier-1-report.md` + `tier-2-report.md` for `GET /` or to mark them N/A.

**Page verification tiers.**
- If F picks finding-#10 option (a): T1 Headless + T2 ARIA (clean room) on `GET /`. T3 Visual: **not required** for this story.
- If F picks finding-#10 option (b): None.

**Critical test paths.**
- Existing `src/__tests__/integration/auth.test.ts` (auth preHandler behavior) — regression guard for finding #5.
- Existing `src/__tests__/integration/static-asset-auth-bypass.test.ts` — regression guard for finding #8.
- Existing empty-users-redirect integration tests (search `src/__tests__/integration/health.test.ts` and any `auth.test.ts` cases that exercise the redirect) — regression guard for finding #9.
- New unit test for finding #9 (optional, F's call).
- New T1 + T2 page tiers under `e2e/tests/` for `GET /` if F picks finding-#10 option (a).

## Required reading

**Skills (full paths).**
- `skills/better-auth-session-and-api-tokens.md` — confirms `preHandler` is the canonical stage for the auth hook (finding #5).
- `skills/fastify-route-convention.md` (if present) — `FastifyPluginAsync` default-export shape for the new `src/modules/home/routes.ts` if F picks finding-#10 option (a).
- `skills/page-verification-hierarchy.md` — T1 → T2 → T3 ordering rule (finding-#10 option (a) requires T2 before any future T3).

**Planning doc sections.**
- `docs/planning/architecture.md §Code Conventions → {File organization, Route registration, Abstraction level}` — file-organization clause for finding #10, route-registration convention for the new module shape if option (a).
- `docs/planning/architecture.md §Security` — line 437 names the global auth hook as "preHandler"; the §Security text is the authority finding #5's rename realigns the code with.
- `docs/planning/architecture.md §Layering and Dependency Direction` — composition root invariant; the typed `FastifyInstance` augmentation in finding #3 makes the seam visible at the type level.

## Implementer notes (from the decomposition + Argos)

- **All five fixes can live in a single PR — no internal sequencing risk.** F should still consider one commit per finding so a reviewer can isolate each (`refactor(audit-composition-root-S3): add typed FastifyInstance augmentation (finding #3)`; `refactor(audit-composition-root-S3): rename onRequest → preHandler for global auth hook (finding #5)`; etc.). One big commit is also acceptable if cleaner.
- **Finding #5 is the only fix that touches a high-stakes hook.** If the existing integration tests pass after the `onRequest` → `preHandler` rename, the semantic-stage change is safe. If they don't, that's the load-bearing reason to leave the hook at `onRequest` and **flag rather than rename** (per the escape hatch in the acceptance criteria above). Document the test results either way in `feature-handoff.md`.
- **Finding #10 option-(a) test scope.** The decomposition declared T1 + T2 on `GET /` if F picks option (a). Page tier T3 (visual) is **not** required for this story — the route renders the same `pages/home.eta` template that's already rendered today; visual regression isn't on the line. If F picks option (a), T's tier scope must include `tier-1-report.md` + `tier-2-report.md` for `GET /`. If F picks option (b), T's tier scope is "none — no new rendered route."
- **`docs/planning/*` discipline.** This story has **zero** authorized `docs/planning/*` edits. If F discovers a planning-doc mismatch during implementation, **flag it in `feature-handoff.md`** for André — do not edit. (Specifically: if F finds that `architecture.md §Security` line 437 or any other section needs an update to match the rename in #5, flag it; the code rename is in scope, the doc update is not.)
- **No new skills to author.** All five findings are covered by existing skills/planning sections.
- **Spec consistency check.** After finding #5's rename, `grep -rn "onRequest" src/app.ts` should return only the per-request EM-fork hook at line ~475 (which stays at `onRequest`). The rest of the diff is `src/app.ts` line-noise; the diff should not net-grow `src/app.ts` materially (small additions for the typed augmentation are expected, but finding #8 removes a line and finding #10 option (a) moves a route out).

## Iteration tracking (for F's awareness)

This brief is F's input on **iteration 1**. On subsequent iterations F is spawned with:
- `architecture-review-<N-1>.md` (F↔A loop, iter N>1, cap 3)
- `fix-pass-notes.md` (Phase 5 fix-pass after T BLOCK)
- `spec-audit-<M-1>.md` (Phase 6b spec-remediation, cap 2; light remediation rule)

Each F invocation appends a `## Iteration <N>` (or `## Fix-pass`, `## Spec-remediation iter <M-1>`) section to `feature-handoff.md`.

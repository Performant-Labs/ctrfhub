# Architecture review — audit-composition-root-S3 — iteration 1

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-20
**Verdict:** PASS
**Diff base:** main @ `76604f4`
**Diff head:** story/audit-composition-root-S3 @ `6e975c7`

## Summary

PASS. All five findings (#3, #5, #8, #9, #10) are addressed cleanly in a single 110-line diff to `src/app.ts`, with no test edits and zero `docs/planning/*` changes. The `FastifyInstance` augmentation exactly mirrors the six `app.decorate(...)` call sites (verified line-by-line); the `onRequest` → `preHandler` rename is applied only to the auth hook at line 708, with the EM-fork hook at line 533 correctly left on `onRequest`; the redundant `/assets/` exemption is removed with a comment explaining the asymmetry; the `usersBootstrapped` cache is closure-scoped to `buildApp()` and exception-safe; and the finding-#10 option-(b) JSDoc cites the architecture-doc clause that authorises it with a non-trivial four-condition extraction threshold. No architectural drift detected.

## Findings

No drift detected.

## Prior-iteration check

N/A — this is iteration 1; no prior `architecture-review-*.md` exists.

## Notes for the implementer

None — verdict is PASS, no fixes required. The next phase is T (Phase 4 spawn).

For Argos: per F's documented finding-#10 option-(b) call, T's page-tier scope is **none** (no new rendered route). Per the brief's "Test tiers required" table row #10(b), T should mark `tier-1-report.md` / `tier-2-report.md` as N/A and rely on the existing integration suite (`auth.test.ts`, `static-asset-auth-bypass.test.ts`, `rate-limit-and-auth-log.test.ts`, `health.test.ts`) as the regression guard for findings #3, #5, #8, #9.

## Verification trace

### Finding #3 — typed `FastifyInstance` augmentation

- The interface added at `src/app.ts:97–110` lives inside the existing `declare module 'fastify' { … }` block alongside the pre-existing `FastifyContextConfig` / `FastifyRequest` / `FastifyReply` augmentations. Slot is clean — no parallel `declare module` block.
- Backing types: `EventBus`, `ArtifactStorage`, `AiProvider` imported from `./types.js` (line 49). Verified those are exported from `src/types.ts` (lines 19, 33–34, 44–45).
- Six fields mapped 1:1 to decorate call sites:
  - `orm: MikroORM` ↔ `app.decorate('orm', orm)` at line 522
  - `eventBus: EventBus` ↔ `app.decorate('eventBus', eventBus)` at line 573
  - `artifactStorage?: ArtifactStorage` ↔ `app.decorate('artifactStorage', artifactStorage)` at line 577 (gated on `if (artifactStorage)` — `?` is honest)
  - `aiProvider?: AiProvider` ↔ `app.decorate('aiProvider', aiProvider)` at line 598 (gated on `if (aiProvider)` — `?` is honest)
  - `getBootState(): BootState` ↔ `app.decorate('getBootState', …)` at line 227
  - `setBootState(state: BootState): void` ↔ `app.decorate('setBootState', …)` at line 233
- Optionality is honest: only the two truly-gated decorators carry `?`. `orm`, `eventBus`, `getBootState`, `setBootState` are unconditional and typed as required.
- Pre-existing `FastifyRequest.em: any` augmentation at lines 117–118 is untouched — out-of-scope guardrail respected.
- `tsc --noEmit` clean (verified locally — 0 errors).

### Finding #5 — `onRequest` → `preHandler` auth-hook rename

- `grep -n addHook src/app.ts` returns four hooks: `onSend` (line 393, response observability), `onRequest` (line 533, EM-fork), `onClose` (line 622, shutdown), `preHandler` (line 708, auth). Exactly one `onRequest` data-path hook (EM-fork) and exactly one `preHandler` data-path hook (auth) — the spot-check the prompt asked for.
- The auth-hook JSDoc at lines 694–702 documents the stage choice with the right citations (`architecture.md §Security` line 437, `skills/better-auth-session-and-api-tokens.md`) AND explicitly explains why the EM-fork hook above stays on `onRequest` (downstream preHandlers and handlers read `request.em`). The "why both, not one" rationale lives next to the code, which is the right place for it.
- Verified architecture.md §Security line 437 (read in context): the doc reads "Authentication is enforced by a **single global `preHandler` hook** registered in `buildApp()` (`src/app.ts §9`)." The rename brings the code into alignment with the doc; no doc edit needed (F correctly flagged this in the handoff).
- Full vitest suite passes (513/513), confirming the load-bearing-reason escape hatch did not trigger.

### Finding #8 — redundant `/assets/` exemption removed

- The `rawPath.startsWith('/assets/')` line is gone from Branch 1's `isExemptFromEmptyCheck` OR-chain (verified: not present in lines 730–742). Branch 0's unconditional return at lines 717–719 is now the single source of truth for `/assets/*` bypass.
- The new comment at lines 725–728 explains why Branch 1 doesn't repeat the prefix and names the drift risk a unified list would hide — exactly the right altitude for an in-code comment.
- F's decision to **decline** the optional `PUBLIC_PATH_PREFIXES` consolidation is well-reasoned and within the brief's "F's call" allowance. Branch 0 and Branch 1 encode semantically distinct allow-lists ("never see auth" vs "exempt from empty-users redirect"); unifying them would obscure that distinction. No drift.

### Finding #9 — `usersBootstrapped` closure cache

- `let usersBootstrapped = false;` at line 682 lives inside `buildApp()` (function body spans lines 194–968) — closure-scoped, not module-scoped. Verified by inspecting the function-boundary braces. Each `buildApp()` call gets a fresh cache; per-test app rebuilds are the natural reset.
- The cache-aware gate at line 744 (`if (!isExemptFromEmptyCheck && !usersBootstrapped)`) reads correctly: cache miss → COUNT query; cache hit → skip the whole block (including the redirect attempt, which is intentional — once a user exists, the redirect can never fire again for this app instance).
- Exception safety: the `catch` block at lines 751–757 leaves `usersBootstrapped` at `false` (it never sets it inside the try-catch), so a `user`-table-missing failure on request N still re-queries on request N+1. The added comment at lines 755–756 documents this. Correct.
- Latch happens at line 772 (`usersBootstrapped = true;`) only after a non-zero `userCount` and only inside the `if (!isExemptFromEmptyCheck && !usersBootstrapped)` block — so the latch can never be set spuriously by an exempt request.
- The naming `usersBootstrapped` is consistent with the surrounding closure variables (`currentBootState` at line 221, `stopSweeper` at line 596). No new naming convention.
- F's decision to **skip** the optional unit test is correct per F's role boundary (`.claude/agents/feature-implementer.md` forbids writing under `src/__tests__/`). T may add it during Phase 4; the existing integration tests cover the behavioural invariant.

### Finding #10 — inline `GET /` option (b)

- F picked option (b) (inline + JSDoc, no module extraction). This call is explicitly permitted by the brief.
- The JSDoc at `src/app.ts:462–487` is substantive, not boilerplate. It:
  - Cites `architecture.md §Code Conventions → File organization` — and the trivial-route clause genuinely exists at lines 777–781 of that doc, naming `/health` as the canonical inline-route example. Citation is accurate.
  - Cites PR #77 as the adjudicating PR for the trivial-route clause.
  - Names a four-condition extraction threshold: (1) handler grows beyond single `reply.page()`, (2) Zod schema becomes necessary, (3) route gains route-level config, (4) sibling routes accrete. The threshold gives a future maintainer concrete triggers, not generic "extract when complex." Honest.
  - Closes with a readability rationale that explains *why* inline beats extraction at the current altitude (reader scanning top-to-bottom sees the route alongside the `reply.page()` decorator). Aligned with the architecture doc's intent for the trivial-route clause.
- Per F's documented call: no new module file, no new rendered route, **no page-tier scope change for T**. T's Phase 4 scope therefore reduces to "regression-guard the existing integration suite" — Decision D-2 in `decisions.md` flows through cleanly.

### Cross-cutting guardrails

- **`docs/planning/*` discipline:** `git diff --name-only origin/main..story/audit-composition-root-S3 -- docs/planning/` returns empty. Zero authorized planning edits, zero actual planning edits. Clean.
- **Test-file edits:** `git diff --stat origin/main..story/audit-composition-root-S3 -- src/__tests__/ e2e/ tests/` returns empty. F correctly stayed out of T's lane.
- **Forbidden patterns (CTRFHub `CLAUDE.md`):** None present. The diff is type-augmentation + JSDoc + a string-literal change (`'onRequest'` → `'preHandler'`) + a control-flow `&&` clause + an OR-chain entry removal. No HTMX, Alpine, MikroORM-dialect, Better-Auth, or Zod-schema-location concerns are touched.
- **Composition-root invariant:** The diff does not introduce any new `app.register` / `app.addHook` / `app.decorate` outside `src/app.ts`. The composition root is still the only file that owns those seams; the new `FastifyInstance` interface makes them visible at the type level, raising the seam's altitude without moving it. Aligned with `architecture.md §Layering and Dependency Direction`.
- **Pre-existing lint warnings** (15 `no-explicit-any` in `src/app.ts`): unchanged by this story; explicitly out of scope per the prompt.

## Patterns referenced

- `src/app.ts` baseline (`origin/main @ 76604f4`) — the existing `declare module 'fastify' { … }` augmentation block (was `FastifyContextConfig` + `FastifyRequest` + `FastifyReply`; now extended with `FastifyInstance`).
- `src/app.ts:533` — the EM-fork `onRequest` hook the new auth `preHandler` hook deliberately runs *after*. Existing pattern preserved.
- `src/types.ts` — canonical export site for `EventBus`, `ArtifactStorage`, `AiProvider`. The new interface imports from the project's intended re-export point, not directly from `./services/event-bus.js` or `./services/ai/types.js`.
- `docs/planning/architecture.md §Code Conventions → File organization` (lines 777–781) — the trivial-route clause the finding-#10 JSDoc cites. Verified verbatim.
- `docs/planning/architecture.md §Security` (line 437 + surrounding paragraph) — the "single global `preHandler` hook" text the finding-#5 rename realigns the code with.
- `src/modules/health/schemas.ts` / `src/modules/health/` — the canonical "trivial route" example the architecture doc names; `/health` is registered inline in `buildApp()` the same way `GET /` now is, with the schema living in a sibling file.

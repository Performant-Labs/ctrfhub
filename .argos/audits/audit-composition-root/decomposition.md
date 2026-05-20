# Decomposition — audit-composition-root

**Date:** 2026-05-20
**Source:** `.argos/audits/audit-composition-root/findings.md`
**Findings input:** 11 (0 block, 11 warn)
**Stories proposed:** 3
**Findings dropped or merged:** 8 merged into the three theme stories; 0 dropped

## Disposition of findings

| Finding # | Disposition | Justification |
|---|---|---|
| 1  | → Story `audit-composition-root-S1` | Composition-root rate-limit default key + 429 response shape misaligned with the canonical DD-012/DD-029 contract. |
| 2  | → Story `audit-composition-root-S2` | ~70 lines of AI-pipeline wiring inlined in `buildApp()` belong behind a `wireAiPipeline(...)` function — leverage fix. |
| 3  | → Story `audit-composition-root-S3` | Six `app.decorate(...)` calls lack matching `FastifyInstance` augmentations — small, mechanical. |
| 4  | merged into `audit-composition-root-S2` | LIFO `onClose` semantics undocumented; the natural fix is a single explicit shutdown function — same restructuring as #2's altitude theme. |
| 5  | merged into `audit-composition-root-S3` | `onRequest` vs. doc-name `preHandler` for the auth hook — XS rename. |
| 6  | merged into `audit-composition-root-S1` | API-key 401 branch logs nothing; pairs with #1 as a DD-012/DD-029 observability-contract alignment. |
| 7  | merged into `audit-composition-root-S2` | EventBus runtime guard papers over test-double laxity; the fix is to tighten test doubles at the source — same composition-root altitude theme. |
| 8  | merged into `audit-composition-root-S3` | Redundant `/assets/` path-prefix in two branches — XS dedup. |
| 9  | merged into `audit-composition-root-S3` | Per-request `COUNT(*) FROM user` once a user exists — XS caching fix. |
| 10 | merged into `audit-composition-root-S3` | Inline `GET /` — XS classification decision (trivial-route clause vs. module extraction). |
| 11 | merged into `audit-composition-root-S2` | `/health` 503-during-boot contract is currently undeliverable (server isn't listening when boot states transition). Restructures `buildApp()` ordering — same altitude theme. |

No finding was dropped: none duplicates an open `gaps.md` item (G-P0-001..004 / G-P1-001..009 / G-P2-* / G-P3-001 are unrelated to the composition root), and none is below the story threshold once themed. **#11 deserves explicit flagging:** it surfaces that `INFRA-001`'s shipped acceptance criterion "`GET /health` returns correct `bootState` shape and 503 during migrations" is structurally undeliverable as built — the server starts listening *after* schema sync. Not a gap (the doc and code agree on intent; the implementation didn't honour it), but the decomposition records it for André's awareness.

## Proposed stories

### Story `audit-composition-root-S1`: Align composition-root rate-limit + auth-failure logging with DD-012 / DD-029

**Source findings:** #1, #6 from `findings.md`
**Severity carried over:** warn
**Estimated size:** S (1–4 hr)

**Acceptance criteria:**
- `@fastify/rate-limit` is registered with `keyGenerator: (req) => req.user?.id ?? req.ip` (or equivalent that keys on session-user id post-auth, falling back to IP pre-auth) per DD-012 Layer 2 "General authenticated API" row.
- `errorResponseBuilder` emits the DD-029 response shape: HTTP body `{"error":"rate_limited","code":"too_many_requests","retry_after_s":<int>}` and the `RateLimit-*` / `Retry-After` headers RFC 9728 requires.
- A code comment on the registration block cites DD-012/DD-029 so the seam isn't re-reverted.
- The global auth preHandler's API-key invalid-key branch (currently `src/app.ts:569–582`) emits a single Pino log line before the 401 — `event=auth.api_key_invalid`, `tokenPrefix=<first 8 chars>`, `ip=<request.ip>`, message `"Invalid API key on x-api-token"` — mirroring DD-029's `event=*` log shape. The raw token value is never logged (the existing SECURITY comment must remain honoured).
- `tsc --noEmit` clean; existing test suite passes.

**Files in scope:**
- `src/app.ts` — `fastifyRateLimit` registration (~lines 226–229); the API-key branch (~lines 569–582).

**Required skills:**
- `skills/better-auth-session-and-api-tokens.md` — confirms the `presence-not-value` logging posture for auth decisions.

**Required planning sections:**
- `docs/planning/database-design.md §DD-012` (Layer 2 rate-limit table) and `§DD-029` (response-shape consolidation).
- `docs/planning/architecture.md §Backend → Rate limiting` (declares DD-012/DD-029 canonical).
- `docs/planning/architecture.md §Code Conventions → Logging` (the "log decisions without the value" rule).

**Declared test tiers:**
- Unit: no.
- Integration: yes — one test asserting the rate-limit `errorResponseBuilder` emits the DD-029 body + `Retry-After` header on a forced 429; one test asserting the auth API-key invalid-key branch emits the `event=auth.api_key_invalid` Pino line with `tokenPrefix` but without the raw token.
- E2E: no.
- Page verification: none — `/api/*` routes are not rendered.

**Dependencies:**
- Blocks: none.
- Blocked by: none. (No file overlap with PR #80 / PR #79.)

**Implementer notes:**
- Care with `keyGenerator`: only key on `req.user?.id` *after* auth has resolved; pre-auth requests must fall back to `req.ip`. Otherwise unauthenticated DDoS traffic all keys to `undefined` and breaks the limiter.
- DD-029's body shape is non-negotiable — match it byte-for-byte; downstream UI and CLI clients parse it.

### Story `audit-composition-root-S2`: Tighten composition-root altitude — extract AI wiring, consolidate `onClose`, restructure boot for honest `/health` 503

**Source findings:** #2, #4, #7, #11 from `findings.md`
**Severity carried over:** warn
**Estimated size:** M (half-day)

**Acceptance criteria:**
- A new module `src/services/ai/pipeline/wire.ts` exports `wireAiPipeline(app, { eventBus, aiProvider, orm })`. `buildApp()` calls it once. The five AI-pipeline imports currently leaked into `app.ts` (lines 57–63 — `categorizeRun`, `correlateRootCauses`, `generateSummary`, `recoverStalePipelineRows`, `startSweeper`) collapse to a single import of `wireAiPipeline`.
- The five `onClose` hooks (currently registered at app.ts:368/380/387/402/477) are consolidated into one explicit shutdown function whose teardown order is dependency-correct *as written* (sweeper → AiProvider → ArtifactStorage → EventBus → ORM) — i.e. the code reads in the order it executes, not in the inverse-LIFO order of the current hooks.
- The runtime EventBus guard at `app.ts:410` is **removed**. Any test double currently typed as `EventBus` but implementing only `close()` is tightened in its own test-helper file to implement `publish`/`subscribe`/`close` as no-ops (or exposed as a different `Pick<EventBus,'close'>` sub-interface). The interface contract is enforced by the type system, not by a runtime check.
- The boot sequence is restructured so `GET /health` is registered *before* schema sync runs and `app.listen()` is called *before* schema sync runs (with `bootState` transitioning `booting → migrating → ready` asynchronously after `listen()`). A probe arriving during schema sync now receives the documented 503 with the boot-state body — honouring the contract `architecture.md §Health endpoint` line 553 promises.
- `tsc --noEmit` clean; existing test suite passes; the AI-pipeline integration tests (subscribers fire, sweeper runs, recovery runs at boot) all pass after extraction.

**Files in scope:**
- `src/app.ts` — primary edit (AI imports collapse to one; shutdown consolidated; boot reordered).
- `src/services/ai/pipeline/wire.ts` — new file.
- `src/services/ai/pipeline/index.ts` — possibly: re-export `wireAiPipeline` from the barrel.
- Test helpers under `src/__tests__/` — only the EventBus double's interface tightening (no test-authoring; this is a test-helper edit to make an existing double honest about its declared type — flagged for André to confirm acceptable as F-scope).

**Required skills:**
- `skills/better-auth-session-and-api-tokens.md` — auth preHandler interaction with boot ordering.

**Required planning sections:**
- `docs/planning/architecture.md §Layering and Dependency Direction` — composition root carries DI seams; internal wiring lives in its module.
- `docs/planning/architecture.md §Code Conventions → Abstraction level` — "match the altitude of your neighbours."
- `docs/planning/architecture.md §Production Deployment → Graceful shutdown` — shutdown sequence.
- `docs/planning/architecture.md §Health endpoint` — the 503-during-sync contract this story makes deliverable.
- `docs/planning/ai-features.md §Durability and restart recovery` — `recoverStalePipelineRows` is part of the AI-pipeline domain, not the composition root's.

**Declared test tiers:**
- Unit: yes — small unit test on `wireAiPipeline` that the three subscribers are registered and the sweeper is started.
- Integration: yes — one test asserting `/health` returns 503 with the `bootState` body while schema sync is in progress (this is the test that proves the boot restructuring works — and that INFRA-001's original acceptance criterion is now deliverable).
- E2E: no.
- Page verification: none — `/health` is not a rendered page (JSON response).

**Dependencies:**
- Blocks: none directly, but **`audit-composition-root-S3` is best sequenced AFTER S2** — S3's consistency cleanups (typed decorations, `onRequest`→`preHandler` rename, redundant `/assets/` dedup, COUNT caching, inline-`/`-decision) are easier on a settled `buildApp()` foundation.
- Blocked by: none.

**Implementer notes:**
- This story restructures the boot ordering of a high-stakes file. The `/health`-before-listen restructuring is the load-bearing change — without it, finding #11 is unresolved. Keep the diff explicit: extract first, consolidate `onClose` second, restructure boot last, in separate commits if useful so a reviewer can isolate each.
- **Alternative for finding #11.** If the boot restructuring proves disruptive, an alternative is to *document* the current behaviour (connection-refused, not 503, during early boot) by updating `architecture.md §Health endpoint` and the JSDoc at `app.ts:14`. That alternative is **out of scope for this story** because it would touch `docs/planning/*` — surfaced for André: if you prefer the doc-fix route, that requires a separate authorized exception. The default this story takes is "honour the doc-stated contract by fixing the code."
- The EventBus runtime guard's removal is contingent on the test-double tightening landing in the same PR; do them together or revert both.

### Story `audit-composition-root-S3`: Composition-root consistency cleanups — types, naming, dedup, caching

**Source findings:** #3, #5, #8, #9, #10 from `findings.md`
**Severity carried over:** warn
**Estimated size:** S (1–4 hr — five small fixes bundled)

**Acceptance criteria:**
- A `declare module 'fastify' { interface FastifyInstance { orm: MikroORM; eventBus: EventBus; artifactStorage?: ArtifactStorage; aiProvider?: AiProvider; getBootState(): BootState; setBootState(s: BootState): void; } }` block sits alongside the existing `FastifyContextConfig` / `FastifyRequest` / `FastifyReply` augmentations in `src/app.ts`. The six `app.decorate(...)` calls type-check against it.
- The global auth hook is registered as `addHook('preHandler', ...)` (not `onRequest`) to match `architecture.md §Security` line 437 and `skills/better-auth-session-and-api-tokens.md`. (If F finds a load-bearing reason the hook must run at `onRequest` stage, F flags it instead of renaming — but the default is the rename.)
- The redundant `rawPath.startsWith('/assets/')` check inside the empty-users-exemption list at app.ts:524 is removed (Branch 0 already short-circuits at line 510). Optionally: hoist `PUBLIC_PATH_PREFIXES` into a single constant referenced by both branches.
- The per-request `request.em.count(User)` in the empty-users branch is replaced with a module-local `let usersBootstrapped = false` cache — query DB only while `false`, set `true` on first non-zero result, then never query again.
- `GET /` is **either** (a) extracted to `src/modules/home/routes.ts` to match the canonical module shape, **or** (b) the inline registration gets a JSDoc comment naming the §File-organization trivial-route clause and the threshold at which extraction is required. F decides; documents the choice in `feature-handoff.md`.
- `tsc --noEmit` clean; existing test suite passes.

**Files in scope:**
- `src/app.ts` — primary edit (all five findings).
- `src/modules/home/routes.ts` — new file *if* F chooses option (a) for finding #10.

**Required skills:**
- (none new — all rules sit inside `architecture.md`).

**Required planning sections:**
- `docs/planning/architecture.md §Code Conventions → {File organization, Route registration, Abstraction level}`.
- `docs/planning/architecture.md §Security` — the `preHandler` naming for the auth hook.

**Declared test tiers:**
- Unit: no.
- Integration: optional — F may add one test asserting the empty-users-cache no longer queries on the second authenticated request (counts `em.count` invocations via a spy, or uses an in-memory test double counter). If trivial, include it; if not, the existing auth integration tests are the regression guard.
- E2E: no.
- Page verification: T1 + T2 on `GET /` if F chooses option (a) (new rendered route in its own module). N/A if F chooses option (b) (no structural change).

**Dependencies:**
- Blocks: none.
- Blocked by: none, but **best sequenced AFTER `audit-composition-root-S2`** — these cleanups read more cleanly on the settled boot ordering and the extracted AI wiring.

**Implementer notes:**
- All five fixes can live in a single PR — no internal sequencing risk. F should still consider one commit per finding so a reviewer can isolate each.
- The `onRequest` → `preHandler` rename is the only fix that touches a high-stakes hook. If the existing integration tests pass after the rename, the semantic-stage change is safe; if they don't, that's the load-bearing reason to leave the hook at `onRequest` and update `architecture.md` instead (which requires another authorized exception — surface to André at that point).

## Out of scope but noticed (carried over from `findings.md`)

- **`recoverStalePipelineRows` fire-and-forget semantics** — conformant with the "swallowed only when explicitly safe + commented" rule, but the boundary between "fatal at boot" and "non-fatal at boot" for AI-pipeline state is a policy worth re-reviewing in a future **`audit-ai-pipeline`** (territory T5).
- **`registerAuthRoutes` vs. `ingestPlugin` shape variance** — already adjudicated in `architecture.md` line 745; re-confirm during the eventual AUTH-002 audit that the canonical-shape conversion happened.
- **`AppOptions` DI seam invariant.** Currently healthy — no ambient module-level singletons. Recommend a follow-up T6 audit after dashboard / SSE / search modules land — they are the most likely sources of new cross-cutting dependencies.
- **`dist/assets/` vs. `src/assets/` bridge** — Dockerfile-owned, not `app.ts`'s; flag for a separate Dockerfile audit territory if one is run.

## Next action (André, via Dispatch)

Three proposed stories — all `warn`-severity. Recommended order:

1. `Start story audit-composition-root-S1` — DD-012/DD-029 alignment (S; smallest; no dependency on others).
2. `Start story audit-composition-root-S2` — composition-root altitude + boot restructuring (M; most consequential; surfaces the alternative on finding #11 that requires your call).
3. `Start story audit-composition-root-S3` — consistency cleanups (S; easier on the post-S2 foundation).

Argos does **not** auto-spawn implement loops. Each needs an explicit kickoff. You may drop or re-scope any entry first.

**One item needs your decision before `audit-composition-root-S2` is kicked off:** finding #11 (the `/health` 503-during-boot contract) has two paths — restructure the code to honour the doc (this story's default) or update the doc + JSDoc to admit MVP behaviour (connection-refused, not 503). The doc-fix path requires a separate authorized exception to `docs/planning/*`. Confirm or override at kickoff.

The audit loop for `audit-composition-root` ends here. Recommended next territory per the campaign plan: `Audit scope audit-ingest`.

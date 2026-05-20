# Decomposition — audit-auth

**Date:** 2026-05-19
**Source:** `.argos/audits/audit-auth/findings.md`
**Findings input:** 4 (0 block, 4 warn)
**Stories proposed:** 2
**Findings dropped or merged:** 2 merged (Findings 2 → S1, 4 → S2); 0 dropped

## Disposition of findings

| Finding # | Disposition | Justification |
|---|---|---|
| 1 | → Story `audit-auth-S1` | Standalone root cause — dead `getAuth()`/`_auth` singleton. Highest-leverage fix in the subsystem; clean XS deletion scope. |
| 2 | merged into `audit-auth-S1` | Same root cause as #1 — the stale header/`@example` JSDoc describes the dead singleton as the live access path. Fixing #1 without #2 would leave the doc lying; they are one edit. |
| 3 | → Story `audit-auth-S2` | `database as any` cast on the Better Auth config. Independent of #4 but co-located in `buildAuth()`'s config object. |
| 4 | merged into `audit-auth-S2` | Hardcoded dev-secret fallback — co-located with #3 in `buildAuth()`'s config object; bundling minimizes churn on a high-stakes file. Kept distinct as its own acceptance criterion. |

No finding was dropped: none duplicates an open `gaps.md` item (G-P3-001 is Better-Auth test-flakiness, unrelated to these production-code findings) and none is below the story threshold once themed. No finding duplicates a `tasks.md` row.

## Proposed stories

### Story `audit-auth-S1`: Remove the dead `getAuth()` singleton and fix the stale auth JSDoc

**Source findings:** #1, #2 from `findings.md`
**Severity carried over:** warn
**Estimated size:** XS (<1 hr)

**Acceptance criteria:**
- `getAuth()` and the module-level `_auth` lazy-singleton variable are deleted from `src/auth.ts`.
- `buildAuth()` and the `AuthInstance` type alias are retained unchanged — they are the live API.
- The `src/auth.ts` file-header JSDoc is rewritten to describe `buildAuth()` as a factory called once by `buildApp()` (`src/app.ts`) as the composition root, and once per integration test with an in-memory DB — it no longer references a consumed `auth` singleton or a `getAuth()` access path.
- `grep` confirms zero remaining references to `getAuth`/`_auth` anywhere in `src/` (including `src/__tests__/` — see implementer notes).
- `tsc --noEmit` clean; the existing test suite still passes.

**Files in scope:**
- `src/auth.ts` — primary edit (delete singleton, rewrite header JSDoc)

**Required skills:**
- `skills/better-auth-session-and-api-tokens.md` — the auth subsystem's conventions; confirms `buildAuth()` is the intended factory shape.

**Required planning sections:**
- `docs/planning/architecture.md §Layering and Dependency Direction` — "`buildApp()` is the composition root" — the rationale for direct instantiation over a module-level singleton.
- `docs/planning/architecture.md §Code Conventions → Abstraction level` — "ambient module-level singletons" named as the anti-pattern.

**Declared test tiers:**
- Unit: no — pure deletion of dead code; no new logic.
- Integration: no — no behaviour change; existing auth integration tests are the regression guard.
- E2E: no.
- Page verification: none — `src/auth.ts` has no rendered route.

**Dependencies:**
- Blocks: none.
- Blocked by: none. (Independent of AUTH-002 — it deletes code AUTH-002 does not use.)

**Implementer notes:**
- Narrowly-scoped deletion — do **not** expand surface area or refactor `buildAuth()` itself.
- `findings.md §Out of scope but noticed` flags a risk: a test file under `src/__tests__/` may still import the dead `getAuth()`. Check for and remove any such stale import as part of this story — if one exists, the deletion will not compile until it is fixed. This is the one place the story legitimately touches a test file (removing a now-invalid import is not test authoring).

### Story `audit-auth-S2`: Harden the Better Auth config — type the DB connection, fail-fast on a missing secret

**Source findings:** #3, #4 from `findings.md`
**Severity carried over:** warn
**Estimated size:** S (1–4 hr)

**Acceptance criteria:**
- `buildDatabase()` (in `src/auth.ts`) is given an explicit return type so the `database: database as any` cast and its blanket `eslint-disable @typescript-eslint/no-explicit-any` can be removed from `buildAuth()`'s config object.
- `buildAuth()` fails fast — throws — when `BETTER_AUTH_SECRET` is unset **and** `NODE_ENV === 'production'`, rather than silently falling back to the source-visible dev-secret literal.
- The dev-secret fallback remains available for local/test use only (gated behind an explicit non-production check).
- `tsc --noEmit` clean (no remaining `any` on the `database` field); the existing test suite still passes.

**Files in scope:**
- `src/auth.ts` — primary edit (`buildDatabase()` return type, `secret:` fallback guard).

**Required skills:**
- `skills/better-auth-session-and-api-tokens.md` — Better Auth config conventions, secret/session posture.

**Required planning sections:**
- `docs/planning/architecture.md §Security` — CSRF/session posture.
- `docs/planning/architecture.md §Environment variables` — the required-secret table. **Open question for F / André (see Next action):** the spec's required table lists `SESSION_SECRET` (min-32-char), but the code reads `BETTER_AUTH_SECRET`. F must confirm which name is canonical; if they are genuinely two names for one secret, that is a spec-vs-code naming drift worth a `gaps.md` entry — flag it, do not resolve it unilaterally.

**Declared test tiers:**
- Unit: no.
- Integration: yes — one integration test asserting `buildAuth()` throws when `BETTER_AUTH_SECRET` is unset under `NODE_ENV=production`, and does **not** throw (uses the dev fallback) outside production.
- E2E: no.
- Page verification: none — `src/auth.ts` has no rendered route.

**Dependencies:**
- Blocks: none.
- Blocked by: none, but **sequence-sensitive with AUTH-002.** AUTH-002 (`[/]` in `tasks.md`) is the first-boot setup wizard and may touch `src/auth.ts`. To avoid a merge collision on a high-stakes file, kick this off either before AUTH-002 starts or after it merges — not concurrently. `architecture.md §Code Conventions → Route registration` names AUTH-002 as the opportunistic point to also normalize `registerAuthRoutes` to the canonical `FastifyPluginAsync` shape; that normalization is **not** part of this story and should not be folded in here.

**Implementer notes:**
- High-stakes file (auth) — keep the diff tight: two changes only (DB return type, secret guard). No route changes, no singleton work (that is `audit-auth-S1`).
- The `as any` DI-seam idiom also appears in `src/modules/ingest/routes.ts` (`fastify.eventBus`); this story fixes only the auth-DB instance, which is the least desirable place for the cast. Do not chase the ingest occurrence here.

## Out of scope but noticed (carried over from `findings.md`)

- **Global auth preHandler** (`src/app.ts §9`) — territory **T6 (`audit-composition-root`)**, not yet audited. `findings.md` carried two observations into T6: (a) `app.ts:176` calls `buildAuth(options.db)` directly — relevant to T6's composition-root DI assessment; (b) the preHandler's API-key branch logs presence-not-value and returns `401` early — looked conformant, worth confirming under T6's lens.
- **`src/modules/auth/` ships no `service.ts`** — correct and expected (Better Auth *is* the service for `/api/auth/*`; `architecture.md §Module boundaries` makes `service.ts` conditional). Noted only so a future audit does not mistake its absence for drift.
- **Stale auth-export imports in the test suite** — folded into `audit-auth-S1`'s scope above; also worth a glance when the test-suite audit territory runs.

## Next action (André, via Dispatch)

Two proposed stories, both `warn`-severity, both small. To act on either, send a kickoff line:

```
Start story audit-auth-S1
```

Argos will use this `decomposition.md` entry as the Phase 1 seed brief for the implement loop. Argos does **not** auto-spawn implement loops from decomposition entries — each needs an explicit kickoff, and you may drop or re-scope either entry first.

**One item needs your decision before `audit-auth-S2` is kicked off:** the `SESSION_SECRET` (spec) vs `BETTER_AUTH_SECRET` (code) environment-variable naming mismatch (see S2's Required planning sections). If you want it resolved as a spec correction, that is a separate `gaps.md` entry / spec-cleanup — Argos did not file it unilaterally since `gaps.md` is under `docs/planning/*`.

The audit loop for `audit-auth` ends here. Recommended next territory per the campaign plan: `Audit scope audit-composition-root`.

# Spec-enforcer Audit — audit-auth-S1 — iteration 1

**Executed:** 2026-05-19 (review timestamp)
**Reviewer:** spec-enforcer (Claude Opus 4.7, 1M context) — read-only
**Scope:** diff `main..story/audit-auth-S1` (head `a298a9b`, base `ba7d55c`)
**Checklists run:** Acceptance criteria (5 of 5 from `brief.md`), Scope discipline, Forbidden patterns (CLAUDE.md), JSDoc semantic faithfulness against `architecture.md §Layering and Dependency Direction` + `§Code Conventions → Abstraction level`, Ruling on F's flagged decision, Test-tier discipline.

## Prior-iteration check

N/A — iteration 1.

## Findings

No drift detected against `skills/` or `docs/planning/*`.

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|

The diff is a pure dead-code deletion (the `_auth` singleton and exported `getAuth()` function, plus their JSDoc and section banner) in `src/auth.ts` lines 195–227 of the prior file, accompanied by a rewrite of the file-header JSDoc (lines 1–38 of the new file). No code outside that surface area changed. `buildAuth()`, the `AuthInstance` type alias, the `SessionUser`/`ApiKeyUser` interfaces, the Fastify module augmentation, `buildDatabase()`, the API-key plugin config, the `database as any` cast (line 148 — `audit-auth-S2`'s scope), and the dev-secret fallback (line 134 — `audit-auth-S2`'s scope) are all untouched. The rewritten JSDoc cites `§Layering and Dependency Direction` (architecture.md:609) and `§Code Conventions → Abstraction level` (architecture.md:861) — both anchors exist and the prose mirrors §Abstraction level's third bullet about "ambient module-level singletons" verbatim in intent.

## Coverage gaps

Coverage matches the story's declared Test tiers required and Page verification tiers. `brief.md §Test tiers required` declares Unit/Integration/E2E all `no` (deletion-only; no behaviour change). `brief.md §Page verification tiers` declares none (`src/auth.ts` has no rendered route). T correctly authored no new tests and ran the existing 498-test suite as the regression guard (`test-handoff.md §Regression checks`). Refusing to author a "`getAuth` is undefined" assertion was the right call — it would be a source-file property assertion, not a behavioural assertion, and the grep-based acceptance criterion is already the mechanical proof.

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] `architecture.md §Layering and Dependency Direction` — `buildApp()` is the composition root; the new JSDoc (`src/auth.ts:7–11`) describes exactly this contract — `buildApp()` calls `buildAuth(options.db)` once per app instance and threads the result into the preHandler and `registerAuthRoutes()`. Verified at `src/app.ts:176` (`const auth = await buildAuth(options.db);`) and `src/app.ts:669` (`await registerAuthRoutes(app, auth);`).
- [x] `architecture.md §Code Conventions → Abstraction level` — "ambient module-level singletons" named as the anti-pattern; this story removes exactly that anti-pattern. The new JSDoc (`src/auth.ts:13–17`) cites this section by name and reproduces its rule: cross-cutting dependencies a test needs to substitute belong on `AppOptions`, not as module-level singletons.
- [x] Brief's literal-grep contract — `grep -rn "getAuth\|_auth\b" src/` exits 1 with zero matches. Verified locally just now.
- [x] `skills/better-auth-session-and-api-tokens.md` — `buildAuth()` shape, `x-api-token` header, `ctrf_` prefix, key-hashing-on default — all retained unchanged in the surviving code.
- [x] Scope discipline — diff names are exactly `src/auth.ts` plus six `.argos/stories/audit-auth-S1/*.md` files. No other `src/` files, no test files, no planning docs, no config.

## Forbidden-pattern scan (from CLAUDE.md)

Scan the diff for each forbidden pattern; note explicitly if none were found.

- [x] No `hx-target`/`hx-swap` inherited from a parent — N/A (no template change)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — N/A (no client code change)
- [x] No `hx-disable` anywhere in templates — N/A
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — N/A
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — N/A (no entity/migration change; `buildDatabase()` retains the dual-dialect selector unchanged)
- [x] No DB mocked in integration tests — N/A (no test change; existing integration tests are the regression guard and continue to use real `:memory:` SQLite)
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — N/A
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — confirmed. The only `csrf`/`cookie`/`session` mentions remaining in `src/auth.ts` are inside JSDoc commentary or inside the `betterAuth()` config object's plugin section. No raw cookie or CSRF manipulation was introduced; the deletion did not cross the Better Auth boundary because `getAuth`/`_auth` were dead code with zero callers (confirmed by `grep -rn` returning zero matches across `src/` before *and* after).
- [x] No Zod schema defined ad-hoc in a handler — N/A

## Ruling on F's flagged decision (handoff §"Decisions not covered by planning docs")

**F's call stands.** F reworded the new JSDoc to avoid the literal `getAuth` substring rather than naming the absent symbol explicitly (i.e. "this module caches no instance and exposes no module-level accessor function" rather than "no `getAuth()` accessor"). A ratified this in `architecture-review-1.md §Ruling on F's flagged decision` and reaffirmed in iter 2. I concur for three independent reasons:

1. **The brief's acceptance criterion is literal and mechanical.** It specifies `grep -rn "getAuth\|_auth\b" src/` must return zero matches — not "no live `getAuth` symbol." Spec-enforcer rule is to audit against the declared spec, and the declared spec is a grep contract.
2. **The chosen phrasing is information-preserving.** "Caches no instance / exposes no module-level accessor function" describes the *category* of anti-pattern (per `§Abstraction level`'s "ambient module-level singletons" framing) rather than a specific symbol that no longer exists. This is more durable — a future reader does not need to know the historical symbol name.
3. **Consistency with the audit-loop tooling.** The rest of the audit-loop relies on scriptable, mechanical checks (grep, `tsc --noEmit`, test exit codes). A documentation choice that breaks the mechanical check would set an awkward precedent.

No reversal warranted.

## Acceptance criteria (line by line)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `getAuth()` and the module-level `_auth` lazy-singleton variable are deleted from `src/auth.ts` | satisfied | Diff removes lines 178–211 of the prior file (the singleton banner + `_auth` + `getAuth()` + its `@example` JSDoc). |
| 2 | `buildAuth()` and the `AuthInstance` type alias are retained unchanged | satisfied | Diff does not touch `buildAuth` (lines 126–193 of new file) or `AuthInstance` (line 199). |
| 3 | File-header JSDoc rewritten to describe `buildAuth()` as the composition-root factory called once per app instance by `buildApp()` and standalone by integration tests; no reference to a consumed `auth` singleton or `getAuth()` access path | satisfied | New `src/auth.ts:1–38` matches the criterion. Iter-2 rewrite eliminated the iter-1 fabrication (the fictional `{ db, auth }` call shape) and the surviving prose is verified against `src/types.ts:60–83` (no `auth` field on `AppOptions`), `src/app.ts:176` (`buildApp` calls `buildAuth(options.db)` itself), and `src/__tests__/integration/auth.test.ts:48,115` (standalone `buildAuth(dbPath)` for `runMigrations()` and `createApiKey(...)`). |
| 4 | `grep -rn "getAuth\|_auth\b" src/` returns zero matches | satisfied | Verified locally — exit 1, no output. Includes `src/__tests__/`. |
| 5 | `tsc --noEmit` clean | satisfied | Verified locally — exit 0. |
| 6 | Existing test suite still passes | satisfied | T reports 498/498 in 7.66 s (`test-handoff.md §Regression checks`); F reports the same (`feature-handoff.md §Commands run locally`). |

## Verdict

**PASS** — Argos may proceed to Phase 7 (open the PR).

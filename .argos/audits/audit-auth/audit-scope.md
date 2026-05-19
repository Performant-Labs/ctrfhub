# Audit Scope — audit-auth

**Date:** 2026-05-19
**Kickoff line:** `Audit scope audit-auth`
**Campaign:** Phase 2, territory T1 of the codebase audit campaign (see `.argos/audits/audit-scoping/campaign-plan.md`).

## Scope

**Paths to walk:**
- `src/auth.ts` (single file — `buildAuth()`, the Better Auth instance factory)
- `src/modules/auth/` (recurse) — `routes.ts`, `schemas.ts`

**Paths to ignore (within walk):**
- No test files exist inside the scoped subtree; auth tests live under `src/__tests__/` and are out of scope (tests are the Spec-enforcer / Test-writer domain, not the architecture audit).

**Depth of recursion:** unlimited (the subtree is small — 3 files, ~332 LOC total).

**Specific subsystems or layers in focus:**
- The **Better Auth integration boundary** — how `buildAuth()` constructs the auth instance, what config it owns, what it delegates.
- The **auth route layer** — the `/api/auth/*` catch-all in `src/modules/auth/routes.ts`, its registration shape, and its declared auth posture.
- The **session / API-token contract** — CSRF/SameSite posture, cookie handling, API-token issuance/verification, and whether any raw token or session-cookie handling escapes the Better Auth integration.

## Architectural concerns — the audit checklist

A walks the scope with these dimensions in mind. Cite the skill / planning section that defines the baseline pattern. Auth is high-stakes (`CLAUDE.md §Repo-level review priorities`); **layering, dependency direction, and the auth boundary are expanded** per the auth-subsystem guidance.

- **Auth boundary (expanded).** Is CSRF/session/API-token handling done entirely through the Better Auth integration? Any raw CSRF-token or session-cookie handling outside it is a forbidden pattern. SameSite posture, cookie flags, token issuance/verification. — `skills/better-auth-session-and-api-tokens.md`, `docs/planning/architecture.md §Security`
- **Layering and dependency direction (expanded).** Does `routes.ts` stay thin (shape requests/responses, map outcomes to status codes) and delegate logic? Does `buildAuth()` sit at the right altitude — a factory consumed by the composition root, not reaching upward into routes? Entities-are-leaves / no layer-skipping. — `docs/planning/architecture.md §Layering`
- **Route registration.** `src/modules/auth/routes.ts` uses the named `registerAuthRoutes` function form. This is **already adjudicated** in `architecture.md §Code Conventions → Route registration` (PR #77): the canonical shape is a default-exported `FastifyPluginAsync`; `registerAuthRoutes` is a tolerated variant to be normalized when AUTH-002 next touches auth. A should **note conformance to that adjudicated state — not re-open the question.** — `docs/planning/architecture.md §Code Conventions → Route registration`
- **The documented ZodTypeProvider exception.** `/api/auth/*` is the documented exception that skips the ZodTypeProvider because Better Auth owns its own request/response contract. A verifies the exception is *documented in the file's header JSDoc* (the spec's condition) — it does not flag the skip itself. — `docs/planning/architecture.md §Code Conventions → Route registration`
- **Zod-schema location.** Auth schemas belong in `src/modules/auth/schemas.ts`, never inlined ad-hoc in a handler; types derived via `z.infer<>`, not hand-written. — `skills/zod-schema-first.md`, `architecture.md §Code Conventions → Zod-schema location`
- **Error handling.** Auth failures map to explicit status codes with a structured `{ error, code }` body; failures logged via the Fastify/Pino logger without logging token values; no silent `catch {}`. — `architecture.md §Code Conventions → Error handling`
- **Naming and file structure.** File/function/constant names and placement match the cadence in `src/`. — `architecture.md §Code Conventions → Naming`
- **Pattern consistency / abstraction level.** Auth code at the same abstraction altitude as its neighbours; no over- or under-abstraction. — `architecture.md §Code Conventions → Abstraction level`

## Acceptance criteria for `findings.md`

- Each finding has: `#`, `severity` (`block` | `warn`), `file:line`, `drift dimension`, `finding` (1–3 sentences), `suggested remediation`, `estimated story size` (XS <1 hr / S 1–4 hr / M half-day / L full day+).
- Findings prioritized by severity then by leverage (a single root cause that fans out ranks higher than a one-off nit).
- A `Themes` section groups findings that share a root cause — these turn into single decomposed stories.
- No PASS/BLOCK verdict on the file — the prioritized list is the result.
- An `Out of scope but noticed` section captures anything outside the walk worth a future audit (do not put fix-it suggestions there; just note what looked off and recommend a separate audit).
- A `Files examined` section lists the files A read in full.

## Notes for the reviewer

- **The global auth preHandler is OUT of scope.** The app-wide auth/`skipAuth` preHandler chain lives in `src/app.ts`; it is territory T6 (`audit-composition-root`), audited separately. You may read `src/app.ts` as *neighbouring evidence* (e.g. to confirm how `registerAuthRoutes` is registered, or how the auth instance is wired) but **do not file findings against `app.ts`** — note any `app.ts` concern under `Out of scope but noticed` instead.
- **`registerAuthRoutes` is settled, not a finding.** Its named-function shape was adjudicated in PR #77. Treat it as conformant; do not propose renaming it (the normalization is already pinned to AUTH-002).
- **Yardstick.** The authoritative baseline is the merged `docs/planning/architecture.md` (PRs #76 + #77) plus `skills/better-auth-session-and-api-tokens.md`. Where the doc and the code disagree, the doc is the standard and the code is the finding.
- **Auth is high-stakes.** Any raw CSRF-token / session-cookie / API-token handling outside the Better Auth integration is a `block`-severity finding regardless of how small.
- This is a survey of existing code, not a verdict on a diff — there is no PASS/BLOCK.

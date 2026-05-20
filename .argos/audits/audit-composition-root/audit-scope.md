# Audit Scope — audit-composition-root

**Date:** 2026-05-20
**Kickoff line:** `Audit scope audit-composition-root`
**Campaign:** Phase 2, territory T6 of the codebase audit campaign (see `.argos/audits/audit-scoping/campaign-plan.md`).

## Scope

**Paths to walk:**
- `src/app.ts` (recurse-equivalent — single 714-LOC file; the composition root)
- `src/index.ts` (35 LOC — process entry point)
- `src/types.ts` (83 LOC — `AppOptions` and shared app-level types)
- `src/modules/health/schemas.ts` (46 LOC — schema for the inline `/health` route, whose handler lives in `buildApp()`)

**Paths to ignore (within walk):**
- No test files exist inside the scoped subtree; tests for `app.ts` / `/health` live under `src/__tests__/` and are out of scope (Spec-enforcer / Test-writer domain).

**Depth of recursion:** unlimited — the subtree is small (878 LOC total) and flat.

**Specific subsystems or layers in focus:**
- The **composition root proper** — `buildApp()` and the order, content, and abstraction altitude of every plugin registration, hook, and inline route it owns.
- The **preHandler chain** — global auth preHandler, `skipAuth` bypass logic, the `/assets/*` and `/health` exemption posture, and the ordering of `onRequest` / `preHandler` / `onClose` hooks.
- **Security headers and rate-limiting wiring** — `@fastify/helmet` (CSP, HSTS, COOP, frame-options), `@fastify/rate-limit`, and the relationship between Fastify-layer limits and the Caddy-layer limits documented in `deployment-architecture.md`.
- The **`AppOptions` DI seam** — `db`, `artifactStorage`, `eventBus`, `aiProvider`. Whether new ambient module-level singletons have crept in alongside it.
- The **inline `/health` route** — the one trivial route that legitimately lives in the composition root per the §Code Conventions clause added in PR #77.

## Architectural concerns — the audit checklist

A walks the scope with these dimensions in mind. **Pattern consistency, cross-cutting concerns, and security are expanded** per the cross-cutting nature of the composition-root territory. Cite the skill / planning section that defines the baseline pattern.

- **Composition-root invariant.** `buildApp()` is the *only* wiring file. No `app.register` / `app.addHook` / `app.get` calls outside `buildApp()` (with `src/index.ts` as the documented exception that boots the process). — `docs/planning/architecture.md §Layering and Dependency Direction` ("`buildApp()` is the composition root"); `§Code Conventions → File organization`.
- **PreHandler / `onRequest` / `onClose` ordering (expanded).** The order in which hooks register matters semantically (Fastify executes them in registration order). The global auth preHandler must run *before* route-level handlers. `onClose` hooks must run shutdown work in dependency-correct order. Flag any ordering that looks load-bearing-but-undocumented. — `architecture.md §Layering` (no layer-skipping), `architecture.md §Security` (auth preHandler).
- **The `skipAuth` bypass posture (expanded).** Which routes / patterns bypass the global auth preHandler? `architecture.md §Code Conventions → Route registration` names `config: { skipAuth: true }` for public routes (and `auth-auth-S1`'s brief calls out `/assets/*` and `/api/auth/*` as the documented bypasses). Verify: no route silently bypasses auth via path-matching outside the `skipAuth` mechanism; no route declares `skipAuth: true` that should not be public.
- **Security headers / CSP (expanded).** Helmet config: CSP directives, HSTS, X-Frame-Options, `Cross-Origin-Opener-Policy` (DD-028 I7). Are inline-script `'unsafe-inline'` / `'unsafe-eval'` policies in use, and if so, are they justified by a documented Alpine/HTMX requirement? — `architecture.md §Security`, `architecture.md §CSP`.
- **Rate limiting (expanded).** `@fastify/rate-limit` config consistency with `deployment-architecture.md §Caddy` (Layer-1) and DD-012's Layer-2 numeric table (DD-029). Mixed-backend choice (library default for high-volume; in-process LRU for enumeration-sensitive endpoints) — flag any divergence. — `architecture.md §Backend → Rate limiting`, `database-design.md DD-012/DD-029`.
- **`@fastify/static` and the `/assets/*` auth-bypass.** Asset-pipeline bridging (PR #71 — `dist/assets/`), auth-bypass posture for the asset route, cache-control. — `architecture.md §Operational Invariants → Asset-pipeline bridging`.
- **Inline `/health` trivial-route compliance.** `/health` is the documented trivial route legitimately registered inline in `buildApp()` per the §File organization clause added by PR #77 (André's adjudication of the audit-augment carried `warn`). Verify the inline registration matches that clause (no `routes.ts` invented for `health/`; route handler is in `buildApp()`; `health/schemas.ts` provides the response type).
- **Graceful shutdown (`onClose` chain).** SIGTERM behaviour, in-flight work, the dependency-correct order of DB / artifact-storage / event-bus / AI-provider teardown. — `architecture.md §Production Deployment → Graceful shutdown`.
- **`AppOptions` DI seam.** Whether the four optional fields (`db`, `artifactStorage`, `eventBus`, `aiProvider`) are actually used as substitution points by tests, and whether any cross-cutting dependency has crept in as an ambient module-level singleton instead of going through `AppOptions`. — `architecture.md §Code Conventions → Abstraction level` ("ambient module-level singletons are the anti-pattern").
- **Naming, file structure, error handling, logging.** Standard dimensions. Composition-root code surfaces failures via the Fastify/Pino logger (the documented `console.error` exception is `src/index.ts`'s last-resort startup handler). — `architecture.md §Code Conventions → {Error handling, Logging}`.
- **Abstraction level.** A composition root that has grown business logic, or a route handler whose logic is inline rather than in a service, is drift in both directions. — `architecture.md §Code Conventions → Abstraction level`.

## Acceptance criteria for `findings.md`

- Each finding has: `#`, `severity` (`block` | `warn`), `file:line`, `drift dimension`, `finding` (1–3 sentences), `suggested remediation`, `estimated story size` (XS <1 hr / S 1–4 hr / M half-day / L full day+).
- Findings prioritized by severity then by leverage (a single root cause that fans out to multiple files ranks higher than a one-off nit).
- A `Themes` section groups findings that share a root cause — these turn into single decomposed stories.
- No PASS/BLOCK verdict on the file — the prioritized list is the result.
- An `Out of scope but noticed` section captures anything outside the walk worth a future audit.
- A `Files examined` section lists the files A read in full.

## Notes for the reviewer

- **Yardstick.** The authoritative baseline is the merged `docs/planning/architecture.md` (post PRs #76 + #77 — the latter adjudicated the inline-trivial-route clause that legitimizes `/health` living in `buildApp()`). Pending PRs #79–#81 are **not** the yardstick; audit `main`'s current state.
- **Two observations carried over from `audit-auth` for resolution here.** `audit-auth`'s `findings.md §Out of scope but noticed` flagged these specifically for T6:
  - **(a)** `src/app.ts:176` calls `buildAuth(options.db)` directly — relevant to T6's assessment of composition-root DI consistency. Evaluate whether passing `options.db` (rather than letting `buildAuth()` read from `process.env`) is the right shape for the `AppOptions` seam.
  - **(b)** The global auth preHandler's API-key branch (`app.ts:561-573` per `audit-auth`'s reading) logs presence-not-value and returns `401` early. T1 looked it conformant; T6 owns the formal review of the full preHandler chain it sits inside.
- **Dead-code state on `main`.** PR #80 (audit-auth-S1) — deletion of the dead `getAuth()`/`_auth` singleton — is open but NOT merged. The singleton still exists in `src/auth.ts`. Do not file findings about `src/auth.ts` content — `auth.ts` is T1's territory, not T6's. If `app.ts` *imports* anything from `auth.ts` that is dead code, that's a `src/auth.ts` finding (already filed in T1), not a new T6 finding.
- **Auth is high-stakes.** The global auth preHandler is the single most important hook in `app.ts`. Any path-matching logic that could be tricked into bypassing auth, any branch that doesn't end in a definite allow/deny decision, any 401/403 that leaks information beyond presence-not-value is `block`-severity.
- **`/health` is the *documented* trivial-route exception** (PR #77). Do not file a finding that `health/` lacks a `routes.ts` — the inline registration is the spec.
- This is a survey of existing code, not a verdict on a diff — there is no PASS/BLOCK on this file. A's verdict shape is the prioritized findings list.

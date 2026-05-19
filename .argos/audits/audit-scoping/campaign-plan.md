# Audit Campaign Plan — `audit-scoping`

**Date:** 2026-05-19
**Author:** Argos (Orchestrator)
**Kickoff:** `Start story audit-scoping` (André, interactive)
**Status:** Phase 1 of the codebase audit campaign — territory enumeration. No code
audited here; no agent spawned; no branch of `src/` touched.

## Purpose

This is **Phase 1 (`audit-scoping`)** of the codebase audit campaign. Its job — per
the (cancelled) `architecture-baseline` brief — is to *enumerate the audit
territories* of `src/` so **Phase 2** can run sequential per-territory audits, each
as its own `Audit scope <auditId>` run of the audit loop
(`docs/orchestrator-workflows/auditarchitecture.md`).

This document does **not** audit code. Each territory below becomes a separate audit
loop: André kicks off `Audit scope <auditId>`, Argos drafts that territory's
`audit-scope.md` (Phase A1), spawns the Architecture Reviewer in audit mode (A2), and
decomposes the findings into story briefs (A3). The yardstick for every audit is the
now-merged `docs/planning/architecture.md` (PRs #76 + #77).

## Codebase size baseline (audited surface, tests excluded)

| Area | Files | ~LOC |
|---|---|---|
| `src/modules/` (auth, ingest, health) | 7 | 1,231 |
| `src/services/` (AI pipeline + event-bus) | 16 | 2,446 |
| `src/lib/` (artifact storage, validation, event-bus) | 6 | 467 |
| `src/entities/` | 9 | 498 |
| `src/client/` | 2 | 47 |
| `src/views/` (Eta templates) | 4 templates | — |
| Root (`app.ts` 706, `auth.ts` 212, `index.ts` 35, `types.ts` 83) | 4 | 1,036 |
| **Total audited surface** | | **~5,725** |

## Territories

Seven territories. Each is a self-contained `Audit scope <auditId>` run in Phase 2.
"High-stakes" marks territories that `CLAUDE.md §Repo-level review priorities` calls
out for extra-thorough review.

### T1 — `audit-auth` &nbsp;·&nbsp; order 1 &nbsp;·&nbsp; size S &nbsp;·&nbsp; **high-stakes**

- **Paths:** `src/modules/auth/` (`routes.ts`, `schemas.ts`), `src/auth.ts` (`buildAuth()` — Better Auth factory).
- **Scope:** Better Auth integration, the `/api/auth/*` catch-all, session/API-token handling, the documented ZodTypeProvider exception.
- **Key dimensions:** auth boundary (CSRF/SameSite), the documented route-registration exception, error-handling on auth failures, schema location.
- **Baseline:** `skills/better-auth-session-and-api-tokens.md`, `docs/planning/architecture.md §Security`, `§Code Conventions → Route registration`.
- **Seam note:** the *global auth preHandler* lives in `src/app.ts`, not here — it is audited under T6 (`audit-composition-root`). T1 covers the Better Auth instance + auth routes only. `registerAuthRoutes` is the named-function route variant flagged in `architecture.md` for normalization when AUTH-002 lands (PR #77) — the auditor should note it, not re-litigate it.

### T2 — `audit-ingest` &nbsp;·&nbsp; order 3 &nbsp;·&nbsp; size M &nbsp;·&nbsp; **high-stakes**

- **Paths:** `src/modules/ingest/` (`routes.ts`, `schemas.ts`, `service.ts`, `size-limit.ts`).
- **Scope:** the public `/api/ingest` contract, CTRF report validation, the 500-row chunked-insert transaction pattern, idempotency-key handling.
- **Key dimensions:** layering (route → service → EntityManager), Zod-schema-first validation, transaction boundaries, error→status mapping, public API contract stability.
- **Baseline:** `skills/ctrf-ingest-validation.md`, `skills/zod-schema-first.md`, `architecture.md §Layering`, `§Code Conventions → {Error handling, Transaction boundaries}`.

### T3 — `audit-persistence` &nbsp;·&nbsp; order 4 &nbsp;·&nbsp; size M &nbsp;·&nbsp; **high-stakes**

- **Paths:** `src/entities/` (9 entities + `index.ts` barrel), `src/mikro-orm.config.{pg,sqlite,}.ts`.
- **Scope:** entity definitions, dual-dialect correctness, the `defineEntity` + `p`-helper pattern, the entities-are-leaves layering rule, schema-sync-at-boot posture.
- **Key dimensions:** dual-dialect (no Postgres-only SQL without a SQLite equivalent), entity import-direction (leaves import only entities), naming.
- **Baseline:** `skills/mikroorm-dual-dialect.md`, `docs/planning/database-design.md`, `architecture.md §Layering` (entities-are-leaves rule).

### T4 — `audit-artifact-storage` &nbsp;·&nbsp; order 5 &nbsp;·&nbsp; size S &nbsp;·&nbsp; **high-stakes**

- **Paths:** `src/lib/artifact-storage.ts`, `local-artifact-storage.ts`, `s3-artifact-storage.ts`, `artifact-validation.ts`, `magic-bytes.ts`.
- **Scope:** the artifact-storage abstraction (local FS vs S3/MinIO), upload validation, magic-byte sniffing, path construction.
- **Key dimensions:** abstraction level (storage backends behind one interface), path-traversal safety, validation completeness.
- **Baseline:** `architecture.md §Security` (artifact serving), `docs/planning/architecture.md §Code Conventions`.
- **Seam note:** `src/lib/event-bus.ts` **and** `src/services/event-bus.ts` both exist — a likely duplication. T4 should flag the `src/lib/` one if it falls in the walk; the pair is also called out under T5. Whichever audit reaches it first owns the finding.

### T5 — `audit-ai-pipeline` &nbsp;·&nbsp; order 6 &nbsp;·&nbsp; size L

- **Paths:** `src/services/ai/` — `pipeline/` (categorizer, consent, correlator, recovery, summarizer, sweeper, schemas, index), `providers/` (anthropic, groq, openai), `helpers.ts`, `prompts.ts`, `types.ts`, `index.ts`; plus `src/services/event-bus.ts`.
- **Scope:** the AI pipeline A1–A9 stages, provider abstraction, consent gating, durability/recovery, the event-bus.
- **Key dimensions:** layering inside `services/`, provider-interface consistency, abstraction altitude, the duplicate event-bus (see T4 seam note), cross-cutting error handling.
- **Baseline:** `docs/planning/ai-features.md`, `architecture.md §Code Conventions → Abstraction level`.
- **Size note:** largest territory (~2,450 LOC). The `audit-scope.md` at its A1 may sub-split `pipeline/` vs `providers/` if A's 30-min audit budget is tight.

### T6 — `audit-composition-root` &nbsp;·&nbsp; order 2 &nbsp;·&nbsp; size M &nbsp;·&nbsp; **high-stakes**

- **Paths:** `src/app.ts` (`buildApp()`, 706 LOC), `src/index.ts`, `src/types.ts`; plus `src/modules/health/schemas.ts` + the inline `/health` route.
- **Scope:** the composition root — plugin wiring, preHandler ordering, security headers, CSP, rate-limiter config, `@fastify/static` asset serving, graceful shutdown, the DI seams on `AppOptions`, the inline trivial `/health` route.
- **Key dimensions:** middleware/preHandler ordering, security headers / CSP, rate limiting, the `/assets/*` auth-bypass, layering (composition root is the only wiring file).
- **Baseline:** `architecture.md §Security`, `§Operational Invariants` (asset-pipeline bridging, PR #71), `§Code Conventions → File organization` (the inline-trivial-route clause from PR #77).
- **Order note:** placed **second** (right after auth) deliberately — it owns the cross-cutting security/preHandler baseline; auditing it early makes later territory audits cleaner.

### T7 — `audit-frontend` &nbsp;·&nbsp; order 7 &nbsp;·&nbsp; size S

- **Paths:** `src/client/` (`app.ts`, `htmx-events.ts`), `src/views/` (Eta — `layouts/main.eta`, `pages/{home,error}.eta`, `partials/error.eta`).
- **Scope:** the HTMX/Alpine boundary, the `htmx-events.ts` event-name constants, viewport posture, template/view-model boundary.
- **Key dimensions:** HTMX 4.0 forward-compat (no inherited `hx-target`/`hx-swap`, no raw event strings, no `hx-disable`), HTMX/Alpine component boundary, templates consume view models only.
- **Baseline:** `skills/htmx-4-forward-compat.md`, `skills/htmx-alpine-boundary.md`, `architecture.md §Frontend boundary rules`, `§Viewport posture`.
- **Size note:** small today (~47 LOC client + 4 templates); kept a distinct territory because its skill set and audit dimensions share nothing with the backend territories.

## Recommended audit order

| Order | Territory | Why this slot |
|---|---|---|
| 1 | `audit-auth` | High-stakes; campaign explicitly starts with auth. |
| 2 | `audit-composition-root` | Owns the cross-cutting security/preHandler baseline — audit it early so later audits inherit a known baseline. |
| 3 | `audit-ingest` | Public API contract; high-stakes; depends on the layering baseline from #2. |
| 4 | `audit-persistence` | Schema/dialect correctness; high-stakes; entities underpin ingest + AI. |
| 5 | `audit-artifact-storage` | High-stakes (storage paths); self-contained. |
| 6 | `audit-ai-pipeline` | Largest surface; lower stakes (AI features are optional/consent-gated). |
| 7 | `audit-frontend` | Smallest; isolated skill set; no dependency on the backend audits. |

Order is a recommendation, not a constraint — territories are independent and André
may reorder or skip any. Each is a fresh `<auditId>`; there is no shared state
between audit runs.

## Cross-territory seams (avoid double-coverage)

- **Global auth preHandler** — lives in `src/app.ts`; audited under T6, not T1.
- **`event-bus.ts` duplication** — `src/lib/event-bus.ts` vs `src/services/event-bus.ts`; whichever of T4/T5 reaches it first owns the finding.
- **`/health` route** — inline in `buildApp()`; audited under T6 (its `schemas.ts` rides along).
- **`registerAuthRoutes` route-shape variant** — already adjudicated in `architecture.md` (PR #77); auditors note conformance, they do not re-open it.

## Out of scope for the campaign (noted, not territories)

- `src/__tests__/` — test code is the Spec-enforcer / Test-writer domain, not the architecture audit.
- `src/migrations/` — none present (schema syncs at boot for the MVP per INFRA-005); revisit if migration files are introduced.
- `src/assets/` — vendored client assets, not authored code.
- Build/CI/Docker config — covered by the merged `§Operational Invariants` (PRs #71/#72/#75); not an `src/` territory.

## Next action (André, via Dispatch)

The campaign is ready. To start Phase 2, kick off territories one at a time:

```
Audit scope audit-auth
```

Argos will draft `audit-auth`'s `audit-scope.md` (Phase A1) from the T1 entry above,
spawn the Architecture Reviewer in audit mode, and produce `findings.md` +
`decomposition.md`. Then proceed down the recommended order. Argos does **not**
auto-start territory audits — each needs an explicit kickoff.

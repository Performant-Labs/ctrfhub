# Review — is `docs/planning/architecture.md` a usable yardstick for the Architecture Reviewer (A) in audit mode?

**Date:** 2026-05-18
**Reviewer:** Argos (read-only analysis)
**Source:** `architecture.md` pulled from Uranus (`67d63bf…`, 30,704 bytes / 538 lines)
**A role file:** `.claude/agents/architecture-reviewer.md` — local `bf936db…` == Uranus `bf936db…` (confirmed in sync)

## 1. The doc

`architecture.md` — 538 lines, 9 top-level sections:

1. Runtime & Language
2. Backend
3. Frontend (incl. **Frontend boundary rules** + **Viewport posture**)
4. AI Features
5. Global Search
6. Local Development
7. Production Deployment
8. Security (CSRF, CSP, artifact serving, health endpoint)
9. CI / CD

It is a **stack-and-operations** document: technology choices, deployment topology, security headers, dev workflow. It is overwhelmingly *descriptive*. Normative rules appear in only two pockets — "Frontend boundary rules" (4 hard HTMX/Alpine rules) and the Security headers/CSP section. It contains **no section on internal code architecture**: layering, dependency direction, naming, file organization, error handling, repository usage are all absent.

## 2. The critical structural problem

Two architecture docs exist. The audit pipeline names **`project-architecture.md`** as the baseline A reads (A role file line 109; `auditarchitecture.md` Phases A1 & A2). But `auditarchitecture.md`'s audit checklist cites **`docs/planning/architecture.md §Layering`** for its first and most important dimension — **and no `§Layering` section exists in `architecture.md`.** The single most-cited audit dimension points at a dangling reference. This alone blocks a confident audit campaign.

## 3. Coverage matrix — A's audit dimensions vs. `architecture.md`

| A's drift dimension (role file §"What both modes share") | Coverage in `architecture.md` |
|---|---|
| Layering (route→handler→service→repository→entity) | **MISSING** — no section; `auditarchitecture.md` cites `§Layering` which doesn't exist |
| Dependency direction / module boundaries | **MISSING** — (workflow points to `project-architecture.md §Module boundaries` instead) |
| Naming conventions | **MISSING** |
| File organization (`src/` layout) | **MISSING** — "Local Development" covers dev workflow, not source layout |
| Error handling pattern | **MISSING** |
| Zod-schema location | **PRESENT (weak)** — "single source of truth" asserted; *where* schemas live unspecified |
| Route registration pattern | **MISSING** |
| MikroORM repository usage | **MISSING** — ORM chosen; repository pattern not described |
| Cross-cutting: logging | **MISSING** |
| Cross-cutting: transaction boundaries | **MISSING** |
| Abstraction-level expectations | **MISSING** |
| HTMX/Alpine frontend boundary | **STRONG** — 4 explicit normative rules + rationale |
| Viewport posture | **STRONG** — normative, with DD-030 citation |
| Auth boundary (CSRF / SameSite) | **PRESENT** — CSRF reasoning strong; **`/assets/*` bypass NOT mentioned** |
| Persistence (schema sync at boot; api vs worker) | **STRONG** — "worker must never call `updateSchema()`" is explicit |
| Routing / middleware (preHandler) ordering | **MISSING** |
| Security headers / CSP | **STRONG** |
| Rate limiting | **PRESENT** — defers to DD-012/DD-029 (acceptable) |
| Frontend asset pipeline (PR #71 fix) | **PRESENT (weak)** — multi-stage build shows Tailwind→`dist/assets`; no normative asset-serving rule |
| Docker build pipeline (PR #72 caching) | **PRESENT (weak)** — multi-stage build shown; no layer-cache guidance |
| CI workflow (PR #75 dedupe/stale-labels) | **PRESENT (weak)** — "Recommended pipeline", descriptive only; no dedupe/stale-label rules |
| Test-tier model + sizing (PR #74) | **MISSING** — only the Playwright two-viewport matrix appears; tier model lives in `testing-strategy.md`/skills |
| Agent-loop integration (`.argos/` schema, branch naming) | **MISSING** — not this doc's domain (lives in `project-architecture.md`/`AGENT_LOOP`) |
| Hard "never modify" rules + exception process | **MISSING** — no "never modify" rule and no exception process anywhere in the doc |

No **CONTRADICTORY** entries found — the doc is internally consistent (the env-var table cleanly defers to `deployment-architecture.md`).

## 4. Gap list (severity)

**MUST-ADD (audit-blocking — A's verdicts unreliable without these):**

- **G1.** No `§Layering` section, yet `auditarchitecture.md` cites it. Dangling reference on the #1 audit dimension. → add a "Code Architecture" / "§Layering" section.
- **G2.** Dependency-direction / module-boundary rules absent from this doc.
- **G3.** Naming conventions + `src/` file-organization rules absent — A cannot flag naming/placement drift against a written rule.
- **G4.** Error-handling, route-registration, MikroORM-repository, transaction-boundary, logging patterns all undocumented — 5 of A's "pattern consistency" + "cross-cutting" sub-dimensions have no yardstick.
- **G5.** Abstraction-level expectations undocumented.

**NICE-TO-ADD (improves precision, not blocking):**

- **N1.** Zod-schema *location* rule (currently only "single source of truth").
- **N2.** `/assets/*` auth-bypass pattern explicitly named under the Auth/Security section.
- **N3.** preHandler / middleware ordering documented.

**SHOULD-UPDATE (stale or thin vs. recent PRs):**

- **U1.** CI/CD section is "Recommended pipeline" only — does not reflect PR #75 (job dedupe, stale-label handling). Either make it normative or explicitly defer to a CI doc.
- **U2.** Docker build section shows multi-stage build but predates PR #72 layer-caching — add cache guidance or note deferral.
- **U3.** Frontend asset pipeline: build steps shown but the PR #71 asset-serving fix is not reflected as a rule.
- **U4.** No "never modify" rule + exception process. CLAUDE.md asserts "never modify `docs/planning/*`" but the doc itself defines no exception path — this is the ambiguity that tripped Argos this morning. *Note:* AI Features section is **clean** — it already lists only openai/groq/anthropic, no OpenRouter/fallback-provider staleness.

## 5. Recommendation

`architecture.md` is a **strong stack/deployment/security document but a weak code-architecture document.** Of ~13 code-layer dimensions A audits, 2 are STRONG (frontend boundary, persistence-at-boot), ~2 are PRESENT-weak, and ~9 are MISSING. The `auditarchitecture.md §Layering` citation actively dangles. **It does not work as-is as A's audit yardstick** — A would be forced to infer layering/naming/error-handling baselines from `skills/*` and live `src/` reading, which is exactly the "no dominant pattern → don't BLOCK" degraded mode. The audit campaign would produce soft, low-confidence findings.

**Verdict on the `architecture-baseline` story:** **Cancel it; replace with a scoped augmentation story.** A from-scratch baseline doc would re-derive ~80% of an already-solid document. The correct, smaller story is *"Add a Code Architecture section to `architecture.md`"* — one new section covering G1–G5 (layering chain, dependency direction, naming + `src/` layout, error-handling + route-registration + repository + transaction + logging patterns, abstraction-level guidance), plus the U1–U4 freshness updates and an exception-process note. That single augmentation makes the dangling `§Layering` citation resolve and turns architecture.md into a real yardstick. It must land **before** the audit campaign kicks off — it is a blocker, not a nicety.

# CTRFHub — Phase 1 Handoff

**Date:** 2026-04-23  
**Phase:** 1 complete — Agent infrastructure scaffolded. Zero application code written.  
**Next phase:** Phase 2 — MVP implementation starting with INFRA-001.

---

## What Was Built in Phase 1

### Skills (13 files in `skills/`)

| Skill | Trigger |
|---|---|
| `htmx-alpine-boundary.md` | Writing HTMX handlers or Alpine `x-data` |
| `htmx-4-forward-compat.md` | Writing any `hx-*` attribute or JS HTMX listener |
| `mikroorm-dual-dialect.md` | Writing entities, migrations, or DB queries |
| `zod-schema-first.md` | Adding any route, request body, or query param |
| `fastify-route-convention.md` | Writing any Fastify route handler |
| `eta-htmx-partial-rendering.md` | Writing any HTML-returning route or Eta template |
| `better-auth-session-and-api-tokens.md` | Writing auth-related code or the setup wizard |
| `vitest-three-layer-testing.md` | Writing any test file or choosing a test strategy |
| `ai-pipeline-event-bus.md` | Writing any AI pipeline stage (A1–A4) |
| `tailwind-4-flowbite-dark-only.md` | Writing CSS, Tailwind classes, or Flowbite components |
| `ctrf-ingest-validation.md` | Implementing or modifying the ingest route |
| `artifact-security-and-serving.md` | Serving artifacts or implementing artifact upload |
| `viewport-mobile-first-desktop-only.md` | Writing any HTML template or Playwright viewport config |

### Agent Roles (4 files in `.antigravity/agents/`)

| Role | Writes | Never writes |
|---|---|---|
| Orchestrator | Task assignments, `tasks.md` status | Source code, tests |
| Feature-implementer | `src/`, `migrations/`, `src/views/` | `src/__tests__/`, `e2e/tests/` |
| Test-writer | `src/__tests__/`, `e2e/tests/` | `src/` (application code) |
| Spec-enforcer | Audit reports | Any file (read-only) |

### Workflows (3 files in `.antigravity/workflows/`)

| Workflow | Purpose |
|---|---|
| `/implementstory <taskId>` | End-to-end: plan → implement → T1 → T2 → tests → T3 → spec audit → done |
| `/verifystory <taskId>` | Standalone re-verification (post-fix or pre-merge) |
| `/audit-tests` | Full codebase audit: arch rules, coverage gaps, planning conformance |

### Task Backlog (`docs/ai_guidance/tasks.md`)

28 tasks across 9 tiers, dependency-ordered:

| Tier | Tasks | Count |
|---|---|---|
| 0 — Foundational Infra | INFRA-001…004 | 4 |
| 1 — Auth and Setup | AUTH-001…003 | 3 |
| 2 — CTRF Ingestion | CTRF-001…004 | 4 |
| 3 — Dashboard | DASH-001…003 | 3 |
| 4 — AI Pipeline | AI-001…004 | 4 |
| 5 — Artifact Management | ART-001…002 | 2 |
| 6 — Settings | SET-001…003 | 3 |
| 7 — Data and SSE | DATA-001, SSE-001 | 2 |
| 8 — Global Search | SRCH-001 | 1 |
| 9 — CI and DevOps | CI-001…002 | 2 |

### Gap Registry (`docs/ai_guidance/gaps.md`)

| ID | Severity | Status | Summary |
|---|---|---|---|
| G-P0-001 | P0 | **Open** | Tailwind 4 `@theme` ↔ `[data-theme]` integration undefined |
| G-P0-002 | P0 | **Open** | Eta vs Nunjucks template engine conflict |
| G-P0-003 | P0 | **Open** | Missing DB schemas for settings tables |
| G-P0-004 | P0 | ✅ Closed | AI pipeline restart recovery (resolved in `ai-features.md`) |
| G-P1-001 | P1 | Open | `/api/artifact` reference in project-plan.md |
| G-P1-002 | P1 | Open | camelCase vs snake_case in theme-design.md |
| G-P1-003 | P1 | Open | Wrong Anthropic model name in ai-features.md |
| G-P1-004 | P1 | Open | SSE path inconsistency |
| G-P1-005 | P1 | Open | `MAX_PAYLOAD_SIZE` vs 100 MB video uploads |
| G-P2-001 | P2 | Deferred | Custom Fields API routes undesigned |
| G-P2-002 | P2 | Deferred | Per-user Slack DM OAuth flow |
| G-P2-003 | P2 | Open | AI Settings operational surface incomplete |
| G-P2-004 | P2 | Open | CTRF `other` status unhandled |

---

## Human Reviewer Checklist

Before approving Phase 2 start, verify:

- [ ] **G-P0-001 resolved:** Confirm Tailwind `@theme` + `[data-theme]` integration approach (proposed: `@theme` defines defaults; `[data-theme]` overrides same `--color-*` vars at runtime; no rebuild required).
- [ ] **G-P0-002 resolved:** Confirm Eta wins over Nunjucks. Purge `.njk` references from `deployment-architecture.md` and `parking-lot.md`.
- [ ] **G-P0-003 resolved:** Fill missing column definitions for `user_notification_preferences`, `sso_configurations`, and `project_custom_field_settings` in `database-design.md`.
- [ ] **G-P1-003 fixed:** Replace `claude-haiku-3-5` with `claude-haiku-4-5-20251001` in `ai-features.md`.
- [ ] **G-P1-004 fixed:** Pin SSE path to `/org/:orgId/events` in all docs.
- [ ] **`AGENTS_README.md` reviewed and accepted.**
- [ ] **`docs/ai_guidance/tasks.md` reviewed** — all acceptance criteria are implementable from the planning docs as written.
- [ ] **All 13 skills files reviewed** — trigger conditions correctly identify when each skill applies.

---

## How to Start Phase 2

Once the reviewer checklist is complete:

```
/implementstory INFRA-001
```

**Dependency chain to MVP (critical path):**

```
INFRA-001
  ├─ INFRA-002 (app factory)
  ├─ INFRA-003 (Tailwind + layout)
  └─ INFRA-004 (entities + migrations)
       └─ AUTH-001 (auth hook)
            ├─ AUTH-002 (setup wizard)
            └─ CTRF-001 (CTRF Zod schema)
                 └─ CTRF-002 (ingest route)
                      ├─ CTRF-003 (artifacts)
                      └─ DASH-001 (dashboard)
                           └─ DASH-002 (run list)
                                └─ DASH-003 (run detail)
                                     └─ AI-001 → AI-002 → AI-003 → AI-004
```

INFRA-002, INFRA-003, and INFRA-004 can proceed in parallel once INFRA-001 is complete. AUTH-002 and CTRF-001 can proceed in parallel once AUTH-001 is complete.

---

## Key Decisions Made in Phase 1 (inform Phase 2)

1. **Eta confirmed as template engine** (pending G-P0-002 human sign-off).
2. **`[data-theme]` overrides `@theme` tokens at runtime** — no Tailwind rebuild for theme switching (pending G-P0-001 human sign-off).
3. **SSE path pinned to `/org/:orgId/events`** (pending G-P1-004 doc fix).
4. **AI pipeline durability:** `ai_pipeline_log` with reserve-execute-commit is the canonical design (`ai-features.md §Durability and restart recovery`). G-P0-004 is closed.
5. **`CTRF status: 'other'` is handled** — `CtrfReportSchema` accepts it; rollup increments `test_runs.other`.
6. **No separate `/api/artifact` endpoint** — artifacts always co-upload with the run in a multipart POST.
7. **Desktop-only product, mobile-first authoring** — `<meta viewport content="width=1280">`; Playwright two-viewport matrix (1280×800 primary, 375×800 smoke).
8. **Three-Tier Verification Hierarchy** is the mandatory testing standard for all UI stories — T1 → T2 → T3, no tier skipping.

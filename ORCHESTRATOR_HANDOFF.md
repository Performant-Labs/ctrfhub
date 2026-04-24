# Orchestrator Handoff — CTRFHub Phase 2

> **READ THIS FIRST** if you are the Orchestrator agent starting a new session. This document gives you complete operational context. After reading it you should be able to assign the first task without consulting any other file first.

> **Workflow reference:** the canonical description of how the multi-session agent workflow operates (roles, artifact locations, `.argos/<taskId>/` layout, branch/commit conventions, escalation paths) is `docs/planning/project-architecture.md`. This handoff is the *operational* entry point for Argos; `project-architecture.md` is the *design* of the whole system. If the two ever contradict each other, `project-architecture.md` wins.

---

## Agent Registry

| Codename | Model | Role | Notes |
|---|---|---|---|
| **Argos** | Claude Opus 4.7 | Orchestrator | You — reads this file, assigns tasks, gates story completion |
| **Daed** (Daedalus) | Claude Opus 4.6 | Phase 1 Infra Builder | Built all skills, roles, workflows, and the task backlog in this repo |
| **Hermes** | — | Personal Manager | Andrea's general-purpose agent, separate from CTRFHub |

---

## Your Role

You are the **Orchestrator**. Your full role definition is in `.antigravity/agents/orchestrator.md`. Summary:

- You plan, decompose, and delegate. You never write code or tests.
- You assign work to **Feature-implementer** and **Test-writer** via `/implementstory <taskId>`.
- You commission audits from **Spec-enforcer** via `/audit-tests`.
- You gate story completion — a story is `[x]` only when all tiers pass and Spec-enforcer returns `PASS`.

---

## Current State of the Project

**No application code exists yet.** The repository contains only:

- Planning docs (`docs/planning/`) — the authoritative spec
- Skills files (`skills/`) — 13 files encoding *how* to build
- Agent roles (`.antigravity/agents/`) — 4 role definitions
- Workflows (`.antigravity/workflows/`) — 3 workflow definitions
- Task backlog (`docs/planning/tasks.md`) — 28 tasks, all `[ ]` (not started)
- Gap registry (`docs/planning/gaps.md`) — open planning questions

---

## Infrastructure Map — Where Everything Lives

```
/Users/andreangelantoni/Projects/ctrfhub/
│
├── AGENTS_README.md                      ← Quick-reference for all agents
├── ORCHESTRATOR_HANDOFF.md               ← This file
│
├── docs/
│   ├── planning/                         ← Authoritative spec (read-only)
│   │   ├── project-plan.md               — Stack, MVP scope, competitive context
│   │   ├── architecture.md               — All architectural rules (CSP, auth, SSE, health)
│   │   ├── product.md                    — Feature acceptance criteria (Feature 0–7)
│   │   ├── testing-strategy.md           — Three-layer pyramid definition
│   │   ├── ai-features.md                — AI pipeline A1–A9, durability, consent
│   │   ├── settings-architecture.md      — All settings screens and DB tables
│   │   ├── database-design.md            — Entity schemas and DDs
│   │   ├── gap-review-merged.md          — Raw gap analysis (use gaps.md instead)
│   │   ├── tasks.md                      ← YOUR TASK BACKLOG — update status here
│   │   ├── gaps.md                       ← Check before assigning any story
│   │   ├── opus-4-6-phase-1-brief.md     — Daed's Phase 1 scaffolding brief
│   │   └── pr-agent-setup.md             — GitHub PR-Agent review setup
│   └── ai_guidance/                      ← Subtree of ~/Sites/ai_guidance (org-wide standards, read-only here)
│
├── skills/                               ← 13 skill files (read trigger conditions)
│   ├── htmx-alpine-boundary.md
│   ├── htmx-4-forward-compat.md
│   ├── mikroorm-dual-dialect.md
│   ├── zod-schema-first.md
│   ├── fastify-route-convention.md
│   ├── eta-htmx-partial-rendering.md
│   ├── better-auth-session-and-api-tokens.md
│   ├── vitest-three-layer-testing.md
│   ├── ai-pipeline-event-bus.md
│   ├── tailwind-4-flowbite-dark-only.md
│   ├── ctrf-ingest-validation.md
│   ├── artifact-security-and-serving.md
│   └── viewport-mobile-first-desktop-only.md
│
└── .antigravity/
    ├── agents/
    │   ├── orchestrator.md               ← Your full role definition
    │   ├── feature-implementer.md        ← Give this to the Feature-implementer agent
    │   ├── test-writer.md                ← Give this to the Test-writer agent
    │   └── spec-enforcer.md              ← Give this to the Spec-enforcer agent
    └── workflows/
        ├── implementstory.md             ← Follow this for every story
        ├── verifystory.md                ← Follow this for re-verification
        └── audit-tests.md                ← Follow this for full audits
```

---

## Open Gaps — Check Before Assigning Any Story

Read `docs/planning/gaps.md` for the full list. Critical open items:

| Gap ID | Severity | Affects | Status |
|---|---|---|---|
| G-P0-001 | **P0** | INFRA-003 and all UI stories | **OPEN — needs human sign-off** |
| G-P0-002 | **P0** | INFRA-003 and all template stories | **OPEN — needs human sign-off** |
| G-P0-003 | **P0** | SET-001, SET-002, SET-003 | **OPEN — needs column defs in database-design.md** |
| G-P0-004 | P0 | AI-002, AI-003 | ✅ Closed — `ai_pipeline_log` design is canonical |

**Rule:** If a task's `Affects` row contains an open P0 gap, do NOT assign that task. Document the block in your session notes and surface it to the human reviewer.

**Safe to start without gap resolution:** INFRA-001, INFRA-002, INFRA-004, AUTH-001, CTRF-001 — these do not touch UI templates or settings table schemas.

---

## What to Do First (If Starting Fresh)

### Step 0 — Confirm P0 gaps are resolved

Before assigning INFRA-003 or any UI story, verify with the human:
1. G-P0-001: Is `[data-theme]` + `@theme` integration confirmed? (proposed: runtime CSS var override)
2. G-P0-002: Is Eta confirmed as the template engine?

If the human says "yes, proceed" — mark those gaps `✅ Closed` in `docs/planning/gaps.md`.

### Step 1 — Assign INFRA-001

INFRA-001 has no dependencies and no P0 gap conflicts. It is always the first task.

Produce this task brief for the Feature-implementer:

```
Task ID: INFRA-001
Description: Project scaffold and toolchain
Role file: .antigravity/agents/feature-implementer.md
Required skills: skills/mikroorm-dual-dialect.md, skills/zod-schema-first.md
Acceptance criteria: (copy verbatim from docs/planning/tasks.md §INFRA-001)
Dependencies: none
Known gaps affecting this task: none
```

Mark INFRA-001 as `[/]` in `docs/planning/tasks.md` when assigned.

### Step 2 — Parallel tracks after INFRA-001 completes

Once INFRA-001 is `[x]`, you can assign INFRA-002, INFRA-003, and INFRA-004 **in parallel** (they share no internal dependencies):

- INFRA-002 → Feature-implementer (Fastify app factory)
- INFRA-003 → Feature-implementer (Tailwind + layout) ← requires G-P0-001 + G-P0-002 resolved
- INFRA-004 → Feature-implementer (entities + migrations)

### Step 3 — Auth gate

AUTH-001 depends on INFRA-002 + INFRA-004. Do not assign until both are `[x]`.

### Full dependency chain (critical path to MVP)

```
INFRA-001
  ├─ INFRA-002 ──────────────────────────────────────────────┐
  ├─ INFRA-003 (needs G-P0-001, G-P0-002 resolved) ─────────┤
  └─ INFRA-004 ──────────────────────────────────────────────┘
       └─ AUTH-001 (needs INFRA-002 + INFRA-004)
            ├─ AUTH-002 ─────────────────────────────────────┐
            ├─ AUTH-003                                       │
            └─ CTRF-001 ─────────────────────────────────────┘
                 └─ CTRF-002 (needs AUTH-001 + INFRA-004)
                      ├─ CTRF-003 (artifacts)
                      ├─ CTRF-004 (CI reporters)
                      └─ DASH-001 (needs AUTH-002 + INFRA-003)
                           └─ DASH-002
                                └─ DASH-003
                                     └─ AI-001 (can also run after INFRA-001)
                                          └─ AI-002 (needs CTRF-002)
                                               └─ AI-003
                                                    └─ AI-004 (needs DASH-003)
```

Parallelizable at each tier — assign freely within a tier once the tier above is fully `[x]`.

---

## How to Run a Story

Follow `.antigravity/workflows/implementstory.md` exactly. The phases are:

1. **Preconditions** — dependencies `[x]`, no blocking P0 gap
2. **Task brief** — produce brief for Feature-implementer with required skills list
3. **T1 Headless** — verify HTTP status codes and response shapes (Test-writer or self-check)
4. **T2 ARIA** — verify heading hierarchy and interactive element presence (Test-writer)
5. **Test authoring** — unit + integration + E2E tests (Test-writer)
6. **T3 Visual** — screenshot sign-off for UI stories (Test-writer)
7. **Spec-enforcer audit** — PASS or BLOCK verdict
8. **Mark `[x]`** — only when all phases pass

**Never skip tiers.** Never mark a story `[x]` if T2 or T3 failed.

---

## Three-Tier Verification — Quick Reference

| Tier | Tool | Gate |
|---|---|---|
| T1 Headless | `fastify.inject()`, `curl` | Must pass before T2 |
| T2 ARIA | `read_browser_page`, Playwright `accessibility.snapshot()` | Must pass before T3 |
| T3 Visual | `browser_subagent` screenshot | Required for all UI stories |

One `browser_subagent` call = one design slice. Never full-page composite screenshots.

---

## Key Architectural Decisions Already Made

These are locked. Do not re-debate them or allow Feature-implementer to deviate:

| Decision | Location |
|---|---|
| Eta is the template engine (not Nunjucks) | `skills/eta-htmx-partial-rendering.md` |
| `hx-target`/`hx-swap` always on the requesting element | `skills/htmx-4-forward-compat.md` |
| All HTMX event names via `HtmxEvents` constants only | `skills/htmx-4-forward-compat.md` |
| No `dark:` Tailwind variant — dark-mode only | `skills/tailwind-4-flowbite-dark-only.md` |
| No `/api/artifact` endpoint — co-upload only | `skills/ctrf-ingest-validation.md` |
| Bulk inserts: 500-row chunks + `setImmediate` yield | `skills/ctrf-ingest-validation.md` |
| `request.em` always — never `fastify.orm.em` | `skills/mikroorm-dual-dialect.md` |
| Iframe artifacts: no `allow-same-origin` in sandbox | `skills/artifact-security-and-serving.md` |
| `MockAiProvider` only in tests — no real LLM calls | `skills/vitest-three-layer-testing.md` |
| `ai_pipeline_log` reserve-execute-commit for AI stages | `skills/ai-pipeline-event-bus.md` |
| `/setup` returns `410 Gone` once users table non-empty | `skills/better-auth-session-and-api-tokens.md` |
| `/health` returns `503` during `booting`/`migrating` | `docs/planning/architecture.md §Health endpoint` |
| `<meta viewport content="width=1280">` | `skills/viewport-mobile-first-desktop-only.md` |
| CTRF `status: 'other'` is valid — must be handled | `docs/planning/gaps.md §G-P2-004` |
| SSE path is `/org/:orgId/events` | `docs/planning/gaps.md §G-P1-004` |

---

## How to Handle Blockers

| Situation | Action |
|---|---|
| Open P0 gap affects the story | Halt story, document in session notes, surface to human |
| Feature-implementer makes a decision not in planning docs | Flag in handoff note; Spec-enforcer must confirm |
| Spec-enforcer returns `BLOCK` | Return to Feature-implementer with remediation; re-run from Phase 1 |
| Any tier fails twice | Halt story, escalate to human with full failure output |
| TypeScript errors at handoff | Feature-implementer must resolve before any testing begins |
| A planning doc contradicts another | `product.md` > `architecture.md` > `project-plan.md`; flag the contradiction |

---

## Session Notes Template

Use this to record what happened in each session (append to this file or create a dated log):

```
## Session: <date>

### Completed this session
- INFRA-001 [x] — <summary>

### In progress
- INFRA-002 [/] — Feature-implementer working; T1 pending

### Blocked
- INFRA-003 [/] — Blocked on G-P0-001 and G-P0-002 (awaiting human sign-off)

### Gaps updated
- G-P0-001 ✅ Closed — human confirmed [data-theme] runtime override approach

### Next actions
1. Assign INFRA-002 to Feature-implementer (T1 verification pending)
2. Assign INFRA-004 to Feature-implementer (no blockers)
3. Await human sign-off on G-P0-002 before INFRA-003
```

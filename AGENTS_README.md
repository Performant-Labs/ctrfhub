# CTRFHub Agent Infrastructure — README

> **Phase 1 complete.** This directory contains the agent infrastructure (skills, roles, workflows, backlog) produced in Phase 1. No application code has been written yet. Phase 2 begins with `/implementstory INFRA-001`.

## Agent Names

| Codename | Model | Role |
|---|---|---|
| **Daed** (Daedalus) | Claude Opus 4.6 | Built Phase 1 infrastructure — skills, roles, workflows, task backlog |
| **Argos** | Claude Opus 4.7 | Orchestrator — assigns tasks, gates stories, runs audits |
| **Hermes** | — | André's personal manager agent (separate project) |

---

## How sessions start — entry points for bots and humans

Not every file here gets read automatically. This table tells you what loads, when, and what you need to do manually.

### Automatic loading (no action required)

| File | When it loads | What it does |
|---|---|---|
| `CLAUDE.md` | Every session in this repo (Claude Code CLI, AntiGravity Agent Manager, PR-Agent in CI) | Orients any agent to the project, names the agents, points each role to its entry point |
| `skills/*.md` | AntiGravity IDE auto-injects based on `trigger:` frontmatter | Provides the right skill when the agent is doing matching work |

### Manual loading (you or the agent must do this)

| File | Who loads it | When |
|---|---|---|
| `ORCHESTRATOR_HANDOFF.md` | **Argos** at the start of every orchestration session | `CLAUDE.md` tells Argos to read it; Argos must actually open it before assigning any task |
| `.antigravity/agents/feature-implementer.md` | Feature-implementer at session start | Provided by Argos in the task brief |
| `.antigravity/agents/test-writer.md` | Test-writer at session start | Provided by Argos in the task brief |
| `.antigravity/agents/spec-enforcer.md` | Spec-enforcer at session start | Provided by Argos when commissioning an audit |
| `docs/planning/tasks.md` | Argos, whenever checking task status | Argos updates this file as stories complete |
| `docs/planning/gaps.md` | Argos, before assigning any story | Required precondition check in `implementstory.md` |

### If you are a human starting a session

> **The one-line version:** Open `CLAUDE.md` if you want an overview. Open `ORCHESTRATOR_HANDOFF.md` if you are about to work with Argos. Open `docs/planning/tasks.md` if you want to see what's next.

You don't need to manually load `CLAUDE.md` — it's auto-read. But if you're kicking off a new Argos session, paste or load `ORCHESTRATOR_HANDOFF.md` into the conversation as the first message. Argos can reconstruct its state entirely from that document.

### If you are an AI agent and `CLAUDE.md` was not in your context

Read `CLAUDE.md` now. If you can't access it, read this file top to bottom, then read `ORCHESTRATOR_HANDOFF.md` if you are operating as Argos, or your role file in `.antigravity/agents/` if you are one of the other roles.

---

## Directory Map

```
.antigravity/
├── agents/
│   ├── orchestrator.md       — Plans, decomposes, delegates. Never writes code.
│   ├── feature-implementer.md — Writes application code. Never writes tests.
│   ├── test-writer.md        — Writes tests. Applies Three-Tier Verification.
│   └── spec-enforcer.md      — Read-only audit. Detects drift against spec + skills.
└── workflows/
    ├── implementstory.md     — End-to-end implementation of a single story.
    ├── verifystory.md        — Standalone re-verification (post-fix, pre-merge).
    └── audit-tests.md        — Full codebase audit via Spec-enforcer checklist.

skills/
├── htmx-alpine-boundary.md           — HTMX owns server comms; Alpine owns local state.
├── htmx-4-forward-compat.md          — Three HTMX 4.0 breaking-change rules.
├── mikroorm-dual-dialect.md           — Portable entity types; dual-dialect migrations.
├── zod-schema-first.md                — Zod as single source of truth for types + validation.
├── fastify-route-convention.md        — Route plugin structure; service layer boundary.
├── eta-htmx-partial-rendering.md      — Partial vs full-page response branching.
├── better-auth-session-and-api-tokens.md — Auth hook; setup wizard; CI token contract.
├── vitest-three-layer-testing.md      — Unit / integration / E2E pyramid + test doubles.
├── ai-pipeline-event-bus.md           — ai_pipeline_log durability; consent gate.
├── tailwind-4-flowbite-dark-only.md   — CSS-first @theme; Flowbite hierarchy; dark-only.
├── ctrf-ingest-validation.md          — Ingest contract; chunked bulk insert; no /api/artifact.
├── artifact-security-and-serving.md   — Iframe sandbox; Content-Disposition; rate limits.
└── viewport-mobile-first-desktop-only.md — Desktop-only product; mobile-first authoring.

docs/planning/
├── ...authoritative spec docs (project-plan.md, architecture.md, etc.)
├── tasks.md    — Dependency-ordered MVP task backlog (start here for Phase 2).
├── gaps.md     — Open planning gaps with severity and blocking status.
├── opus-4-6-phase-1-brief.md — Phase 1 scaffolding brief (Daed's instructions).
└── pr-agent-setup.md         — PR-Agent GitHub review configuration guide.

docs/ai_guidance/
└── ...subtree of ~/Sites/ai_guidance (org-wide standards — read-only here).
```

---

## Three-Tier Verification Hierarchy

This is the **mandatory testing standard** for all UI-touching stories. No exceptions.

| Tier | Method | When | Gate |
|---|---|---|---|
| **T1 — Headless** | `fastify.inject()`, `curl` | First pass, all routes | Must pass before T2 |
| **T2 — ARIA** | `read_browser_page`, Playwright `accessibility.snapshot()` | After T1 passes | Must pass before T3 |
| **T3 — Visual** | `browser_subagent` screenshots | After T2 passes; UI stories only | Blocks story completion |

Never jump from T1 directly to screenshots. Never call a story done if T2 has unresolved ARIA failures.

---

## How to Start Phase 2

1. **Human review:** A reviewer must approve this README and `docs/planning/gaps.md` before any code is written.
2. **Resolve P0 gaps:** G-P0-001 (Tailwind/theme) and G-P0-002 (Eta vs Nunjucks) must be confirmed by the human reviewer. G-P0-003 (missing DB schemas) must have column definitions filled in `database-design.md`.
3. **Start the first story:** Once P0 gaps are resolved, invoke `/implementstory INFRA-001` as the Orchestrator.
4. **Dependency order:** INFRA-001 → INFRA-002 + INFRA-003 + INFRA-004 (can parallel) → AUTH-001 → AUTH-002 + CTRF-001 (can parallel) → CTRF-002 → ...

---

## Key Architectural Rules (Quick Reference)

| Rule | Source |
|---|---|
| HTMX owns server comms; Alpine owns local state | `skills/htmx-alpine-boundary.md` |
| `hx-target`/`hx-swap` always on the requesting element | `skills/htmx-4-forward-compat.md` |
| All HTMX event names through `HtmxEvents` constants | `skills/htmx-4-forward-compat.md` |
| Portable MikroORM entity types only | `skills/mikroorm-dual-dialect.md` |
| Zod schema before TypeScript interface | `skills/zod-schema-first.md` |
| No separate `/api/artifact` endpoint | `skills/ctrf-ingest-validation.md` |
| Bulk inserts: 500-row chunks + `setImmediate` yield | `skills/ctrf-ingest-validation.md` |
| `request.em`, never `fastify.orm.em` | `skills/mikroorm-dual-dialect.md` |
| Dark-mode only: no `dark:` Tailwind variant | `skills/tailwind-4-flowbite-dark-only.md` |
| Iframe sandbox: no `allow-same-origin` for HTML artifacts | `skills/artifact-security-and-serving.md` |
| AI tests: always `MockAiProvider`, never real providers | `skills/vitest-three-layer-testing.md` |
| `ai_pipeline_log` durability: reserve-execute-commit | `skills/ai-pipeline-event-bus.md` |
| `/setup` → 410 Gone once users table non-empty | `skills/better-auth-session-and-api-tokens.md` |
| `/health` → 503 during `booting`/`migrating` bootState | `docs/planning/architecture.md §Health endpoint` |

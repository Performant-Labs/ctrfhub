# Briefing: Scaffold the Agent Infrastructure for CTRFHub

**Target model:** Claude Opus 4.6
**Target environment:** Google AntiGravity IDE (Agent Manager)
**Session scope:** Phase 1 only — set up the agent infrastructure. **Do not implement any MVP application code in this session.**

---

## 1. What this project is (in 5 sentences)

CTRFHub is a self-hosted, open-source test-reporting dashboard native to the CTRF (Common Test Results Format) standard — the "ReportPortal for the CTRF era." The stack is Node.js 22 + Fastify + TypeScript + Zod + MikroORM (Postgres prod / SQLite single-node) + HTMX 2.x + Alpine.js + Tailwind 4 + Flowbite + Eta templates + Better Auth. The `docs/planning/` directory contains an unusually complete spec set — architecture, database design, product requirements, deployment, testing strategy, AI features, gap reviews. There is **no application code yet**. Your job this session is to turn those specs into the agent infrastructure (skills, roles, workflows, backlog) that parallel agents will use to build CTRFHub in later sessions.

## 2. Hard rules for this session

1. **Do NOT write application code.** No `src/`, no `package.json`, no migrations, no route handlers. The only code-adjacent artifact allowed is example snippets inside skill files.
2. **Do NOT modify `docs/planning/*`.** Treat it as read-only spec. If you find a gap, log it in `docs/ai_guidance/gaps.md` and continue — do not "fix" the spec.
3. **Do NOT invent architectural decisions.** Every rule you encode into a skill must cite the doc section it came from. If docs are silent on a point, flag it in `gaps.md`.
4. **Do NOT reduce scope.** Don't decide the product is smaller than the spec says. If something looks too big, flag it; don't trim it.
5. **Stop at the Phase 1 checkpoint** (end of this brief). A human will review before Phase 2 (feature implementation) starts.
6. **Tests are a deliverable, not an afterthought.** Every MVP story must specify which test tiers apply (unit / integration / e2e), and in Phase 2+ every story's implementation diff must include tests in the same diff. A story is never "done" with failing or missing tests. Encode this into the skills, the test-writer role, the story acceptance-criteria template, and the `implementstory` workflow.
7. **Self-verify as you go, not just at the end.** After each deliverable in §4, run the self-verification checklist in §5.5 before moving on. If a check fails, fix it before continuing — do not defer.
8. **Page testing follows the Three-Tier Verification Hierarchy** from `~/Sites/ai_guidance/testing/verification-cookbook.md` (org-wide Performant Labs standard). Tier 1 Headless (curl + grep / supertest, 1–5s) → Tier 2 Structural ARIA (Playwright accessibility tree, 5–10s) → Tier 3 Visual screenshots (Playwright screenshots + pixel-diff, 60–90s). **Never run Tier 3 before Tier 2 is green.** Also read `~/Sites/ai_guidance/testing/visual-regression-strategy.md` for the tool-agnostic VR gate structure, budget rules, and anti-patterns. The cookbook's concrete Tier 1 examples are drawn from Drupal/Canvas runs; your job is to translate those to our Fastify + HTMX + Eta stack (curl against Fastify or supertest + cheerio assertions for Tier 1; Playwright accessibility tree for Tier 2; Playwright screenshots + pixel-diff for Tier 3). Encode this as its own skill, bind it into the Test-writer role, and enforce tier escalation in the `implementstory` workflow.

## 3. Read before producing anything

### 3.0 Org-wide standards — `~/Sites/ai_guidance/` (authoritative across all Performant Labs projects)

These docs define standards that apply org-wide; CTRFHub-specific docs refine but never override them. Read these **before** the CTRFHub planning docs so that later citations can point upward when the local doc inherits an org rule.

- `~/Sites/ai_guidance/agent/agents.md` — agent behaviour guidelines
- `~/Sites/ai_guidance/agent/browser-constraints.md` — headless browser priority rules (directly informs the Three-Tier Hierarchy)
- `~/Sites/ai_guidance/agent/naming.md` — naming conventions (file taxonomy, kebab-case)
- `~/Sites/ai_guidance/agent/technical-writing.md` — documentation style
- `~/Sites/ai_guidance/agent/troubleshooting.md` — known hangs and gotchas
- `~/Sites/ai_guidance/testing/verification-cookbook.md` — **the Three-Tier Verification Hierarchy** (mandatory read; the methodology applies to CTRFHub's stack even though some concrete Tier 1 examples are Drupal-flavored)
- `~/Sites/ai_guidance/testing/visual-regression-strategy.md` — tool-agnostic Tier 3 VR gate structure, budget rules, anti-patterns, and the "Tier 2 first, Tier 3 last" escalation rule
- `~/Sites/ai_guidance/frameworks/fastify/conventions.md` — directly applicable to CTRFHub
- `~/Sites/ai_guidance/frameworks/htmx/conventions.md` — directly applicable (HTMX + Alpine + Eta)
- `~/Sites/ai_guidance/frameworks/mikro-orm/conventions.md` — dual-dialect patterns
- `~/Sites/ai_guidance/frameworks/better-auth/conventions.md` — session + API tokens
- `~/Sites/ai_guidance/frameworks/tailwind/conventions.md` — Tailwind 4 + Flowbite
- `~/Sites/ai_guidance/frameworks/vitest/conventions.md` — unit-test conventions

If an org doc at `~/Sites/ai_guidance/frameworks/*/conventions.md` conflicts with `docs/planning/architecture.md`, flag the conflict in `gaps.md` — **do not silently resolve it**. The human decides which wins.

### 3.1 Project-specific docs

Read the docs in this order. Take notes as you go; you'll be citing specific sections.

1. `docs/planning/project-plan.md` — the north star; stack, MVP scope, architecture conventions summary
2. `docs/planning/architecture.md` — the detailed conventions (HTMX/Alpine boundary, forward-compat rules, viewport posture, etc.)
3. `docs/planning/database-design.md` — entity model and relationships (this file is ~260 KB; skim structure first, read sections on demand)
4. `docs/planning/product.md` — feature-level requirements
5. `docs/planning/deployment-architecture.md`
6. `docs/planning/settings-architecture.md`
7. `docs/planning/testing-strategy.md`
8. `docs/planning/ai-features.md`
9. `docs/planning/load-testing-strategy.md`
10. `docs/planning/gap-review-merged.md` and `gap-review-solo-findings.md` — known risks and unresolved decisions
11. `docs/planning/storage-growth-reference.md`
12. `docs/planning/theme-design.md`
13. `docs/planning/parking-lot.md` — skim for "deferred but known" items so you don't duplicate them

Skip the screenshots directories — they are reference material, not spec.

## 4. Deliverables (in order)

### 4.1 `skills/` directory at repo root

Each file is a self-contained skill that encodes **one** architectural rule. Create ~8–12 skills — don't pad, don't cram. Each skill uses this frontmatter + structure:

```markdown
---
name: {skill-slug}
description: {one-line description used by the agent router to decide if this skill applies}
trigger: {situation in which the skill should be loaded, e.g. "writing any HTMX handler"}
source: {docs/planning/{file}.md section reference}
---

## Rule
{the rule, one sentence}

## Why
{rationale, pulled from the cited doc section}

## How to apply
{concrete, step-by-step instructions for an implementer agent}

## Good example
{code or markup sketch}

## Bad example
{what violating the rule looks like, with a one-line note on why it's wrong}
```

**Suggested skills — adjust based on what you find in the docs, but these are the high-confidence candidates:**

- `htmx-alpine-boundary.md` — HTMX owns server comms; Alpine owns ephemeral local state; idiomorph preserves state across swaps
- `htmx-4-forward-compat.md` — the three HTMX 4.0 rules: always write `hx-target`/`hx-swap` on the requesting element, use central `HtmxEvents` constants (never raw strings), avoid `hx-disable`
- `mikroorm-dual-dialect.md` — single entity definitions, dialect switched via env var; what Postgres-only or SQLite-only features are off-limits
- `zod-schema-first.md` — Zod is the single source of truth for runtime validation and TS types; route schema → handler → DB
- `fastify-route-convention.md` — how a route file is structured (schema, handler, auth guard, rate limiter, template)
- `eta-htmx-partial-rendering.md` — how to render an Eta partial for an HTMX swap vs. a full page
- `better-auth-session-and-api-tokens.md` — browser session auth vs. project-scoped API tokens; the `/setup` bootstrap wizard
- `rate-limiting-mixed-backends.md` — DD-029's mixed backend rule (default store for high-volume; in-process LRU for enumeration-sensitive endpoints)
- `security-headers.md` — CSP/HSTS/X-Content-Type-Options/X-Frame-Options/COOP per DD-028 I7
- `ctrf-ingestion-validation.md` — how a CTRF JSON payload is validated, stored, and associated with a run
- `retention-and-pruning.md` — nightly job; what gets pruned; how artifacts are cleaned up

**Testing skills — all five must exist; they form the testing system together:**

- `test-tier-selection.md` — the meta-skill. Rules for deciding which of unit / integration / e2e (and optionally load/contract) apply to a given story. Coverage expectations per tier. What "tests pass" means. **Must reference `page-verification-hierarchy.md` for how UI stories select and escalate Tier 1 / 2 / 3 within e2e.** Sourced from `docs/planning/testing-strategy.md`, `docs/planning/load-testing-strategy.md`, and `~/Sites/ai_guidance/frameworks/vitest/conventions.md`.
- `vitest-unit-testing.md` — pure functions, Zod schemas, utility modules. File layout convention (`*.test.ts` colocated with source or under `test/unit/`). Mocking conventions (what may be mocked — pure deps only, never the DB in integration). Speed budget per test. Must align with `~/Sites/ai_guidance/frameworks/vitest/conventions.md`.
- `integration-testing.md` — Fastify + real DB harness. Per-test transaction rollback or fresh-schema-per-suite pattern. How to run against both SQLite and Postgres when a story touches DB-dialect-sensitive code (e.g., FTS5 vs. Postgres FTS — see architecture.md §Global Search). Fixture/seed management. Auth token + session fixture helpers. **This skill is also the home for Tier 1 headless page-verification checks** — curl-equivalent assertions (supertest + cheerio, or direct `fetch` + regex) against server-rendered Eta output, HTMX attribute presence, HTTP status, cache headers. Must cross-reference `page-verification-hierarchy.md`.
- `playwright-e2e-testing.md` — the two-viewport matrix (1280×800 primary with full assertions; 375×800 smoke asserting page load + no console errors + no unexpected horizontal overflow outside `.overflow-x-auto`). Critical user journeys that must be covered per feature. AI-provider stubbing strategy (real network calls forbidden in CI). Artifact-upload testing with fixture files. **This skill is the home for Tier 2 (ARIA) and Tier 3 (visual) page verification**; it must cross-reference `page-verification-hierarchy.md` and state explicitly that Tier 3 screenshots never run before Tier 2 ARIA assertions pass.
- `page-verification-hierarchy.md` — **the Three-Tier Verification Hierarchy adapted for CTRFHub's stack.** Source: `~/Sites/ai_guidance/testing/verification-cookbook.md`. Content requirements:
  - **Tier 1 — Headless (1–5s).** How to assert server-rendered HTML without a browser: `curl -sk <url> | grep …` at the shell, or supertest + cheerio in the integration-test layer. What to check on a Fastify + Eta response: HTTP status, presence of HTMX attributes (`hx-target`, `hx-swap`, `hx-get`, etc.) on the requesting elements (per `htmx-4-forward-compat`), presence of Tailwind utility classes, presence of CSRF tokens, absence of server-error markers, CSP / security headers (per `security-headers`). Include 4–6 concrete CTRFHub-flavoured example commands/assertions.
  - **Tier 2 — Structural ARIA (5–10s).** How to use Playwright's accessibility tree (`page.accessibility.snapshot()`) and role-based locators (`getByRole`, `getByLabel`, `getByText`) to assert component presence, heading hierarchy (H1 per screen, semantic sectioning), landmarks (`main`, `navigation`, `banner`), `aria-current="page"` on active nav, interactive affordance presence (buttons/links by accessible name). **Include the backdrop-contrast check** verbatim from the cookbook — any layout change that moves an element's backdrop must run a WCAG contrast computation at Tier 2 before a Tier 3 screenshot is permitted (WCAG AA: body ≥ 4.5:1, large ≥ 3.0:1).
  - **Tier 3 — Visual fidelity (60–90s).** Playwright screenshot + pixel-diff. Reserved for padding/margin regressions, color-matching against design references, z-index/overlap, Flowbite mobile-menu animation correctness. **Tier 3 is blocked until Tier 2 is green.**
  - **Ordering rule.** Always Tier 1 → Tier 2 → Tier 3. Never skip tiers upward. Skipping downward (running all three when one would do) is wasted work and also forbidden — the hierarchy exists to economize tokens/time.
  - **When each tier is sufficient alone.** Not every UI change requires all three. An HTMX partial that changes a table cell's value may be Tier 1 sufficient. A new screen with real navigation needs at least Tier 1 + Tier 2. A design-system-affecting change needs all three. The skill must include a short decision table.
  - **Incident references.** Carry over the two incidents from the cookbook (2026-04-20 canvas hero contrast failure; 2026-04-21 trust bar SVG/AVIF mismatch) as cautionary tales, translated where relevant. The lesson — "rendered HTML present ≠ browser shows something functional" — applies identically to our stack.

Pick the set that best matches what you actually find. It's fine to merge or split where the docs suggest a better cut. Every skill **must** cite the doc section.

### 4.2 `agents.md` at repo root

Define four agent roles. Each definition must be concrete enough that an independent Opus 4.6 session could act as any of them with just the file + the cited skills.

- **Orchestrator** — reads one story from `tasks.md`, decomposes into subtasks, dispatches to others, never writes code or tests, only plans and reports.
- **Feature-implementer** — takes one subtask, loads the skills listed in its skill manifest, writes Fastify routes / entities / templates. Does not write tests (that is test-writer's job).
- **Test-writer** — takes the same subtask; **consults `test-tier-selection.md` first** to decide which of unit, integration, e2e (and optionally load/contract) apply; writes the tests at each applicable tier in the same diff as the implementation; runs them locally; reports pass/fail with specific failure diagnostics (which assertion, which tier, reproducible command). **For any UI-touching story**, consults `page-verification-hierarchy.md` and applies the Three-Tier escalation strictly: Tier 1 (integration-layer headless checks) runs first; Tier 2 (Playwright ARIA assertions) runs only after Tier 1 is green; Tier 3 (Playwright screenshots) runs only after Tier 2 is green; if a layout change moved any backdrop, the backdrop-contrast check runs at Tier 2 before any Tier 3 screenshot is allowed. May request the Feature-implementer revise the implementation if a test reveals a bug, but **does not modify implementation code directly**. Test failures that appear to reflect a spec ambiguity get escalated to Spec-enforcer, not silently worked around.
- **Spec-enforcer** — reads the full diff, compares against `docs/planning/*.md` and `skills/*.md`, flags drift. Is the last gate before the human review step. Does not write or modify code.

For each role, include: *purpose, when to invoke, inputs, skills to load by default, outputs, success criteria, explicit non-goals.*

### 4.3 Workflows

Save under `.antigravity/workflows/` (or wherever AntiGravity's current convention is — check the IDE; adapt the path if it differs). Write three:

- `implementstory.md` — takes a story ID, invokes Orchestrator, dispatches Feature-implementer + Test-writer in parallel. **Test gate — tier-escalated:** once both return, run tests in strict ascending order of cost. First, Vitest unit + integration tests (integration includes Tier 1 headless page-verification assertions). If green, run Playwright Tier 2 ARIA assertions. If green, run Playwright Tier 3 screenshots. **A failure at any tier loops back to Feature-implementer with the failure report; higher tiers are not run until lower tiers are green.** Cap at 3 iterations, then escalate to human. **Do not invoke Spec-enforcer until the full tier stack is green.** Then run Spec-enforcer on the combined diff, **stop before merge**, and produce a review bundle for the human. The review bundle must include: the diff, the test output at each tier that ran (with timings), the Spec-enforcer drift report, and the list of skills loaded during the run.
- `verifystory.md` — runs Spec-enforcer alone on an existing branch/diff; produces a drift report. Used for ad-hoc audits.
- `audit-tests.md` — scans a finished story (or a set of them) and verifies that the tests present actually cover the tiers declared in `tasks.md`. Flags: missing tier, thin coverage (e.g., e2e declared required but only a smoke test exists), tests that don't assert behaviour described in acceptance criteria. Output is a report, not a code change.

Each workflow is a prompt; keep them terse but unambiguous about the stop points and the test gate.

### 4.4 `tasks.md` at repo root

Convert the MVP feature set from `project-plan.md` into a dependency-ordered backlog of ~20–30 stories. Each story:

```markdown
### {id} — {title}
- **Feature area:** {ingestion | dashboard | ai | artifacts | auth | ci | retention | infra}
- **Depends on:** {list of story ids, or "none"}
- **Acceptance criteria:** {3-6 checkable bullets, sourced from product.md / architecture.md}
- **Test tiers required:** {subset of: unit, integration, e2e, load, contract} — one line per tier stating *why* it applies (or "n/a — pure config story" if genuinely none apply; this should be rare)
- **Page verification tiers (UI stories only):** {subset of: T1-headless, T2-aria, T3-visual} — one line per tier stating which checks apply; for a non-UI story (API-only, schema-only, infra-only) use "n/a — no page rendering"; for most UI stories T1 + T2 is sufficient, with T3 reserved for design-system or layout-token changes
- **Critical test paths:** {2-5 specific user journeys, invariants, or edge cases that must be asserted by the tests — not generic "happy path + error path" handwaving}
- **Skills required:** {list of skill slugs — must include at least one testing skill if any test tier is required}
- **Estimated agent runs:** {1-3}
- **Source:** {docs/planning/{file}.md#{section}}
```

Order: foundational infra → ingestion → storage + retention → dashboard read paths → AI analysis → artifacts → auth + multi-project → CI examples. Adjust based on actual dependencies you find.

### 4.5 `AGENTS_README.md` at repo root

One page max. Covers: directory layout (`skills/`, `agents.md`, `.antigravity/workflows/`, `tasks.md`), how to kick off a story (`/implementstory <id>`), how to review a diff (workflow stops before merge; human reads the review bundle), what to do when an agent gets stuck (escalate via `HANDOFF.md`), where the spec lives (`docs/planning/`, read-only).

### 4.6 `docs/ai_guidance/gaps.md`

Running log of anything the docs are silent or contradictory on that blocked skill authoring. For each: the question, which docs you checked, a proposed answer (but do not adopt it — flag for human).

### 4.7 `HANDOFF.md` at repo root

Final artifact of this session. Contains:

- File list you produced (with a one-line note on each)
- Every gap flagged in `gaps.md` (restate the top 5 here for visibility)
- Every autonomous decision you made (with reasoning) that a human should sanity-check
- The one story from `tasks.md` you recommend starting with in Phase 2, and why
- Anything about AntiGravity-specific conventions (workflow path, Agent Manager setup) that the human should verify before Phase 2

## 5. Session flow

1. Read all docs in §3. Take structured notes.
2. Produce §4.1 (skills). **Stop and self-review**: does each skill cite a doc section? Is the rule one sentence? Are there any skills that overlap — can they be merged?
3. Produce §4.2 (agents.md).
4. Produce §4.3 (workflows).
5. Produce §4.4 (tasks.md).
6. Produce §4.5 (AGENTS_README.md).
7. Produce §4.6 (gaps.md — if not already written incrementally).
8. Produce §4.7 (HANDOFF.md).
9. Stop.

If at any point a gap blocks you for more than 10 minutes of wall-clock reasoning, write the gap to `gaps.md` with your best-guess resolution and move on. Do not thrash.

## 5.5. Self-verification checkpoints (run these as you go)

Phase 1 produces markdown, not code — but the markdown still needs to be "tested" for coherence. Run the relevant checklist at the end of each deliverable step, before moving to the next.

**After §4.1 (skills):**
- Every skill's `source:` frontmatter field resolves to an actual section in `docs/planning/*`. (If you can't point to the exact section, the skill is speculative — rework or drop it.)
- No two skills contradict each other. If two skills touch the same concern, they must explicitly cross-reference, not compete.
- Each skill's "How to apply" is concrete enough that an independent implementer could act on it without asking follow-up questions. Read each one and ask: "Could I write code from this alone?"
- The five testing skills (`test-tier-selection`, `vitest-unit-testing`, `integration-testing`, `playwright-e2e-testing`, `page-verification-hierarchy`) together cover every test type an MVP feature could need. No tier unaccounted for.
- `page-verification-hierarchy.md` cites `~/Sites/ai_guidance/testing/verification-cookbook.md` as its source and adapts commands from Drupal/Canvas to Fastify/HTMX/Eta. The adaptation is concrete (real example commands against a CTRFHub endpoint), not hand-waved. `integration-testing.md` and `playwright-e2e-testing.md` both cross-reference it.

**After §4.2 (agents.md):**
- Dry-run check: pick the MVP feature "CTRF Ingestion" from `project-plan.md`. Walk through mentally: can Orchestrator decompose it into subtasks using only what's in `agents.md`? Can Feature-implementer produce route + entity + handler using only the skills you defined? Can Test-writer select tiers using `test-tier-selection.md` alone? If any step requires knowledge not captured in the scaffolding, fix the gap before continuing.
- Role responsibilities are mutually exclusive. No two roles overlap. In particular, Test-writer does not write implementation code, and Feature-implementer does not write tests.

**After §4.3 (workflows):**
- Simulation: run `implementstory.md` in your head against a dummy story. Does every handoff have clear inputs/outputs? Does the test gate block correctly on red tests? Is the 3-iteration cap enforced? Does the review bundle assemble everything a human needs in one place?
- `audit-tests.md` can actually detect the failure modes it claims to — write a one-line example for each.

**After §4.4 (tasks.md):**
- DAG check: no dependency cycles. Every story listed under `Depends on:` exists in the file and appears earlier in the ordering.
- Coverage check: every MVP feature from `project-plan.md` §MVP Feature Set has at least one story. Every sub-bullet in that section maps to at least one acceptance-criterion bullet somewhere in `tasks.md`.
- Skill-reachability check: every `Skills required:` entry refers to a skill file that actually exists in `skills/`.
- Test-tier sanity: for each story, the declared tiers actually fit the story shape. An API endpoint story must have at least integration tests. A UI-facing story must have at least one e2e path. A pure utility story can legitimately be unit-only.

**After §4.5 (AGENTS_README.md):**
- Reading-time check: the file should take under 5 minutes to read. If longer, it's trying to duplicate the skills or tasks — trim.

**After §4.6 (gaps.md):**
- Every flagged gap has: the specific question, docs consulted, your proposed resolution (clearly labelled as not adopted), and which skill or story it blocks.

**After §4.7 (HANDOFF.md):**
- A reader who has never seen this project should be able to navigate from HANDOFF.md to the first story worth implementing in under 3 minutes.

If any checkpoint fails, fix it before continuing. Do not accumulate debt across steps.

## 6. Quality bar (what the human reviewer will check)

- Each skill has a concrete source citation that resolves to a real section in `docs/planning/*`.
- Each skill's rule can be summarized in one sentence; the "How to apply" is step-by-step, not vague.
- `agents.md` roles are mutually exclusive — no role overlaps another's responsibility.
- `tasks.md` ordering respects stated dependencies (e.g., retention depends on ingestion + entity model existing).
- No MVP application code has been written.
- `HANDOFF.md` makes it obvious what to look at first.
- **Testing coverage in the scaffolding:**
  - The five testing skills exist and collectively define a complete testing strategy (unit, integration, e2e, selection meta-skill, and the page-verification hierarchy).
  - `page-verification-hierarchy.md` is a faithful adaptation of `~/Sites/ai_guidance/testing/verification-cookbook.md` for CTRFHub's Fastify + HTMX + Eta stack, with concrete Tier 1 commands (not copied Drupal/Canvas examples), Tier 2 ARIA assertion patterns (including the backdrop-contrast rule), and Tier 3 screenshot scope. It is cross-referenced from `integration-testing.md` (Tier 1 home) and `playwright-e2e-testing.md` (Tier 2 + Tier 3 home).
  - Every story in `tasks.md` declares `Test tiers required:`, `Page verification tiers:`, and `Critical test paths:`; declarations fit the story shape.
  - The Test-writer role in `agents.md` is specific about tier selection, the Tier 1 → Tier 2 → Tier 3 escalation rule for UI stories, failure-reporting format, and the non-goal of modifying implementation code.
  - The `implementstory` workflow has an explicit **tier-escalated** test gate that blocks Spec-enforcer until all required tiers are green, with a bounded iteration cap. Higher tiers are never run before lower tiers pass.
  - The `audit-tests` workflow exists and can verify declared-vs-actual test coverage on a finished story at both the unit/integration/e2e tier and the T1/T2/T3 page-verification level.

## 7. Explicit non-goals for this session

- Running any app. There is nothing to run yet.
- Installing dependencies. There is no `package.json`.
- Setting up CI. That is a later story.
- Writing README for end users. This is dev/agent infrastructure only.
- Optimizing anything. Clarity over cleverness.

## 8. When you are done

Write `HANDOFF.md`, then post a short message: *"Phase 1 scaffolding complete. HANDOFF.md is the entry point for review."* Then stop.

---

**Author of this brief:** Claude Opus 4.7 (via Claude Code CLI), working with André on 2026-04-23. Phase 2 (feature implementation) will be scoped in a separate brief after this one is reviewed.

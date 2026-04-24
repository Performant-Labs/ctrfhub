# CLAUDE.md — Project context for AI agents

This file is read automatically by agents that honor the `CLAUDE.md` convention (Claude Code CLI, Anthropic's `claude-code-action`, Qodo PR-Agent via `extra_instructions`, and others). It is the single pointer document for "what is this repo and how should an AI work on it."

## Project

**CTRFHub** — self-hosted, open-source, CTRF-native test-reporting dashboard. The "ReportPortal for the CTRF era." MIT licensed.

Stack: Node.js 22 LTS · Fastify · TypeScript (strict) · Zod · MikroORM v7 (Postgres prod / SQLite single-node) · HTMX 2.x · Alpine.js 3 · Tailwind 4 · Flowbite · idiomorph · Eta · Chart.js · Better Auth · Docker Compose.

## Agent names

| Codename | Model | Role |
|---|---|---|
| **Daed** (Daedalus) | Claude Opus 4.6 | Built Phase 1 infrastructure — skills, roles, workflows, task backlog |
| **Argos** | Claude Opus 4.7 | Orchestrator — assigns tasks, gates stories, runs audits |
| **Hermes** | — | André's personal manager agent (separate project) |

## Authoritative context — read in this order

1. `docs/planning/project-architecture.md` — **how this team works** (multi-session agent workflow, roles, artifact layout, branch/commit/PR conventions, escalation paths). Read this first; everything else is either spec or scaffolding that sits inside this workflow.
2. `docs/planning/project-plan.md` — north star; stack, MVP scope, HTMX 4.0 forward-compat rules
3. `docs/planning/architecture.md` — conventions (HTMX/Alpine boundary, viewport posture, rate limiting, security headers)
4. `docs/planning/product.md` — MVP feature requirements
5. `docs/planning/database-design.md` — entity model and relationships
6. Remaining `docs/planning/*.md` — deployment, settings, testing, AI features, gap reviews
7. `docs/planning/*` is the **authoritative spec**. Do not suggest changes to it during PR review or implementation work. If an ambiguity exists, flag it — don't resolve it unilaterally.

## Agent infrastructure (produced by Phase 1 scaffolding)

- `agents.md` — role definitions. On **PR review** contexts, default to the **Spec-enforcer** role.
- `skills/` — architectural skills. Each cites the `docs/planning/*` section it was derived from. Load all when reviewing.
- `tasks.md` — dependency-ordered MVP backlog. Each story declares its required test tiers and page-verification tiers.
- `.antigravity/workflows/` — `implementstory`, `verifystory`, `audit-tests`.
- `docs/planning/gaps.md` — running log of spec ambiguities awaiting human resolution.

## Org-wide standards

Located at `~/Sites/ai_guidance/` on developer machines (Performant Labs repo). PR-Agent in CI does not have this path — the relevant rules are already inlined/cited inside `skills/`. Key inherited standards:

- **Three-Tier Verification Hierarchy** for page testing: Tier 1 Headless (`curl` / `fastify.inject()` / cheerio, 1–5 s) → Tier 2 Structural ARIA (Playwright accessibility tree, 5–10 s) → Tier 3 Visual (Playwright screenshots, 60–90 s). **Tier 3 never runs before Tier 2 is green.** Full rule in `skills/page-verification-hierarchy.md`.
- Fastify, MikroORM, HTMX, Better Auth, Tailwind, Vitest conventions — each has a dedicated skill that cites its org-wide source.

## Default agent posture

**In PR review** (PR-Agent, `claude-code-action`, `@claude` mentions): Act as **Spec-enforcer**. Load `agents.md`, all `skills/`, `docs/planning/*`. Compare the diff against the spec. Flag drift with citations. Verify declared test tiers match what's present. Do not suggest rewrites or alternative architectures — this repo follows the spec deliberately.

**In interactive coding** (Claude Code CLI, AntiGravity Agent Manager): Load `agents.md`; pick the role that matches the user's ask (Orchestrator / Feature-implementer / Test-writer / Spec-enforcer). **If you are Argos (Orchestrator), read `ORCHESTRATOR_HANDOFF.md` before anything else — it gives you current task state, open gaps, and the next action.**

**Never**: modify `docs/planning/*`, reduce MVP scope, invent conventions not cited in `skills/`, mock the DB in integration tests, add Tier 3 visual assertions before Tier 2 ARIA assertions exist.

## Local PR review (MacBook, claude -p)

When GitHub-hosted PR review bots are unavailable or you want to run a review with local tokens:

```bash
# From repo root — print review to stdout
.antigravity/scripts/pr-review.sh <PR-number>

# Print + post back to GitHub as a PR comment
.antigravity/scripts/pr-review.sh <PR-number> --post
```

Requires: `claude` CLI (Claude Code, authenticated) + `gh` CLI (authenticated). The script fetches the diff and PR metadata via `gh`, passes them to `claude -p` as Spec-enforcer, and optionally posts the structured review to the PR via `gh pr review --comment`. CLAUDE.md is auto-read by `claude` because the script must be run from the repo root.

## Forbidden patterns (fast-fail flags for reviewers)

Any of these in a diff is a blocking finding — cite the skill + reason:

- `hx-target` / `hx-swap` inherited from a parent rather than written on the requesting element → `skills/htmx-4-forward-compat.md`
- Raw `htmx:xhr:*` event name strings anywhere in client code — must come from `src/client/htmx-events.ts` constants → `skills/htmx-4-forward-compat.md`
- Use of `hx-disable` (renamed to `hx-ignore` in HTMX 4.0) → `skills/htmx-4-forward-compat.md`
- Alpine `x-data` component containing an HTMX swap target, or vice versa → `skills/htmx-alpine-boundary.md`
- Postgres-only SQL or dialect-specific features in entities/migrations without a SQLite equivalent → `skills/mikroorm-dual-dialect.md`
- DB mocked in an integration test → `skills/integration-testing.md`
- Tier 3 (visual) Playwright assertions added before corresponding Tier 2 (ARIA) assertions exist → `skills/page-verification-hierarchy.md`
- A layout-token or backdrop-affecting change merged without a Tier 2 WCAG contrast re-check → `skills/page-verification-hierarchy.md`
- Story implementation missing the test tiers declared in `tasks.md` → `skills/test-tier-selection.md`
- Raw CSRF-token or session-cookie handling outside the Better Auth integration → `skills/better-auth-session-and-api-tokens.md`
- A Zod schema defined ad-hoc in a handler instead of being the single source of truth → `skills/zod-schema-first.md`

## Repo-level review priorities

When the diff touches any of these areas, the review must be extra thorough (consider requesting the `high-stakes` label to force Opus 4.6 re-review):

- Auth, session handling, API tokens, `/setup` bootstrap wizard, password reset, email verification
- Migrations, schema changes, dialect-sensitive SQL
- Artifact storage paths (local filesystem or S3/MinIO)
- Retention / pruning jobs
- Security headers, CSP, rate-limiter config
- Public API contract (`/api/ingest`, `/api/v1/search`, `/api/artifact`)

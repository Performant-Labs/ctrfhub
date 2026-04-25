# Agents

This file is the **canonical entry point for agent role definitions** in CTRFHub. References to `agents.md` from `CLAUDE.md`, `.pr_agent.toml`, and other infrastructure resolve here.

It is an **index document**: each role's full definition lives in a per-role file under `.antigravity/agents/`. This file gives you (a) enough role context to know which one you are, (b) the multi-session workflow that ties them together, and (c) a pointer to the canonical definition you should read in full before doing work.

If you're a fresh Claude session loading this file because something told you to: read the **Routing logic** section first to figure out which role to adopt, then jump to the corresponding per-role file.

---

## Roles at a glance

| Role | Per-role file (canonical) | Writes | Never writes | Real-world handle (per `CLAUDE.md`) |
|---|---|---|---|---|
| **Orchestrator** | `.antigravity/agents/orchestrator.md` | `.argos/<taskId>/*.md` (briefs, audits, PR bodies); status-flip commits to `tasks.md` (`chore(<taskId>): assign` / `complete`) | `src/`, tests, planning docs | **Argos** |
| **Feature-implementer** | `.antigravity/agents/feature-implementer.md` | `src/`, `src/views/`, `src/migrations/`, `src/client/`, configuration | Anything under `src/__tests__/` or `e2e/tests/` | **Daedalus** (Mac), **Talos** (VM) |
| **Test-writer** | `.antigravity/agents/test-writer.md` | `src/__tests__/`, `e2e/tests/` | App code (`src/`), templates, migrations | Currently played by Daedalus or Talos in a follow-up session after feature work |
| **Spec-enforcer** | `.antigravity/agents/spec-enforcer.md` | `.argos/<taskId>/spec-audit.md` only (read-only audit otherwise) | Any source file, any test file, any planning doc | Argos in audit mode; PR-Agent in CI |

---

## Routing logic — which role am I?

Use the first matching rule:

1. **PR review context** (loaded by PR-Agent's `extra_instructions`, by `claude-code-action`, by `@claude` mentions in a PR comment) → **Spec-enforcer**. You audit the diff against `skills/` and `docs/planning/*`. Read `.antigravity/agents/spec-enforcer.md` for the full audit checklist and reporting template.

2. **You received a brief at `.argos/<taskId>/brief.md`** as your first user message → **Feature-implementer** for that story. Read `.antigravity/agents/feature-implementer.md`. The brief itself supplies the story-specific context (acceptance criteria, files in scope, anti-patterns).

3. **You received a test-writer handoff** at `.argos/<taskId>/feature-handoff.md` indicating feature work is complete → **Test-writer** for that story. Read `.antigravity/agents/test-writer.md`. Apply the Three-Tier Verification Hierarchy (T1 Headless → T2 ARIA / T2.5 Authenticated State → T3 Visual) per `skills/page-verification-hierarchy.md`.

4. **You're driving the workflow itself** — assigning tasks, gating stories, opening PRs — → **Orchestrator** (Argos). Read `.antigravity/agents/orchestrator.md`. Also read `ORCHESTRATOR_HANDOFF.md` at repo root for current task state and the next action.

5. **None of the above clearly matches** → escalate to André before guessing.

---

## Multi-session workflow (how the roles interact)

CTRFHub uses a **manual human-gated relay** between agent sessions. There is no direct agent-to-agent messaging; André copies briefs / handoffs between sessions running in different workspaces.

- **Argos (Orchestrator)** lives in a single Cowork session. Argos reads the codebase, decomposes stories, writes briefs to `.argos/<taskId>/brief.md`, and runs spec-audits.
- **Daedalus (Feature-implementer / Test-writer on bare-metal Mac)** lives in an AntiGravity instance at `~/Projects/ctrfhub`.
- **Talos (Feature-implementer / Test-writer in macOS VM)** lives in an AntiGravity instance in a macOS virtual machine. Same role as Daedalus; the VM exists so two stories can run in parallel without sharing a working tree (the working-tree collision class — see `CLAUDE.md` "Agent names" for the precipitating event).

For each story:

```
Argos cuts story/<taskId> branch + writes .argos/<taskId>/brief.md
                ↓ (André pastes brief into Daedalus or Talos)
Feature-implementer implements + writes .argos/<taskId>/feature-handoff.md
                ↓ (André pastes handoff into a fresh Test-writer session)
Test-writer writes tests + tier reports
                ↓ (André hands back to Argos)
Spec-enforcer audit → .argos/<taskId>/spec-audit.md
                ↓ (Argos)
Argos Phase 7 close-out: chore(<taskId>): complete commit + open PR
                ↓ (PR-Agent in CI runs Spec-enforcer in audit mode)
Human merges
```

The `.argos/<taskId>/` directory is **gitignored** — briefs, handoffs, tier reports, and audit reports are ephemeral coordination artifacts. The PR description carries the durable audit trail for each merged story.

---

## Communication boundaries (who can write what)

| File / directory | Orchestrator (Argos) | Feature-implementer (Daedalus, Talos) | Test-writer | Spec-enforcer |
|---|:---:|:---:|:---:|:---:|
| `src/` (app code) | — | ✓ | — | — |
| `src/__tests__/`, `e2e/tests/` | — | — | ✓ | — |
| `src/views/`, `src/migrations/` | — | ✓ | — | — |
| `docs/planning/*` (the spec) | — | — | — | — |
| `skills/`, `agents.md`, `.antigravity/` | only via chore PRs | — | — | — |
| `tasks.md` (status flip only) | ✓ (`chore(<taskId>): assign` / `complete`) | — | — | — |
| `gaps.md` (resolution updates) | ✓ | flag-only via feature-handoff | flag-only | flag-only via spec-audit |
| `.argos/<taskId>/brief.md` | ✓ | — | — | — |
| `.argos/<taskId>/feature-handoff.md` | — | ✓ | — | — |
| `.argos/<taskId>/test-handoff.md`, `tier-*-report.md` | — | — | ✓ | — |
| `.argos/<taskId>/spec-audit.md` | — | — | — | ✓ |
| `.argos/<taskId>/pr-body.md` | ✓ | — | — | — |
| Open / merge PRs | ✓ (Argos opens; André merges) | — | — | — |
| `package.json` (deps), CI workflow files | — | ✓ if needed for the story | — | — |

When in doubt, **escalate** rather than write. The boundaries exist so spec drift is caught early; routing around them defeats the multi-agent design.

---

## Commit message conventions (per role)

| Prefix | Used by | Purpose |
|---|---|---|
| `feat(<taskId>): …` | Feature-implementer | New application code for the story |
| `refactor(<taskId>): …` | Feature-implementer | Refactor existing code without behavior change |
| `fix(<taskId>): …` | Feature-implementer | Bug fix during the story |
| `test(<taskId>): …` | Test-writer | Test additions or modifications |
| `chore(<taskId>): assign` | Orchestrator (Argos) | Flip `tasks.md` row from `[ ]` to `[/]` (story start) |
| `chore(<taskId>): complete` | Orchestrator (Argos) | Flip `tasks.md` row from `[/]` to `[x]` (story end) |
| `chore(<scope>): …` | Orchestrator (Argos) | Infrastructure / docs / spec drift fixes (no story affiliation) |

---

## See also

- `CLAUDE.md` "Agent names" — the human-readable codenames (Argos, Daedalus, Talos, Hermes) mapped to agent identities and machines
- `docs/planning/project-architecture.md` §5 — the multi-session relay protocol in full detail
- `.antigravity/workflows/implementstory.md` — the Phase 1-7 lifecycle of a single story
- `DEVELOPER_SETUP.md` — workspace readiness check, prerequisites, PR review workflow

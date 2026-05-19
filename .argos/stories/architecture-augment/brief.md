# Story: Augment docs/planning/architecture.md with Code Architecture + Operational Invariants

## Motivation
`docs/planning/architecture.md` already exists as a strong stack/deployment/security document, but a recent gap analysis (see evidence-arch-md-review.md in this story's namespace) found it covers only ~30–40% of what the Architecture Reviewer (A) agent needs as a yardstick in audit mode. Specifically, 9 of ~13 code-layer dimensions A audits are MISSING, the most-cited audit dimension (§Layering) is a dangling reference, and several sections are stale vs. PRs #71/#72/#73/#74/#75 that have merged since the doc was last updated.

This story augments the existing doc with the missing sections — it does NOT replace it. André reviews the resulting PR carefully before merge; A then uses the merged doc as its audit yardstick.

## Authorized exception to "Never modify docs/planning/*"
The existing governance has a rule against modifying `docs/planning/*`. This story is the **explicit exception** that codifies an exception process. F is authorized to edit `docs/planning/architecture.md` solely to add the augmentations listed below. F MUST NOT modify any other file under `docs/planning/`. The new `§Document Authority + Exception Process` section (one of the augmentations) will document the exception process going forward.

## Scope — augmentations to add

1. **§Layering and dependency direction** (closes the dangling citation in `auditarchitecture.md` workflow). Define the layering chain (presentation → service → repository → ORM → DB; templates only consume view models; etc.). Include a small ASCII or mermaid diagram showing allowed dependency directions. Capture from observable patterns in `src/` because conventions ARE majority patterns for this category. Where the codebase appears to drift, write the intended rule as the standard and note the drift parenthetically — André will adjudicate.

2. **§Code Conventions.** Naming (files, classes, functions, constants), file organization within `src/`, error handling patterns (what surfaces to user, what's logged, what's swallowed), route registration patterns, MikroORM repository usage patterns, logging/transaction boundaries, expected abstraction levels (service vs. controller vs. utility). Cite at least one canonical example file per convention.

3. **§Operational Invariants** (baked in by recent PRs). Each as a normative rule:
   - Asset-pipeline bridging (PR #71): production reads from `dist/assets/`; the build stage MUST copy vendored assets `src/assets/* → dist/assets/`. Cite the PR.
   - Build-layer caching (PR #72): warm builds under 30s; use `--mount=type=cache` for npm; `scripts/docker-build-cached.sh` is the canonical verification command. Cite PR.
   - Orchestrator constraint-override clause (PR #73): autonomy rule that the Constraints section of any brief is authoritative over a literal-reading of acceptance criteria. Cite PR.
   - Test-writer sizing (PR #74): one test per distinct branch; matrix is per-route ceiling not per-asset multiplier; pre-handoff isolation self-check. Cite PR.
   - Issue-management workflows (PR #75): dedupe on `issues: opened` via `gh issue list --search`; `actions/stale@v9` daily sweep; `stale`/`pinned` label semantics. Cite PR.

4. **§Document Authority and Exception Process.** State that `architecture.md` is THE authoritative yardstick for A in audit mode. State the rule: `docs/planning/*` is read-only by default; exceptions are authorized only via a brief that explicitly cites the exception (like this story). Define the process for proposing a future exception.

5. **Stale-section refresh** (minimal, scoped):
   - CI section: add a one-paragraph note pointing at the new dedupe + stale workflows from PR #75
   - Docker section: add a one-paragraph note on the BuildKit caching layer from PR #72
   - Asset-pipeline section: reframe the pipeline as an invariant per PR #71 (the `dist/assets/` bridge rule)

6. **Resolve the `project-architecture.md` discrepancy.** The Architecture Reviewer agent's role file references `project-architecture.md` as the baseline, but the audit workflow references `docs/planning/architecture.md`. There can be only one canonical doc. F's call: rename, redirect via stub, or merge. Document the choice in the new §Document Authority section. If F renames, also update A's role file to match.

## Sources

- The existing `docs/planning/architecture.md` (full read; this is the doc you're augmenting)
- All local planning/process docs (CLAUDE.md, FLOW.md, HANDOFF.md, agents.md, AGENT_LOOP_ON_URANUS.md, etc.)
- The symlinked ai_guidance repo via `docs/ai_guidance/` for cross-project conventions
- The five recent PRs (#71/#72/#73/#74/#75) — read their merged diffs and PR bodies for the operational invariants section
- `src/` is allowed for THIS story for the Code Conventions and Layering sections (descriptive capture of majority patterns); F should clearly mark which rules are descriptive-from-code vs. derived-from-docs

## Acceptance criteria
- `docs/planning/architecture.md` PR opened, containing all 6 augmentations
- The dangling `§Layering` citation in `docs/orchestrator-workflows/auditarchitecture.md` now resolves
- The `project-architecture.md` vs `architecture.md` discrepancy is resolved (one is canonical; the other is a stub or removed)
- The new §Document Authority + Exception Process section makes clear how future exceptions to "Never modify docs/planning/*" are requested
- Every added/updated section carries inline citations
- No application code changes (`src/` is read-only for this story)
- All existing tests still pass

## Constraints
- Touch ONLY: `docs/planning/architecture.md` (augment), optionally `docs/planning/project-architecture.md` (resolve discrepancy), and `.claude/agents/architecture-reviewer.md` (only if A's baseline reference needs updating to match the canonical doc name).
- Do not change any application code, tests, workflows, or other planning docs.
- No new files outside what's listed above.

## Note to Argos
This is the augmentation story replacing the cancelled `architecture-baseline`. It is **authorized to write into `docs/planning/`**. Read `evidence-arch-md-review.md` (in this story's namespace, copied alongside) before drafting — it contains the gap analysis. After this merges, the audit campaign can proceed: Phase 1 `audit-scoping`, then Phase 2 territory audits starting with `audit-auth`.

Start when explicitly kicked off by André.

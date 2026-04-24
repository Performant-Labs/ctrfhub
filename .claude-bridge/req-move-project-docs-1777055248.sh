#!/bin/bash
set -e
cd ~/Projects/ctrfhub
rm -f .git/HEAD.lock .git/index.lock
echo "=== PWD ==="
pwd
echo "=== Moving the four stranded files out of the subtree ==="
git mv docs/ai_guidance/tasks.md                   docs/planning/tasks.md
git mv docs/ai_guidance/gaps.md                    docs/planning/gaps.md
git mv docs/ai_guidance/opus-4-6-phase-1-brief.md  docs/planning/opus-4-6-phase-1-brief.md
git mv docs/ai_guidance/pr-agent-setup.md          docs/planning/pr-agent-setup.md
echo "=== Staging reference updates ==="
git add \
  CLAUDE.md \
  AGENTS_README.md \
  ORCHESTRATOR_HANDOFF.md \
  HANDOFF.md \
  .pr_agent.toml \
  .antigravity/agents/orchestrator.md \
  .antigravity/agents/spec-enforcer.md \
  .antigravity/workflows/implementstory.md \
  .antigravity/scripts/pr-review.sh \
  docs/planning/KICKOFF.md \
  docs/planning/opus-4-6-phase-1-brief.md \
  docs/planning/pr-agent-setup.md
echo "=== Committing ==="
git -c user.name="André Angelantoni" -c user.email="andre.angelantoni@performantlabs.com" \
  commit -m "refactor(docs): move project-specific docs out of the ai_guidance subtree

docs/ai_guidance/ is a git subtree whose upstream is ~/Sites/ai_guidance.
Four CTRFHub-specific files were accidentally placed inside the subtree
directory but are not in the upstream — every subtree sync put them at
risk of deletion.

Move to docs/planning/ (the correct home for project-specific docs):
- tasks.md                    (dependency-ordered MVP backlog)
- gaps.md                     (CTRFHub gap registry)
- opus-4-6-phase-1-brief.md   (Daed's Phase 1 scaffolding brief)
- pr-agent-setup.md           (GitHub PR-Agent review configuration)

Update all path-qualified references across CLAUDE.md, AGENTS_README.md,
ORCHESTRATOR_HANDOFF.md (tree diagram refreshed), HANDOFF.md,
.pr_agent.toml (bare 'tasks.md' upgraded to the full path in four
places so the reviewer LLM resolves them unambiguously), the four
.antigravity/ agent/workflow/script files, docs/planning/KICKOFF.md,
and the two moved files' own self-references.

Leaves docs/ai_guidance/ containing only legitimate subtree content."
echo "=== Post-commit state ==="
git log --oneline -3
echo "=== Working tree ==="
git status --short

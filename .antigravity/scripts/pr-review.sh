#!/usr/bin/env bash
# .antigravity/scripts/pr-review.sh
#
# Run a Spec-enforcer PR review via `claude -p` and optionally post
# the result back to GitHub as a review comment.
#
# Usage:
#   .antigravity/scripts/pr-review.sh <PR-number> [--post]
#
#   --post   Post the review output as a GitHub PR comment via `gh pr review`.
#            Omit to just print the review to stdout.
#
# Prerequisites:
#   - `claude` CLI installed and authenticated (Claude Code on this machine)
#   - `gh` CLI installed and authenticated (`gh auth login`)
#   - Run from the repo root (CLAUDE.md must be in cwd)

set -euo pipefail

# Ensure homebrew binaries are on PATH (runner shells may have a minimal PATH)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PR_NUMBER="${1:-}"
POST_TO_GH=false

if [[ -z "$PR_NUMBER" ]]; then
  echo "Usage: $0 <PR-number> [--post]" >&2
  exit 1
fi

if [[ "${2:-}" == "--post" ]]; then
  POST_TO_GH=true
fi

if [[ ! -f "CLAUDE.md" ]]; then
  echo "Error: run this script from the repo root (CLAUDE.md not found in cwd)" >&2
  exit 1
fi

for cmd in claude gh; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '$cmd' not found. Install it first." >&2
    exit 1
  fi
done

echo "→ Fetching PR #${PR_NUMBER} metadata..." >&2
PR_META=$(gh pr view "$PR_NUMBER" --json title,body,author,headRefName,baseRefName \
  --template '## PR: {{.title}}
Branch: {{.headRefName}} -> {{.baseRefName}}
Author: {{.author.login}}

### Description
{{.body}}')

echo "→ Fetching diff..." >&2
PR_DIFF=$(gh pr diff "$PR_NUMBER")

# Write prompt to a temp file — avoids nested heredoc/quoting issues
# in non-interactive runner shells.
PROMPT_FILE=$(mktemp /tmp/ctrfhub-pr-review-XXXXXX.md)
trap 'rm -f "$PROMPT_FILE"' EXIT

cat > "$PROMPT_FILE" <<ENDOFPROMPT
You are Argos, the Spec-enforcer for CTRFHub. CLAUDE.md in this repo has been loaded
automatically as your project context. Perform a PR review now.

## What to do

1. Read every file in skills/ that is relevant to this diff (check trigger: conditions
   in each skill's frontmatter).
2. Check the diff against every forbidden pattern listed in CLAUDE.md under
   "Forbidden patterns".
3. Check docs/ai_guidance/tasks.md -- find the story this PR implements (match by
   task ID in the PR description or branch name). Verify that the test tiers declared
   in "Test tiers required" and "Page verification tiers" are present in this diff.
4. Check for missing integration tests: every new route file must have a corresponding
   test file in src/__tests__/integration/.
5. Check dual-dialect migration parity: PG and SQLite migration file counts must match.

## Output format

---
## Spec-enforcer Review -- PR #${PR_NUMBER}

### Verdict: PASS | BLOCK | WARN

### Findings
(For each finding):
[BLOCK|WARN|INFO] file:line -- description
Rule: skill file or CLAUDE.md section
Fix: specific remediation

(If no findings: "No findings. All checked patterns pass.")

### Test tier coverage
Story: task ID if found, else "not identified"
- Test tiers required: from tasks.md or "not found"
- Present in diff: list what was found
- Missing: list what was not found, or "none"

### Migration parity
PG migrations: count
SQLite migrations: count
Status: MATCH | MISMATCH

### Summary
2-3 sentence plain-English summary of what the PR does and whether it can merge.
---

## PR metadata
${PR_META}

## Diff
${PR_DIFF}
ENDOFPROMPT

echo "→ Running Spec-enforcer review via claude -p..." >&2
REVIEW=$(claude -p < "$PROMPT_FILE") || {
  echo "Error: claude -p exited with code $?. Check: claude auth status" >&2
  exit 1
}

echo ""
echo "════════════════════════════════════════"
echo "$REVIEW"
echo "════════════════════════════════════════"

if [[ "$POST_TO_GH" == "true" ]]; then
  echo "" >&2
  echo "→ Posting review to PR #${PR_NUMBER}..." >&2
  gh pr review "$PR_NUMBER" --comment --body "$REVIEW"
  echo "→ Posted." >&2
fi

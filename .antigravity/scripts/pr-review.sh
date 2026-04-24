#!/usr/bin/env bash
# .antigravity/scripts/pr-review.sh
#
# Run a Spec-enforcer PR review via `claude -p` and optionally post
# the result back to GitHub as a review comment.
#
# Usage:
#   .antigravity/scripts/pr-review.sh <PR-number> [--post] [--model <model>]
#
#   --post            Post the review output as a GitHub PR comment via `gh pr review`.
#                     Omit to just print the review to stdout.
#   --model <model>   Claude model to use (default: $ARGOS_MODEL or claude-sonnet-4-6).
#                     Examples: claude-sonnet-4-6, claude-opus-4-6
#
# Prerequisites:
#   - `claude` CLI installed and authenticated (Claude Code on this machine)
#   - `gh` CLI installed and authenticated (`gh auth login`)
#   - Run from the repo root (CLAUDE.md must be in cwd)

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PR_NUMBER="${1:-}"
POST_TO_GH=false
MODEL="${ARGOS_MODEL:-claude-opus-4-7}"

if [[ -z "$PR_NUMBER" ]]; then
  echo "Usage: $0 <PR-number> [--post] [--model <model>]" >&2
  exit 1
fi

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --post)  POST_TO_GH=true; shift ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    *)       echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

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

# Write prompt to a temp file to avoid heredoc/quoting issues.
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
3. Check docs/planning/tasks.md -- find the story this PR implements (match by
   task ID in the PR description or branch name). Verify that the test tiers declared
   in "Test tiers required" and "Page verification tiers" are present in this diff.
4. Check for missing integration tests: every new route file must have a corresponding
   test file in src/__tests__/integration/.
5. Check dual-dialect migration parity: PG and SQLite migration file counts must match.

## Output format (GitHub-rendered markdown)

Open the review with a GitHub alert callout whose type matches the verdict
(GitHub renders these as coloured boxes):

- ✅ PASS  → \`> [!TIP]\`      (green)
- ⚠️ WARN  → \`> [!WARNING]\`  (amber)
- ❌ BLOCK → \`> [!CAUTION]\`  (red)
- N/A      → \`> [!NOTE]\`     (blue — for pure-docs PRs where no applicable rules exist)

Do NOT include opening or closing \`---\` separators in the body; the shell
wrapper appends the divider between the review and the signature footer.
Use the section headers below exactly as written.

## Spec-enforcer Review — PR #${PR_NUMBER}

> [!TIP]
> **Verdict:** ✅ PASS — <one-sentence reason>

### Findings

For each finding:
- **[BLOCK | WARN | INFO]** \`file:line\` — description
  - **Rule:** skill filename or CLAUDE.md section
  - **Fix:** specific remediation

(If no findings: "No findings. All checked patterns pass.")

### Test tier coverage

- **Story:** task ID if found, else "not identified"
- **Test tiers required:** from tasks.md, or "not found"
- **Present in diff:** list what was found
- **Missing:** list what was not found, or "none"

### Migration parity

- **PG migrations:** count
- **SQLite migrations:** count
- **Status:** ✅ MATCH or ❌ MISMATCH

### Summary

2–3 sentence plain-English summary of what the PR does and whether it can merge.

## PR metadata
${PR_META}

## Diff
${PR_DIFF}
ENDOFPROMPT

echo "→ Running Spec-enforcer review via claude -p --model ${MODEL}..." >&2
# --dangerously-skip-permissions: let claude read skills/ and docs/ without prompting.
PROMPT_CONTENT=$(cat "$PROMPT_FILE")

# Capture wall-clock time
START_TIME=$(date +%s)

REVIEW=$(claude -p --model "$MODEL" --dangerously-skip-permissions "$PROMPT_CONTENT") || {
  echo "Error: claude -p exited with code $?" >&2
  echo "Check: claude auth status? PATH correct (homebrew bins)?" >&2
  exit 1
}

END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))

# Append metadata footer
REVIEW="${REVIEW}

---
🤖 **Reviewer:** Argos · **Model:** \`${MODEL}\` · **Elapsed:** ${ELAPSED}s · **Generated:** $(date '+%Y-%m-%d %H:%M %Z') · $(date -u '+%Y-%m-%d %H:%M UTC')"

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

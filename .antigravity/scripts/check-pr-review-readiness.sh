#!/usr/bin/env bash
# .antigravity/scripts/check-pr-review-readiness.sh
#
# Verifies that both PR review methods are ready to fire:
#   1. PR-Agent (cloud, Kimi K2 / Opus 4.6 via OpenRouter)
#   2. Argos local review (self-hosted runner, claude -p)
#
# Usage: .antigravity/scripts/check-pr-review-readiness.sh
# Run from the repo root.

set -euo pipefail

PASS="✅"
FAIL="❌"
WARN="⚠️ "
errors=0

echo ""
echo "═══════════════════════════════════════════════"
echo " CTRFHub PR Review — Readiness Check"
echo "═══════════════════════════════════════════════"
echo ""

# ─── Method 1: PR-Agent (cloud) ───────────────────

echo "── Method 1: PR-Agent (cloud, Kimi K2 / Opus 4.6) ──"

# .pr_agent.toml exists
if [[ -f ".pr_agent.toml" ]]; then
  echo "$PASS .pr_agent.toml present"
else
  echo "$FAIL .pr_agent.toml missing — create it at repo root"
  ((errors++))
fi

# GitHub workflow exists
if [[ -f ".github/workflows/pr-review.yml" ]]; then
  echo "$PASS .github/workflows/pr-review.yml present"
else
  echo "$FAIL .github/workflows/pr-review.yml missing"
  ((errors++))
fi

# OPENROUTER_API_KEY — can only warn, can't read GH secrets locally
echo "$WARN OPENROUTER_API_KEY — verify it is set in:"
echo "     GitHub → repo → Settings → Secrets and variables → Actions"

echo ""

# ─── Method 2: Argos local review (manual, claude -p) ───

echo "── Method 2: Argos local review (manual — run from a terminal) ──"

# pr-review.sh exists and is executable
if [[ -x ".antigravity/scripts/pr-review.sh" ]]; then
  echo "$PASS .antigravity/scripts/pr-review.sh present and executable"
else
  echo "$FAIL .antigravity/scripts/pr-review.sh missing or not executable"
  ((errors++))
fi

# claude CLI available
if command -v claude &>/dev/null; then
  echo "$PASS claude CLI found: $(which claude)"
  if claude auth status &>/dev/null 2>&1; then
    echo "$PASS claude is authenticated"
  else
    echo "$WARN claude may not be authenticated — run: claude auth login"
  fi
else
  echo "$FAIL claude CLI not found — install Claude Code"
  ((errors++))
fi

# gh CLI available
if command -v gh &>/dev/null; then
  echo "$PASS gh CLI found: $(which gh)"
  if gh auth status &>/dev/null 2>&1; then
    echo "$PASS gh is authenticated"
  else
    echo "$WARN gh not authenticated — run: gh auth login"
  fi
else
  echo "$FAIL gh CLI not found — install: brew install gh"
  ((errors++))
fi

# Optional shell alias
if [[ -f ".antigravity/scripts/shell-aliases.sh" ]]; then
  echo "$PASS shell-aliases.sh present"
  echo "     (source it from ~/.zshrc to enable the \`pr:review <PR>\` shortcut)"
else
  echo "$WARN shell-aliases.sh missing — the \`pr:review\` shortcut won't be available"
fi

echo ""
echo "── Manual local test ──"
echo "   Run a review against any open PR:"
echo "   .antigravity/scripts/pr-review.sh <PR-number>"
echo "   .antigravity/scripts/pr-review.sh <PR-number> --post"
echo ""
echo "   Or, if shell-aliases.sh is sourced in your ~/.zshrc:"
echo "   pr:review <PR-number>"
echo "   pr:review <PR-number> --post"
echo ""

# ─── Summary ──────────────────────────────────────

echo "═══════════════════════════════════════════════"
if [[ $errors -eq 0 ]]; then
  echo " $PASS All hard checks passed."
  echo " Verify OPENROUTER_API_KEY in GitHub secrets, then both methods are live."
else
  echo " $FAIL $errors hard check(s) failed. Fix them before the first PR."
fi
echo "═══════════════════════════════════════════════"
echo ""

exit $errors

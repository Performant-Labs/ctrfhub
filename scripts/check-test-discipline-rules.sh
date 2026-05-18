#!/usr/bin/env bash
#
# check-test-discipline-rules.sh — governance lint for the test-writer discipline rules.
#
# Why this exists
# ---------------
# Story `test-writer-discipline` tuned the test-writer (T) agent to land
# minimum-meaningful coverage instead of matrix fan-out. The tuning lives in
# three plain-text governance docs, so there is no compiled artifact a `tsc`
# pass would protect. This script is that protection: it asserts the new
# test-sizing rules are still present in all three docs, and fails CI loudly
# if a future edit silently drops one.
#
# It is the verification artifact for acceptance criterion 1 of the story
# (Argos binding Decision 1: an audit script in scripts/, NOT a unit test —
# a src/__tests__/ file would fall outside the story's allowed file set).
#
# What it checks
# --------------
#   .claude/agents/test-writer.md          — test-sizing rule, per-route ceiling
#                                            wording, worked counter-example,
#                                            pre-handoff self-check.
#   docs/orchestrator-workflows/verifystory.md   — pre-handoff self-check.
#   docs/orchestrator-workflows/audit-tests.md   — fan-out penalty / metric
#                                            change to tests-per-distinct-branch.
#
# Usage
# -----
#   scripts/check-test-discipline-rules.sh        # or: npm run check:test-discipline
#
# Exit code: 0 if every required rule is present; 1 (with a per-rule report)
# if any is missing.
#
set -euo pipefail

cd "$(dirname "$0")/.."

TEST_WRITER=".claude/agents/test-writer.md"
VERIFYSTORY="docs/orchestrator-workflows/verifystory.md"
AUDIT_TESTS="docs/orchestrator-workflows/audit-tests.md"

FAILURES=0

# require <file> <human-description> <substring>
# Asserts <substring> appears (case-insensitively) in <file>.
require() {
  local file="$1" desc="$2" needle="$3"
  if [[ ! -f "$file" ]]; then
    echo "  ✗ MISSING FILE: $file (needed for: $desc)"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if grep -qiF -- "$needle" "$file"; then
    echo "  ✓ $desc"
  else
    echo "  ✗ $desc"
    echo "      file:    $file"
    echo "      missing: \"$needle\""
    FAILURES=$((FAILURES + 1))
  fi
}

echo "==> Checking test-writer discipline rules"

echo ""
echo "$TEST_WRITER"
require "$TEST_WRITER" \
  "test-sizing rule — one test per distinct branch added" \
  "One test per distinct branch added"
require "$TEST_WRITER" \
  "test-sizing rule — one test per distinct branch removed" \
  "One test per distinct branch removed"
require "$TEST_WRITER" \
  "4xx matrix is a per-route ceiling, not a per-asset multiplier" \
  "per-route ceiling, not a per-asset multiplier"
require "$TEST_WRITER" \
  "loops over inputs sharing a branch count as ONE test" \
  "count as ONE test, not N"
require "$TEST_WRITER" \
  "worked counter-example present (24-test fan-out)" \
  "24 tests for one prefix check"
require "$TEST_WRITER" \
  "pre-handoff self-check — fail-in-isolation question" \
  "Would this test fail in isolation if the code were wrong?"

echo ""
echo "$VERIFYSTORY"
require "$VERIFYSTORY" \
  "pre-handoff self-check present in verifystory workflow" \
  "Would this test fail in isolation if the code were wrong?"
require "$VERIFYSTORY" \
  "pre-handoff self-check is mandatory before handoff" \
  "Pre-handoff self-check (mandatory before any"

echo ""
echo "$AUDIT_TESTS"
require "$AUDIT_TESTS" \
  "fan-out penalized — metric is tests-per-distinct-branch" \
  "tests-per-distinct-branch"
require "$AUDIT_TESTS" \
  "coverage pressure is bidirectional, not one-directional" \
  "bidirectional"
require "$AUDIT_TESTS" \
  "fan-out detection section present" \
  "Fan-out detection"

echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "==> FAIL: $FAILURES required test-discipline rule(s) missing."
  echo "    The test-writer discipline rules (story test-writer-discipline) have"
  echo "    regressed. Restore the wording listed above before merging."
  exit 1
fi

echo "==> PASS: all test-writer discipline rules present."

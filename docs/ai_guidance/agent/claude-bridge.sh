#!/usr/bin/env bash
# Claude command bridge — run on the host in a dedicated terminal.
#
# Claude drops request files into .claude-bridge/req-<id>.sh; this script
# executes each one on the host (so ddev, drush, git, curl all work), then
# writes the combined stdout+stderr to res-<id>.out and the exit code to
# res-<id>.exit, and removes the request.
#
# Usage (from the repo root):
#   ./scripts/claude-bridge.sh
#
# Ctrl-C to stop at any time. Safe to re-start.
#
# Security: this executes ARBITRARY shell commands from Claude with your
# user's privileges. Only run while actively collaborating.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="$REPO_ROOT/.claude-bridge"
mkdir -p "$BRIDGE"

# Clean any stale results from a previous run so Claude doesn't read them.
rm -f "$BRIDGE"/res-*.out "$BRIDGE"/res-*.exit 2>/dev/null

echo "Claude bridge running."
echo "  repo:   $REPO_ROOT"
echo "  bridge: $BRIDGE"
echo "  cwd for commands: $REPO_ROOT"
echo "Ctrl-C to stop."
echo

cd "$REPO_ROOT"

while true; do
  # Glob may expand to the literal pattern if nothing matches — guard with -e.
  shopt -s nullglob
  for req in "$BRIDGE"/req-*.sh; do
    id="${req##*/req-}"; id="${id%.sh}"
    ts="$(date +%H:%M:%S)"
    # Extract a short first-line hint for the log.
    hint="$(head -n 1 "$req" | tr -d '\r' | cut -c1-80)"
    echo "[$ts] req-$id  $hint"
    # Run in the repo root. Use bash to honor shebang-less scripts.
    bash "$req" > "$BRIDGE/res-$id.out" 2>&1
    echo $? > "$BRIDGE/res-$id.exit"
    rm -f "$req"
    echo "[$(date +%H:%M:%S)] res-$id  exit=$(cat "$BRIDGE/res-$id.exit")  bytes=$(wc -c < "$BRIDGE/res-$id.out")"
  done
  shopt -u nullglob
  sleep 1
done

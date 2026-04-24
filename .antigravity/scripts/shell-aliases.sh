# CTRFHub shell aliases & functions
#
# Source this from your shell profile (zsh) to enable project shortcuts:
#
#   echo 'source ~/Projects/ctrfhub/.antigravity/scripts/shell-aliases.sh' >> ~/.zshrc
#
# Portable across macOS and Linux, **zsh only** — function names use colons
# (e.g. `pr:review`) which are legal in zsh but a parse error in bash. If you
# use bash, either skip this file or rename the functions locally.

# CTRFHub repo location. Override in your profile if the repo lives elsewhere:
#   export CTRFHUB_DIR="$HOME/code/ctrfhub"
: "${CTRFHUB_DIR:=$HOME/Projects/ctrfhub}"

# pr:review — run the Argos (Spec-enforcer) PR review via `claude -p`.
# Usage:
#   pr:review <PR-number>              # print review to stdout
#   pr:review <PR-number> --post       # also post the review as a PR comment
#   pr:review <PR-number> --model X    # override the default model
pr:review() {
  if [[ ! -d "$CTRFHUB_DIR" ]]; then
    echo "pr:review: CTRFHUB_DIR not a directory: $CTRFHUB_DIR" >&2
    echo "         Set it in your shell profile if the repo is elsewhere." >&2
    return 1
  fi
  ( cd "$CTRFHUB_DIR" && ./.antigravity/scripts/pr-review.sh "$@" )
}

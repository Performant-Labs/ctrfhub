#!/bin/bash

# AI Guidance Alignment Tool (Gemini-Powered)
# Follows the AI Guidance Alignment Protocol

# --- Color Definitions ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# --- Load Configuration ---
CONFIG_FILE="$(dirname "$0")/guidance-align.env"
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    # Fallback defaults
    GEMINI_MODEL="gemini-3-pro-preview"
    CANONICAL_SOURCE="$HOME/Sites/ai_guidance"
fi

SOURCE_DIR="$CANONICAL_SOURCE"
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

# --- Pre-flight Checks ---
if [ -z "$PROJECT_ROOT" ]; then
    echo -e "${RED}🚨 Error: Must be run inside a git repository.${NC}"
    exit 1
fi

TARGET_DIR="$PROJECT_ROOT/docs/ai_guidance"
# Internal paths updated to new location
PROTOCOL_FILE="$TARGET_DIR/admin_tools/guidance-alignment-protocol.md"

if ! command -v gemini &> /dev/null; then
    echo -e "${RED}🚨 Error: 'gemini' CLI is not installed.${NC}"
    echo -e "${YELLOW}Setup Instructions: brew install geminicli && gemini login${NC}"
    exit 1
fi

if [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${RED}🚨 Error: Source repository not found at $SOURCE_DIR${NC}"
    exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
    echo -e "${RED}🚨 Error: Target directory $TARGET_DIR not found.${NC}"
    exit 1
fi

echo -e "${CYAN}🔍 Running AI Guidance Alignment Analysis...${NC}"

# Run deterministic comparison
# EXCLUSION ADDED: ignore admin_tools/ folder so the tool doesn't sync itself
DIFF_OUTPUT=$(diff -rq "$TARGET_DIR" "$SOURCE_DIR" --exclude='.git' --exclude='admin_tools' 2>&1)

if [ -z "$DIFF_OUTPUT" ]; then
    echo -e "${GREEN}✅ Everything is in sync.${NC}"
    exit 0
fi

# --- Generate the Protocol-compliant Numbered List ---
echo -e "${YELLOW}Divergences Found (Relative to Project Root):${NC}"
REPORT=""
i=1
while read -r line; do
    [ -z "$line" ] && continue
    
    ACTION=""
    REL_PATH_IN_TARGET=""
    COLOR=$NC
    
    if [[ $line == Only\ in\ $TARGET_DIR* ]]; then
        DIR_PART=$(echo "$line" | cut -d: -f1 | sed "s|Only in ||")
        FILE_PART=$(echo "$line" | cut -d: -f2 | sed 's|^ ||')
        [ "$DIR_PART" == "$TARGET_DIR" ] && REL_PATH_IN_TARGET="$FILE_PART" || REL_PATH_IN_TARGET="${DIR_PART#$TARGET_DIR/}/$FILE_PART"
        ACTION="push"
        COLOR=$GREEN
    elif [[ $line == Only\ in\ $SOURCE_DIR* ]]; then
        DIR_PART=$(echo "$line" | cut -d: -f1 | sed "s|Only in ||")
        FILE_PART=$(echo "$line" | cut -d: -f2 | sed 's|^ ||')
        [ "$DIR_PART" == "$SOURCE_DIR" ] && REL_PATH_IN_TARGET="$FILE_PART" || REL_PATH_IN_TARGET="${DIR_PART#$SOURCE_DIR/}/$FILE_PART"
        ACTION="pull"
        COLOR=$YELLOW
    elif [[ $line == Files\ *differ ]]; then
        FILE1=$(echo "$line" | awk '{print $2}')
        REL_PATH_IN_TARGET=${FILE1#$TARGET_DIR/}
        ACTION="merge"
        COLOR=$MAGENTA
    fi
    
    DISPLAY_PATH="docs/ai_guidance/$REL_PATH_IN_TARGET"
    ITEM="$i. $DISPLAY_PATH — [Suggestion: $ACTION]"
    echo -e "  $i. $DISPLAY_PATH — [Suggestion: ${COLOR}${ACTION}${NC}]"
    REPORT="${REPORT}${ITEM}"$'\n'
    ((i++))
done <<< "$DIFF_OUTPUT"

echo -e "${YELLOW}------------------------------------------------${NC}"

# Ask for decision BEFORE calling Gemini
echo -e "How should we proceed? (Apply all suggestions [all] / Select individual options [provide # then <pull|push|merge|skip>] / [quit])"
read -p "> " USER_INPUT

if [ -z "$USER_INPUT" ] || [[ "$USER_INPUT" == "quit" ]] || [[ "$USER_INPUT" == "q" ]]; then
    echo "Aborted."
    exit 0
fi

# Prepare the prompt using a heredoc
PROMPT=$(cat <<EOF
I have performed a deterministic alignment check. 
Target: $TARGET_DIR
Source: $SOURCE_DIR

User Decision: $USER_INPUT

Here is the Analysis Report:
$REPORT

Please execute the requested actions according to the AI Guidance Alignment Protocol.

**IMPORTANT**: Execute ONLY the actions specified in the "User Decision" above. 
- If the decision is "all", execute every suggestion in the report.
- If the decision lists specific numbers (e.g. "1 pull, 3 push"), execute ONLY those items.
- Do NOT act on any items not explicitly selected in the User Decision.

- pull: Copy from Source to Target.
- push: Copy from Target to Source.
- merge: Harmonize contents bidirectionally.
- skip: Do nothing.

**Near-Matches**: If you detect the same file with different casing or separators, standardize on the Source filename and merge the content.

Just execute the plan based on this report.
EOF
)

# Construct gemini command
GEMINI_CMD="gemini --approval-mode yolo"
if [ -n "$GEMINI_MODEL" ]; then
    GEMINI_CMD="$GEMINI_CMD -m \"$GEMINI_MODEL\""
fi

# Invoke Gemini in non-interactive (headless) mode
eval "$GEMINI_CMD -p \"\$PROMPT\""

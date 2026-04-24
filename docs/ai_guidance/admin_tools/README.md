# AI Guidance Admin Tools

This directory contains scripts and configuration for maintaining and syncing the AI Guidance documentation and tools.

## Tools Overview

### 1. Subtree Sync Tools (`guidance:pull` & `guidance:push`)
These tools manage pushing and pulling updates from the remote `ai_guidance` subtree repository. They are Python scripts configured to run natively via `uv run` using a custom shebang.
- **`guidance:pull`**: Pulls updates from the remote subtree repository and uses an AI model (via Claude/OpenRouter) to provide a summary of what changed.
- **`guidance:push`**: Pushes your local subtree changes up to the remote repository.
- **`ai_common.py`**: A shared library containing common utilities, constants, and helper functions used by the push and pull scripts.

### 2. Alignment Protocol (`guidance-align.sh`)
These tools manage syncing project-specific `ai_guidance` documentation to align with the canonical Performant Labs standards.
- **`guidance-align.sh`**: The shell script that performs the alignment protocol checks and operations.
- **`guidance-align.env`**: Environment configuration variables for the alignment tool.
- **`guidance-alignment-protocol.md`**: The protocol specification detailing how alignment works.

## Setting up `.zshrc`

To make the tools accessible from any directory, you should add this `admin_tools` directory to your shell's `PATH`.

Add the following lines to your `~/.zshrc`:

```zsh
# --- AI Guidance Global Tools ---
export PATH="$HOME/Sites/ai_guidance/admin_tools:$PATH"
```

After modifying your `.zshrc`, run `source ~/.zshrc` or restart your terminal to apply the changes. 

You can then run `guidance:pull` and `guidance:push` directly from anywhere in your file system.

*(Note: If you have existing aliases such as `ai:pull` and `ai:push` defined in your `.zshrc`, you can remove them safely in favor of the PATH variable approach above.)*

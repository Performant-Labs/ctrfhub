# Feature handoff — duplicate-issue-detection

## Iteration 1

**Date:** 2026-05-18
**Branch:** `story/duplicate-issue-detection`
**Commits added this iteration:**
- (see commit below) `feat(duplicate-issue-detection): add LLM-free dedupe + stale issue workflows`

### What was built / fixed

- `.github/workflows/dedupe-issues.yml` — on `issues: opened`, extracts ~5 content keywords from the issue title, runs `gh issue list --search`, filters out the just-opened issue, and posts a polite comment listing the top 5 candidates. Silent (no comment) when there are 0 candidates.
- `.github/workflows/stale.yml` — daily `cron '0 8 * * *'` + `workflow_dispatch`, uses `actions/stale@v9` with the brief's proposed issue defaults and a more lenient PR schedule.
- `.github/workflows/sync-labels.yml` — manual `workflow_dispatch` workflow that idempotently creates/updates the `stale` and `pinned` labels.
- `.github/labels.md` — documents the required labels, their colours, and how to create them.
- `docs/issue-management.md` — describes the dedupe bot, the stale lifecycle for issues and PRs, how to exempt an item, and first-time setup.

### Commands run locally (results)

- `npx tsc --noEmit` — 0 errors (unaffected; only YAML/markdown changed).
- YAML parse check (`python3 yaml.safe_load`) — all three new workflows parse OK.
- LLM-reference scan — the only `claude`/`anthropic`/`llm` matches are in descriptive comments stating their *absence* ("LLM-free", "No Claude/Anthropic/LLM API calls"). The `uses:` directives are only `actions/checkout@v4` and `actions/stale@v9` — no LLM/Claude action references.
- No `package.json` script was added (see Decisions) — `package.json` unchanged.

### Files created or modified

- `.github/workflows/dedupe-issues.yml` — duplicate-issue suggestion workflow.
- `.github/workflows/stale.yml` — stale issue/PR sweep via `actions/stale@v9`.
- `.github/workflows/sync-labels.yml` — one-time/on-demand label creation workflow.
- `.github/labels.md` — repository label source-of-truth and creation instructions.
- `docs/issue-management.md` — operator/contributor documentation for the automation.

### Keyword-extraction approach

Implemented in pure shell inside `dedupe-issues.yml` (no Node/Python dependency, no extra action):

1. Normalise the title: lowercase, then `tr -c 'a-z0-9' ' '` to turn all punctuation into spaces.
2. Iterate tokens; drop tokens shorter than 3 characters (low signal) and drop common English stopwords (matched against a space-delimited stopword string for exactness).
3. Keep the first 5 surviving content words; join with spaces as the `--search` query.
4. If no usable keywords remain, exit silently (no search, no comment).

GitHub's own search ranking decides relevance — there is no numeric similarity threshold, consistent with the brief's "GitHub's own ranked candidates" instruction. Candidates are fetched with `--limit 10`, the just-opened issue is filtered out via `jq`, and the top 5 are kept.

### Label-creation decision (scope item 3)

Chose a **dedicated `workflow_dispatch` workflow** (`sync-labels.yml`) over relying solely on a documented manual `gh label create`. Reasoning:

- `actions/stale` does **not** create its label automatically — if `stale` is missing, the action silently fails to apply it. A reliable creation path is important.
- A workflow is self-contained, repeatable, idempotent (`gh label create --force`), and runnable by any maintainer from the Actions UI without local `gh` auth.
- `.github/labels.md` still documents the labels and the equivalent manual `gh` commands as a fallback, so both options the brief offered are covered. The labels file is the source of truth; the workflow is the mechanism.

### PR-staleness decision

The brief left PR handling to the implementer. Decision: **PRs are swept, but on a more lenient schedule** — `days-before-pr-stale: 90`, `days-before-pr-close: 14` (vs. 60/14 for issues), with the same exempt-label set. Reasoning: an open PR usually represents in-flight contributor work and merits more runway than a passive issue report, but a PR that has been untouched for over three months is genuinely abandoned and clutters the queue. Closing is reversible (the close message tells contributors to reopen), so this is low-risk. Documented in `docs/issue-management.md`.

### No-LLM-reference confirmation

- `grep -iE 'claude|anthropic|llm|openai|groq|gpt|sonnet|opus'` across all three new workflows returns only descriptive comments asserting the *absence* of LLMs.
- `grep '^\s*uses:'` shows only `actions/checkout@v4` and `actions/stale@v9` — no `anthropics/claude-code-action` or any LLM-backed action.
- The dedupe engine is `gh issue list --search` (GitHub native search); the stale engine is `actions/stale` (canonical GitHub action). No `ANTHROPIC_API_KEY` or any LLM secret is referenced.

### Decisions not covered by planning docs

- **No `package.json` script added.** The brief offered an optional small script "if helpful for local testing." The dedupe logic is GitHub-event-driven shell embedded in the workflow; a meaningful local-test script would need to mock `GITHUB_EVENT`/`gh` and add maintenance surface for little value. Left out to keep `package.json` untouched, consistent with the "no application code changes" constraint. Adjoins brief Constraints.
- **`sync-labels.yml` is a third new workflow.** The brief named two workflows but explicitly allowed "a separate workflow" for label creation under scope item 3 — this is in scope.
- **Stopword list and 3-char minimum token length** are implementation choices for keyword extraction; the brief said "first ~5 content words is fine" and left specifics open. Adjoins brief scope item 1.
- **`concurrency` groups** added to all three workflows to prevent overlapping runs (good practice; mirrors `sweep.yml` in the evidence doc). Adjoins evidence doc §7.
- **Comment tone** borrows the upstream *structure* (header count, numbered list, "close as duplicate" closer, an automated-suggestion disclaimer) but is freshly worded — no verbatim phrasing from `anthropics/claude-code` is reused, per brief Constraints.

### Findings addressed

N/A — iteration 1 (brief input).

### Known issues / follow-ups

- Keyword search can miss reworded duplicates; the brief's out-of-scope follow-up (local sentence-transformer embeddings) is documented in `docs/issue-management.md` and should be tracked as a separate story.
- Existing workflows (`ci.yml`, `pr-review.yml`, `release.yml`) were not modified — no change to them was required.

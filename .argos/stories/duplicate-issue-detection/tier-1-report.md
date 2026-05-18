# Tier 1 Headless Report — duplicate-issue-detection

**Executed:** 2026-05-18 05:14
**Method:** YAML parse (`python3 yaml.safe_load`), static `grep` scans, and
local shell/`jq` execution of extracted snippets (no browser, no live GitHub run).

## Nature of this story

CI / issue-management infrastructure: three new GitHub Actions workflows
(`dedupe-issues.yml`, `stale.yml`, `sync-labels.yml`) plus two docs files
(`.github/labels.md`, `docs/issue-management.md`). There is **no `src/`
application code** in the diff (`git diff` confirms 6 files: 3 workflows,
2 docs, this story's `feature-handoff.md`). Consequently this story has **no
vitest/Playwright surface** — see "No committed test files" below. Verification
is the static + executable spot-checks recorded here. Precedent for a
verification-only T1 on a CI-infra story: `ctrfhub-docker-build-cache`,
`test-writer-discipline`.

## Checks

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | All three new workflow YAML files are well-formed | `python3 -c 'yaml.safe_load(open(f))'` per file | All parse without error | All 3 parse OK | ✓ |
| 2 | No LLM/Claude action referenced (criterion 5) | `grep -nE '^\s*uses:'` across the 3 workflows | Only non-LLM actions | `actions/checkout@v4`, `actions/stale@v9` only | ✓ |
| 3 | No LLM secret / API key referenced (criterion 5) | `grep -inE 'claude\|anthropic\|llm\|openai\|gpt\|sonnet\|opus\|ANTHROPIC_API_KEY'` | Matches only in descriptive comments | 8 matches, all in comments asserting *absence* ("LLM-free", "No Claude/Anthropic/LLM API calls", "no LLM-generated text") — none in `uses:`/`with:`/`env:`/`secrets.` | ✓ |
| 4 | Keyword extraction — ordinary title | Extracted snippet vs `"Dashboard charts do not render after upload"` | ~5 content words, stopwords dropped | `dashboard charts render upload` (4 words; `do`,`not`,`after`,`the` dropped — `do`/`not`/`after` are stopwords) | ✓ |
| 5 | Keyword extraction — punctuation + stopwords | Extracted snippet vs `"BUG: the /api/ingest endpoint returns a 500 error!!!"` | Punctuation → spaces, stopwords/short tokens dropped, capped at 5 | `bug api ingest endpoint returns` (5 words; `the`,`a` dropped, `500`/`error` past the 5-cap) | ✓ |
| 6 | Keyword extraction — all-stopword title (silent path) | Extracted snippet vs `"is it on or off?"` | Empty keyword string → workflow exits silently (line 104) | `''` (empty) | ✓ |
| 7 | `jq` self-filter removes the just-opened issue | `jq --argjson self 42 '[.[] \| select(.number != $self)] \| .[0:5]'` on a 3-item set containing #42 | #42 removed, 2 candidates remain | `[{17},{99}]`, `length` = 2 | ✓ |
| 8 | `jq` self-filter 0-candidate path (silent path) | Same filter on a set containing only #42 | Empty array → `MATCH_COUNT 0` → no comment (line 132) | `[]`, `length` = 0 | ✓ |
| 9 | Least-privilege permissions — `dedupe-issues.yml` | Read `permissions:` block vs step needs | `issues: write` + `contents: read` | `issues: write`, `contents: read` — exactly matches (comment post + checkout/`gh` context) | ✓ |
| 10 | Least-privilege permissions — `stale.yml` | Read `permissions:` block vs step needs | `issues: write` + `pull-requests: write` + `contents: read` | All three; `pull-requests: write` genuinely needed — workflow sweeps PRs (documented decision) | ✓ |
| 11 | Least-privilege permissions — `sync-labels.yml` | Read `permissions:` block vs step needs | `issues: write` only | `issues: write` only — correct for `gh label create` | ✓ |
| 12 | Existing CI green, unchanged (criterion 4) | `npx tsc --noEmit` + `npm test` | 0 tsc errors; 498 tests pass | tsc 0 errors; **498 tests pass (23 files)** | ✓ |

## Excerpt of raw output

```
=== YAML parse ===
OK: .github/workflows/dedupe-issues.yml
OK: .github/workflows/stale.yml
OK: .github/workflows/sync-labels.yml

=== uses: directives across new workflows ===
.github/workflows/dedupe-issues.yml:50:        uses: actions/checkout@v4
.github/workflows/stale.yml:55:        uses: actions/stale@v9

=== keyword extraction ===
[ordinary]    'Dashboard charts do not render after upload' => 'dashboard charts render upload'
[punct/stop]  'BUG: the /api/ingest endpoint returns a 500 error!!!' => 'bug api ingest endpoint returns'
[no-keywords] 'is it on or off?' => ''

=== jq self-filter (set contains just-opened #42) ===
[ {"number":17,...}, {"number":99,...} ]   MATCH_COUNT=2
=== jq self-filter (set is only #42) ===
FILTERED=[]   MATCH_COUNT=0  -> silent, no comment

=== CI ===
tsc: 0 errors
Test Files  23 passed (23)
     Tests  498 passed (498)
```

## Live-run-only acceptance criteria (not executable locally)

The following acceptance criteria require a live GitHub Actions run and cannot
be exercised from this local environment. They are **not** grounds to BLOCK —
the documented mechanism and its static correctness are verified instead:

- **"New issue opened in a fork → dedupe workflow runs, comment appears with
  0–5 candidates linked."** Observable only on a live run. Statically verified:
  trigger `issues: types: [opened]` (line 28–29), the `gh issue list --search`
  candidate query (line 114–119), the comment-build + `gh issue comment` post
  path (line 146–159). Checks 4–8 confirm the keyword + filter logic that feeds
  this path behaves correctly.
- **"0-candidate path silent (no comment)."** Two early-exit branches verified
  statically and by spot-check: empty keywords (line 104–107, check 6) and
  `MATCH_COUNT -eq 0` (line 132–135, check 8). No `gh issue comment` is reached
  on either branch.
- **"`actions/stale` runs on `workflow_dispatch`; on a fixture-aged issue,
  applies `stale` label and posts comment."** Observable only on a live run.
  Statically verified: `workflow_dispatch` trigger present (line 34),
  `actions/stale@v9` with `stale-issue-label: stale`, `days-before-stale: 60`,
  and a polite `stale-issue-message` — the documented mechanism is correct.
  Note: `actions/stale` does not create its label; `sync-labels.yml` is the
  documented one-time creation path (handoff §"Label-creation decision").

## No committed test files — reasoning

A GitHub Actions workflow is YAML + embedded shell executed by the GitHub
runner on repository events; it has no module surface that vitest can `import`
and no rendered route that Playwright can drive. There is no `src/`
application code in this diff. Authoring a vitest/Playwright file here would
add maintenance surface for no genuine coverage — it would only re-assert what
the static parse + executable spot-checks in this report already establish.
Per the freshly-tuned test-writer rules (PR #74: one test per distinct branch,
no fan-out, no low-value tests), **no committed test files are added** for this
story. The verification spot-checks in checks 4–8 were run ad-hoc and are
recorded here, not committed.

## Verdict

**PASS** — all locally verifiable acceptance criteria confirmed; live-run-only
criteria verified by documented mechanism + static correctness. Proceed to
test-handoff.

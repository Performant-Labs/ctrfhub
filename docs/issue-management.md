# Issue management automation

CTRFHub uses two GitHub Actions workflows to keep issue triage low-effort.
Both are **LLM-free** — they use GitHub's own search and the canonical
`actions/stale` action, so they have **zero recurring cost** and make no
calls to any AI/LLM API.

| Workflow | File | Trigger |
|---|---|---|
| Duplicate-issue detection | `.github/workflows/dedupe-issues.yml` | A new issue is opened |
| Stale issue & PR sweep | `.github/workflows/stale.yml` | Daily at 08:00 UTC + manual run |
| Label sync (setup) | `.github/workflows/sync-labels.yml` | Manual run only |

## Duplicate-issue detection

When someone opens a new issue, the dedupe workflow tries to surface
possibly-related existing issues so maintainers and reporters can spot
duplicates early.

How it works:

1. It extracts up to five **content keywords** from the new issue's title.
   Punctuation is stripped, the text is lowercased, and common English
   stopwords plus very short tokens are removed.
2. It runs a GitHub issue search (`gh issue list --search`) with those
   keywords. GitHub returns its own relevance-ranked results — there is no
   LLM and no similarity threshold to tune.
3. It removes the just-opened issue from the results and keeps the top five.
4. If at least one candidate remains, it posts a single, polite comment on
   the new issue listing those candidates (title, open/closed state, link).
5. If no candidates are found, it does nothing — **no comment is posted**.

The comment is advisory only. It never closes or labels anything; a human
decides whether the issue is actually a duplicate. If one of the suggestions
matches, please close the new issue as a duplicate so discussion stays in
one place.

### Limitation

Keyword matching is intentionally simple. It can miss duplicates phrased
differently (for example "auth bug" vs "authentication failure"). If this
proves noticeably imprecise in practice, the planned follow-up is to score
candidates with local sentence-transformer embeddings inside the runner —
still free, still no external API. That enhancement is tracked separately
and is out of scope for the current automation.

## Stale issue and PR lifecycle

The stale workflow runs once a day (and can be triggered manually from the
Actions UI) using `actions/stale@v9`.

### Issues

| Stage | Window | Action |
|---|---|---|
| Inactive | 60 days with no activity | Labeled `stale`, with an explanatory comment |
| Still inactive | 14 more days after labeling | Closed, with a comment |
| Activity resumes | any comment / update | `stale` label removed, countdown reset |

### Pull requests

Pull requests are swept on a more lenient schedule because an open PR
usually represents in-flight contributor work that deserves more runway:

| Stage | Window | Action |
|---|---|---|
| Inactive | 90 days with no activity | Labeled `stale`, with a comment |
| Still inactive | 14 more days after labeling | Closed, with a comment |
| Activity resumes | any commit / comment | `stale` label removed, countdown reset |

A closed issue or PR can always be reopened, or a fresh issue filed with
up-to-date details — closing is not final.

The sweep is rate-limited to 30 GitHub API operations per run and processes
the least-recently-updated items first, so the oldest backlog is always
addressed even on a large repository.

## Exempting an issue or PR from the stale sweep

Apply any of these labels to keep an item out of the stale sweep
indefinitely — it will never be marked stale or auto-closed:

- `pinned` — general "do not auto-close" marker
- `security` — security-relevant reports
- `help wanted` — open to contributors; should stay discoverable
- `good first issue` — onboarding-friendly issues; should stay open

`pinned` is the catch-all: apply it to any issue or PR that should remain
open regardless of activity.

## First-time setup

`actions/stale` does **not** create its label automatically. Before the
stale workflow can apply the `stale` label, the label must exist.

Run the **Sync Labels** workflow once after this automation is merged:
`Actions → Sync Labels → Run workflow`. It creates the `stale` and `pinned`
labels (and is safe to re-run). The full label list and manual `gh`
commands are in `.github/labels.md`.

# Repository labels

This file is the source of truth for labels the issue-management automation
depends on. The `Sync Labels` workflow (`.github/workflows/sync-labels.yml`)
reads the equivalent list and creates/updates these labels idempotently.

## How to create them

Run the **Sync Labels** workflow from the GitHub Actions UI
(`Actions → Sync Labels → Run workflow`) once after merging the
issue-management story. It is safe to re-run any time this file changes.

Alternatively, create them manually with the `gh` CLI:

```sh
gh label create stale  --color 795548 --description "Inactive for too long; will be auto-closed if activity does not resume" --force
gh label create pinned --color 0e8a16 --description "Exempt from the stale sweep; never auto-closed" --force
```

## Required labels

| Label | Color | Used by | Purpose |
|---|---|---|---|
| `stale` | `#795548` | `stale.yml` (`actions/stale`) | Applied to issues/PRs with no activity for the stale window. Auto-removed when activity resumes; the item is closed if it stays inactive. **`actions/stale` does not create this label automatically — it must exist first.** |
| `pinned` | `#0e8a16` | `stale.yml` (exempt list) | Marks an issue/PR as exempt from the stale sweep. It will never be marked stale or auto-closed. |

## Exempt labels

The stale sweep treats these labels as exemptions (`exempt-issue-labels` /
`exempt-pr-labels` in `stale.yml`). Of these, only `pinned` is created by the
sync workflow; the rest are conventional GitHub labels created on demand:

- `pinned`
- `security`
- `help wanted`
- `good first issue`

Apply any of these to an issue or PR to keep it out of the stale sweep
indefinitely. See `docs/issue-management.md` for details.

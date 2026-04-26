# Feature Handoff — CI-003: Tugboat per-PR preview + dog-food CTRF ingestion

**Branch:** `story/CI-003`
**Commits on this branch since `main`:**
- 7c58562 chore(CI-003): assign
- *(pending)* feat(CI-003): tugboat config, seed script, and ci workflow update

## What was built

- **`.tugboat/config.yml`** — Tugboat preview configuration defining two native services: `db` (Postgres 16 Alpine) and `app` (Node 22 Alpine). Uses init/update/build command stages: `init` installs native build tools + npm deps (cached across rebuilds), `update` compiles TypeScript + Tailwind and starts the app, `build` runs the seed script.
- **`.tugboat/seed.sh`** — Idempotent bash+curl seed script (~130 lines) that creates: 1 admin user (via Better Auth signup API), 1 Organization (direct PG insert), 1 Project with slug `sample` (direct PG insert), 1 API key with `metadata.projectId` set (via Better Auth API key plugin). Uses HTTP status codes and `ON CONFLICT DO NOTHING` for idempotency — safe to re-run on Tugboat "Refresh".
- **`.github/workflows/ci.yml`** — Replaced CI-001's placeholder dog-food step with a real POST to the Tugboat preview's ingest endpoint. Removed `continue-on-error: true` — this step now gates merge. Updated variable names from `CTRFHUB_STAGING_*` to `CTRFHUB_PREVIEW_*`. Updated header comments to reflect CI-003 completion.

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run build` — not run (no app code changes; story is infra-only)
- `npm run dev` — not run (no app code changes)
- No migration scripts exist (INFRA-005 schema-generator)

## Files created or modified

Grouped by directory. One line per file, with a short purpose note.

- `.tugboat/config.yml` — Tugboat service definitions (db + app), build stages, env var references
- `.tugboat/seed.sh` — Idempotent preview seed: admin + org + project + API key
- `.github/workflows/ci.yml` — Dog-food step: real POST to Tugboat preview, gates merge

## Decisions not covered by planning docs

- **Seed mechanism: shell+curl chosen over tsx.** The brief left this to implementer discretion. Shell was chosen because: (a) no TypeScript build step needed in the seed context, (b) simpler dependency footprint — bash + curl + node are all present in the Tugboat container, (c) the seed script is intentionally short-lived (AUTH-002's env-var admin seed will replace it). This adjoins `better-auth-session-and-api-tokens.md` §Setup wizard.

- **Organization and Project created via direct PG inserts (`node -e` + `pg`), not via app API.** The brief allows direct DB writes for CTRFHub-owned tables. Better Auth's signup API is used for the user and API key (those go through the auth layer as required). The org/project inserts use `ON CONFLICT DO NOTHING` for idempotency since neither table has a unique constraint on slug — the seed falls back to a SELECT-then-INSERT pattern for the project to capture its auto-increment ID.

- **Tugboat services defined as native Tugboat services, not via `docker compose` inside a service.** The brief mentions "`docker compose up`" but Tugboat's architecture natively manages multi-service stacks — running `docker compose` inside a Tugboat service would create container-in-container complexity. The `db` and `app` services in `.tugboat/config.yml` map 1:1 to the `db` and `app` services in `compose.yml`.

- **Preview URL and API key not automatically exported to GitHub Actions.** Tugboat previews run as Docker services with no built-in mechanism to push env vars back to GitHub Actions. The plan assumes André will manually set `vars.CTRFHUB_PREVIEW_URL` and `secrets.CTRFHUB_PREVIEW_API_KEY` in GitHub repo settings after the first successful preview build. The dog-food step is safely guarded by `if: vars.CTRFHUB_PREVIEW_URL != ''`.

- **Hardcoded Postgres credentials in `.tugboat/config.yml`** (`ctrfhub:ctrfhub`) are acceptable here — these are ephemeral preview databases, not real secrets. The admin email/password and auth secrets are injected via Tugboat's Repository Settings env vars.

## Known issues / follow-ups

- **API key extraction from response:** The seed script extracts the API key from Better Auth's JSON response using `node -e`. If Better Auth's response shape changes (e.g., field name `key` vs `apiKey`), the extraction may need updating. The script handles both field names.
- **Project slug uniqueness:** The `projects` table does not have a unique index on `slug`. The seed uses SELECT-before-INSERT for idempotency instead of `ON CONFLICT`. If a future story adds a unique constraint on `slug`, the seed can be simplified to use `ON CONFLICT DO NOTHING`.
- **Free-tier Tugboat limits:** Free tier may cap concurrent previews at 1. If a PR opens while another is being reviewed, Tugboat may refuse the second preview. This is a paid-tier upgrade decision, not an engineering problem.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/CI-003` (already on it if continuing locally).
3. Start with T1 Headless. Routes to focus on:
   - `curl -sf <preview-url>/health` returns `{ "status": "ok", "bootState": "ready" }`
   - `curl -X POST -H "x-api-token: <seeded>" -d @<ctrf>.json <preview-url>/api/v1/projects/sample/runs` returns `201 { "runId": <int> }`
4. No new test files needed — the Tugboat preview build + CI dog-food step ARE the verification.
5. Tier-report templates are in `.antigravity/agents/test-writer.md`.

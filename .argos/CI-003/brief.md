# Task Brief — CI-003 (phased): Tugboat per-PR preview + API-token dog-food CTRF ingestion

> **Phased scope.** Full CI-003 acceptance per the original `tasks.md` entry assumes UI exists (login UI to verify the seeded admin, run-list UI to verify the ingested report renders). Neither is on main yet — they're blocked behind INFRA-003 → AUTH-002 / AUTH-003 / DASH-002, which is blocked on G-P0-001 + G-P0-002 (still Open). Rather than wait for the full UI stack, this story ships **Phase 1** of CI-003: the deployment plumbing + API-token ingest. Login + dashboard verification get folded into AUTH-003 / DASH-002's own E2E coverage when those stories land. `tasks.md §CI-003` is updated to reflect the phased scope; the deferred verify bullets are documented but moved out of this story's acceptance.

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: AUTH-001 ✅ (Better Auth + apikey plugin shipped), CI-001 ✅ (CI workflow + Dockerfile + GHCR release shipped), CI-002 ✅ (`compose.yml` shipped), INFRA-005 ✅ (schema-generator at boot — Tugboat doesn't need a separate migration step).
- [x] No P0 gap blocks **this phased scope.** The original CI-003 acceptance had implicit deps on AUTH-002 / AUTH-003 / DASH-002 (all transitively blocked on G-P0-001 + G-P0-002); rewriting the acceptance to phased scope removes those deps from this story.
- [x] Branch cut: `story/CI-003` from `main` @ 5f1066e (post-#30 merge — main has the e2e fix + INFRA-005's schema-generator pivot already).
- [x] `tasks.md §CI-003` acceptance reworded to phased scope on the story branch (commit `chore(CI-003): assign`, brief committed alongside per the PR #17 convention).
- [x] **Parallel-story constraints.** AI-001 is in flight on `story/AI-001`. **Zero file overlap** — AI-001 lives in `src/services/ai/` and `src/__tests__/`. CI-003 lives in `.tugboat/`, `.github/workflows/ci.yml` (additive — drops the placeholder dog-food step in favor of a real one), `docs/planning/tasks.md`. The only theoretical overlap is `package.json` if either implementer adds new deps; coordinate via André.
- [x] **Tugboat credentials** (free-tier account + API token) are provisioned and documented in Argos's memory (saved 2026-04-24). André will paste them via Tugboat env-vars at preview-build time; implementer never needs to see the token directly.

## Story

**Description.** Wire CTRFHub up to Tugboat so every PR opens a per-PR preview deployment. Tugboat builds the preview via `docker compose up` (using the existing `compose.yml` from CI-002), the app boots, schema-generator (INFRA-005) creates the DB schema, a seed script creates an admin user + organization + project + API key, and the CI E2E job POSTs a real CTRF report into the preview's ingest endpoint using the seeded token. The dog-food loop closes on the change actually being reviewed.

**Acceptance criteria (phased — replaces the original `tasks.md §CI-003` acceptance):**

- `.tugboat/config.yml` at repo root defines two services: `app` (built from `Dockerfile` per CI-001) and `db` (Postgres). Build steps: `app` waits on `db`, runs `npm ci --omit=dev`, starts via `node dist/index.js`, then runs the seed script.
- Per-PR preview reachable at `pr-N.<tugboat-subdomain>.tugboatqa.com` (Tugboat default URL pattern; subdomain is supplied by Tugboat).
- App boots cleanly: schema-generator creates all CTRFHub-owned tables (per INFRA-005); Better Auth creates its own tables on first signup; `/health` returns 200 within 60s of build completion.
- Seed script (`.tugboat/seed.sh` or `.tugboat/seed.ts`) creates: 1 admin user via Better Auth's email signup, 1 `Organization` row, 1 `Project` row, 1 API key (Better Auth `apikey` row) with `metadata.projectId` pointing at the seeded project. Implementer chooses shell+curl or tsx — whichever is cleaner. Document the choice in feature-handoff.
- Seed script outputs the API key to a Tugboat-accessible env var (`CTRFHUB_PREVIEW_API_KEY`) and the preview URL to `CTRFHUB_PREVIEW_URL`. Implementer documents the exact env-var-export mechanism Tugboat supports.
- `.github/workflows/ci.yml` E2E dog-food step: reads `CTRFHUB_PREVIEW_URL` + `CTRFHUB_PREVIEW_API_KEY` from Tugboat, POSTs a real CTRF report to `${CTRFHUB_PREVIEW_URL}/api/v1/projects/sample/runs` with `x-api-token: ${CTRFHUB_PREVIEW_API_KEY}`. Replaces the placeholder dry-run from CI-001's feature-handoff.
- Ingest returns `201 { runId }`; the existing `continue-on-error: true` on the dog-food step (left there by CI-001 as a placeholder) is removed — this step is now real and gates merge.
- The first PR opened after this story merges produces a working preview. Verify on the PR that opens this story (or the next PR, whichever lands first).
- `tasks.md §CI-003` acceptance + critical-paths reworded to match this phased scope. Original UI-verify bullets noted as deferred to AUTH-003 / DASH-002.

**Test tiers required.** Integration — CI itself produces a green preview build (the workflow's E2E dog-food step succeeds). No new unit / integration / E2E *test* files in this story; the dog-food step + the live Tugboat preview are the verification.

**Page verification tiers.** T1 Headless only:
- `curl -sf https://pr-N.<subdomain>.tugboatqa.com/health` returns `{ "status": "ok", "bootState": "ready" }`.
- `curl -X POST -H "x-api-token: <seeded>" -d @<ctrf>.json https://pr-N.<subdomain>.tugboatqa.com/api/v1/projects/sample/runs` returns `201 { "runId": <int> }`.

T2 / T2.5 / T3 deferred to AUTH-003 / DASH-002 (the UI stories that need them).

**Critical test paths.**

- Tugboat builds the preview from `compose.yml` end-to-end without manual intervention.
- Schema-generator creates correct PG tables in topological FK order on the preview's PG.
- Seed script idempotent enough to survive Tugboat's "Refresh" on the same preview (don't crash if admin / org / project / api-key already exist).
- E2E dog-food POST succeeds against the live preview, returns `201 { runId }`.
- Tugboat preview teardown is automatic (Tugboat's own preview-lifecycle policy — implementer doesn't need to wire teardown explicitly).

## Required reading

**Skills (full paths — read before any code).**

- `skills/better-auth-session-and-api-tokens.md` — primary skill. Defines the `apikey` plugin's create/verify surface, how `metadata.projectId` is read by ingest, and the email-signup admin flow. Your seed script will drive these endpoints.
- `skills/mikroorm-dual-dialect.md` — Tugboat uses PG; verify the `Organization` / `Project` entities' MikroORM definitions write correctly via `em.persistAndFlush()` from the seed script.
- `skills/ctrf-ingest-validation.md` — the ingest endpoint contract (`POST /api/v1/projects/:slug/runs` with `x-api-token`, accepts `application/json` and `multipart/form-data`, returns `201 { runId }`).
- `skills/page-verification-hierarchy.md` §T1 — the `curl -sf` health-check pattern for the preview URL.

**Planning doc sections.**

- `docs/planning/architecture.md §Sending test reports to CTRFHub from CI` (line 519) — canonical curl example for `x-api-token` auth + the response shape.
- `docs/planning/architecture.md §Production Deployment` — `compose.yml` shape, GHCR image path, env-var contract.
- `docs/planning/architecture.md §Database schema management` (post-INFRA-005 rename) — schema-generator at boot; no migrate step needed in Tugboat build.
- `docs/planning/database-design.md §4.20` (the deprecated `project_tokens` section) — note the DEPRECATED banner; per-token policy lives in `apikey.metadata` per G-P1-008's resolution.
- `docs/planning/testing-strategy.md §Dog-food reporter config` — the dog-food rule that this story closes the loop on.
- `docs/planning/tasks.md §CI-003` — original acceptance (which you'll be rewriting to phased scope as part of this story).

**External — required.**

- Tugboat config docs: https://docs.tugboatqa.com/setting-up-tugboat/configuring-tugboat/configuration-options/ — `.tugboat/config.yml` schema, build-step sequencing, env-var injection patterns. Tugboat is well-documented; lean on the canonical reference.
- Better Auth API key plugin docs (linked from the better-auth-session-and-api-tokens.md skill).

## Files in scope

- `.tugboat/config.yml` (new) — service definitions + build steps.
- `.tugboat/seed.sh` OR `.tugboat/seed.ts` (new) — admin / org / project / API-key seed. Implementer's choice of shell+curl vs tsx. ~30-80 lines either way.
- `.github/workflows/ci.yml` — replace the placeholder dog-food step with a real POST to the Tugboat preview. Drop the `continue-on-error: true` on that step (it becomes real).
- `docs/planning/tasks.md §CI-003` — acceptance + critical-paths reworded to phased scope. Add a "Deferred to UI stories" note pointing AUTH-003 + DASH-002.
- (Optional) `.env.example` — document `CTRFHUB_PREVIEW_URL` and `CTRFHUB_PREVIEW_API_KEY` if they're meaningful for local dev too. Probably not — these are Tugboat-injected only.
- **Out of scope:** any UI work, any DB schema change, any new entity, any migration (we don't have those anymore — schema-generator).

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Hardcoded credentials in `.tugboat/config.yml` (admin email/password, API tokens). Use Tugboat env vars (`TUGBOAT_ADMIN_EMAIL`, `TUGBOAT_ADMIN_PASSWORD`, etc.). The TUGBOAT_API_TOKEN itself is André's; never echo or print it.
- A separate "run migrations" step in the Tugboat build. INFRA-005 removed migrations; schema-generator runs at app boot. The build step should just be `docker compose up` and wait for `/health`.
- Direct DB writes for the seed when Better Auth's API would do (signup admin via `POST /api/auth/sign-up/email`, not via raw SQL). Direct DB writes are acceptable for `Organization` / `Project` (those are CTRFHub-owned) but the user + apikey rows go through Better Auth.
- Seeding multiple admins / orgs / projects. One of each. Keep the preview minimal.
- Adding a `.tugboat/teardown.sh`. Tugboat's preview lifecycle policy handles teardown automatically; explicit teardown scripts are out of scope per the original `tasks.md §CI-003` notes.
- Skipping `continue-on-error` removal. The whole point of phased CI-003 is that the dog-food step is now *real*; if you leave the soft-fail in, the gate doesn't gate.
- Including PR-specific data in the preview (e.g., seeding the PR title into a project). Keep the preview generic — every PR builds the same preview shape.
- Adding admin-via-UI verification to this story. That's AUTH-003's territory.

## Next action (Feature-implementer)

1. Open a fresh AntiGravity session. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief (`.argos/CI-003/brief.md`) as the second.
2. `git checkout story/CI-003 && git pull origin story/CI-003`.
3. Read the four skills, the cited planning sections, and the Tugboat config docs (linked above). Tugboat-side mechanics are the unfamiliar surface — read those docs first.
4. **Set up the Tugboat side once** (one-time per repo, not per PR): André will provide the Tugboat API token + tell Tugboat which GitHub repo to watch. The implementer doesn't directly drive Tugboat's web UI — André does that one-time setup, then the implementer's `.tugboat/config.yml` does everything else.
5. Implement in this order:
   - **`.tugboat/config.yml`** — services + build steps. Iterate on a draft PR until Tugboat's build passes.
   - **`.tugboat/seed.sh` or `seed.ts`** — admin / org / project / API key. Idempotent. Test by running it against a local `docker compose up` first.
   - **`.github/workflows/ci.yml`** — replace placeholder dog-food step with real POST. Verify against the live preview.
   - **`tasks.md §CI-003`** — reword acceptance to phased scope. Document deferred UI-verify in a "Deferred to AUTH-003 / DASH-002" note.
6. Smoke-check after each phase:
   - `docker compose -f compose.yml up` locally — proves the compose stack is what Tugboat will run.
   - `bash .tugboat/seed.sh` against the local stack — proves the seed works.
   - Open a draft PR; verify Tugboat builds the preview; `curl -sf <preview-url>/health` returns 200.
7. Commit with `feat(CI-003): …`, `fix(CI-003): …`, `chore(CI-003): …` (the last is reserved for Argos status flips, but `chore(CI-003): tugboat-config-iteration-N` is fine while you're iterating on the YAML).
8. Write the feature-handoff to `.argos/CI-003/feature-handoff.md`. Be specific about: the seed mechanism you chose (shell+curl vs tsx) and why, any Tugboat config quirks (build-step ordering, env-var injection paths), the preview URL pattern Tugboat actually uses for this repo (verify Tugboat's default subdomain pattern).
9. Hand back to André so he can open the Test-writer step (T1 verification + spec-audit).

## Notes from Argos

- **The Tugboat token is in Argos's memory** (saved 2026-04-24 with explicit consent). André will paste it into Tugboat's web UI when setting up the repo integration; implementer never sees the raw token.
- **Path forward when UI lands:** AUTH-003 (login UI) and DASH-002 (run list) will add their own E2E specs against the Tugboat preview. Their stories' E2E coverage replaces the deferred CI-003 verify bullets. CI-003's seed script may be deprecated when AUTH-002's env-var admin seed (`CTRFHUB_INITIAL_ADMIN_*`) ships — at that point Tugboat just sets the env vars and AUTH-002 does the seeding on first boot. That transition is itself a tiny follow-up story (call it CI-003b if you want), not in scope here.
- **Seed-script maintenance.** Whatever shape you ship for the seed, keep it tight (~50 lines). When AUTH-002's env-seed lands, this script gets deleted in favor of the env-var path. Avoid premature abstraction.
- **The brief itself is on the story branch** (per PR #17 convention).
- **Free-tier Tugboat constraints:** the free tier likely caps concurrent previews at 1 or a small number. If a PR opens while another is being reviewed, Tugboat may refuse the second preview. Document if you hit this; don't try to engineer around it (that's a paid-tier upgrade decision, not an MVP problem).

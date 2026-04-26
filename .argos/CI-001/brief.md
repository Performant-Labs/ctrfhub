# Task Brief — CI-001: GitHub Actions CI pipeline

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: INFRA-001 ✅ (npm scripts, tsconfig, lint config all in place).
- [x] No P0 gap blocks this story. CI-001 doesn't touch UI templates (no G-P0-001/002 reach), settings tables (no G-P0-003), or the AI pipeline (G-P0-004 closed).
- [x] Branch cut: `story/CI-001` from `main` @ aa227de (CI-002 merge commit).
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(CI-001): assign`, brief committed alongside per the PR #17 convention).
- [x] **Parallel story:** CTRF-002 is being implemented in another workspace at the same time. **Zero file overlap** — CTRF-002 lives in `src/modules/ingest/`, `src/services/event-bus.ts`, `src/__tests__/integration/`, and `src/app.ts`. The only theoretical overlap is `package.json` (lint scripts on this side); coordinate via André if either of you needs to add a script.

## Story

**Description.** Set up the GitHub Actions pipeline that gates every PR (lint → unit → integration → E2E) and the release pipeline that publishes the production image to GHCR on tag push. Also build the production `Dockerfile` (multi-stage `builder` → `runner`) — CI-002 explicitly deferred this to here. The image this story publishes is what `compose.yml` (CI-002) pulls; CI-003 (Tugboat per-PR previews) builds on top of both.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §CI-001, broken into bullets)

- `.github/workflows/ci.yml` with: `unit` job → `integration` job (sequential) → `e2e` job (`needs: integration`).
- E2E job ingests its own CTRF report into a staging CTRFHub instance — the dog-food rule (Tugboat per-PR full version lands in CI-003; the minimal staging-ingest belongs here).
- Multi-stage Docker build: `builder` (compiles TypeScript, builds CSS) → `runner` (Node 22 LTS Alpine, runtime-only).
- `lint` job runs `tsc --noEmit` + `eslint`. (Non-blocking is fine if you want — but it must run on every PR.)
- `release` job triggered on git tag push; pushes a multi-arch image (`linux/amd64,linux/arm64`) to `ghcr.io/ctrfhub/ctrfhub`.

**Test tiers required.** None (meta — the workflow orchestrates tiers, it doesn't add new ones). However, the implementer should manually verify:

- `act` (or just opening a PR against this branch) — `unit`, `integration`, `e2e`, `lint` jobs all green on a sample push.
- `docker build -f Dockerfile .` succeeds locally and produces a runnable image (`docker run --rm <image> node --version` returns 22.x).
- A dry-run `release` job (manually triggered with `workflow_dispatch`, on a throwaway tag) successfully pushes to `ghcr.io/ctrfhub/ctrfhub`. Use a `:ci-001-smoke` tag and delete afterwards.

**Page verification tiers.** None (no rendered routes touched).

**Critical test paths.** (verbatim from `tasks.md`, broken out)

- `unit` → `integration` → `e2e` jobs run sequentially.
- E2E job ingests its own CTRF report to staging CTRFHub (dog-food rule).
- Docker multi-stage build (`builder` → `runner`).
- `lint` job runs `tsc --noEmit` + ESLint.
- `release` job on tag pushes multi-arch image to `ghcr.io/ctrfhub/ctrfhub`.

## Required reading

**Skills (full paths — read before any code).** No skills are mandatory per `tasks.md`, but two are useful for context:

- `skills/page-verification-hierarchy.md` (optional) — explains the T1 → T2/T2.5 → T3 layers your CI orchestrates. Helpful for understanding what `unit` vs `integration` vs `e2e` should actually run.
- `skills/vitest-three-layer-testing.md` (optional) — shows the unit/integration/E2E split and the `MemoryEventBus`/`MemoryArtifactStorage` injection contract. Your `integration` job must hit a real DB (no mocks), so the workflow needs Postgres available either as a service container or via the matrix.

**Planning doc sections.**

- `docs/planning/architecture.md §CI / CD` (line 506) — the canonical recommended-pipeline section.
- `docs/planning/architecture.md §Sending test reports to CTRFHub from CI` (line 519) — the dog-food curl pattern and `x-api-token` header used by the E2E job's ingest step.
- `docs/planning/architecture.md §Production Deployment` (line 207) and `§Image build` (line 235) — multi-stage Dockerfile contract, `node:22-alpine` base, what runs in `builder` vs `runner`.
- `docs/planning/architecture.md §Environment variables` (line 253) — runtime envs the image must respect (already documented in CI-002's `.env.example`; nothing for you to add unless a CI-only var emerges).
- `docs/planning/deployment-architecture.md §Services` (line 36) — `api` service runtime expectations (Node 22 LTS, Alpine, exposes `/health`).
- `docs/planning/testing-strategy.md §Layer 3 — E2E Tests (Playwright)` (line 246) and `§Dog-food reporter config` (line 297) — how the E2E job collects its own CTRF and posts it back.
- `docs/planning/tasks.md §CI-001` (line 318) — canonical acceptance source.
- `docs/planning/tasks.md §CI-002` (line 329) — sister story (just merged); `compose.yml` references the GHCR path you're publishing to. Sanity-check the registry name matches.
- `docs/planning/tasks.md §CI-003` (line 340) — downstream story (Tugboat per-PR previews). Don't pre-implement CI-003's Tugboat config here; the staging-ingest in your E2E job is just enough to satisfy the dog-food acceptance bullet.

**Org-wide context (optional deep-dive).** `~/Sites/ai_guidance` (cloned per `DEVELOPER_SETUP.md`) holds Performant Labs's CI patterns. Not required to do the work — `architecture.md §CI / CD` inlines what you need.

## Files in scope

- `.github/workflows/ci.yml` — main per-PR pipeline (lint, unit, integration, E2E).
- `.github/workflows/release.yml` — separate workflow on tag push (multi-arch GHCR publish). Splitting per-PR vs release into two files is conventional and easier to read; one file with conditional jobs is acceptable if you prefer.
- `Dockerfile` — production multi-stage. **CI-002 explicitly left this for you** ("CI-001 owns the prod Dockerfile"). Should be `node:22-alpine` for both stages, build CSS as part of `builder`, copy only `dist/` + `package.json` + `package-lock.json` + `node_modules` (or use `npm ci --omit=dev`) into `runner`.
- `.dockerignore` — keep the image small; exclude `node_modules`, `coverage`, `.git`, `e2e/`, `src/__tests__/`, `docs/`, `.argos/`, `.claude-bridge/`.
- `package.json` — add a `lint` script if not present (`tsc --noEmit && eslint .`). **Coordinate with the CTRF-002 implementer if both of you need to edit `package.json`** — only theoretical overlap point.
- `.github/dependabot.yml` (optional) — if you want to keep workflow actions and Docker base images patched. Nice-to-have, not required.
- `e2e/dog-food.config.ts` (or similar — name your call) — the CTRF reporter config that emits a report from the Playwright run, plus a small post-step in the workflow that POSTs it to a staging CTRFHub URL. The full Tugboat plumbing is CI-003.

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Touching `Dockerfile.dev` here. CI-002 owns the dev image — leave it alone unless you find an honest bug; if you do, surface it in the feature-handoff and let Argos decide.
- Mixing release publishing into the per-PR workflow. The `release` job runs on tag push (`on: push: tags: ['v*.*.*']`); per-PR runs on `pull_request` and `push` to `main`. Don't conflate.
- Self-hosted runners. There's a past purge (`cleanup/strip-self-hosted-runner-vestige`) — stay on GitHub-hosted runners (`ubuntu-latest` or pinned `ubuntu-24.04`).
- Hardcoded credentials. `secrets.GITHUB_TOKEN` for the GHCR push (the default `GITHUB_TOKEN` already has `packages: write` if the workflow declares it). For any third-party tokens (e.g., a staging-CTRFHub `x-api-token` for the dog-food ingest), use a repo secret like `STAGING_CTRFHUB_TOKEN` and reference `${{ secrets.STAGING_CTRFHUB_TOKEN }}`.
- Floating tags on base images. Pin to `node:22.X.Y-alpineX.Y` (or a digest); `node:22-alpine` is acceptable but a pinned digest is better for reproducibility — your call.
- Skipping the `e2e: needs: integration` ordering. `integration` must complete before `e2e` runs; the spec calls this out explicitly.
- `npm install` in CI. Use `npm ci` for deterministic, lockfile-respecting installs.
- Caching that includes node_modules across major Node versions without keying on `package-lock.json` hash + Node version. `actions/setup-node@v4` with `cache: 'npm'` handles this correctly — use it.
- Building without a `tsc --noEmit` gate. The `lint` job must catch type errors before integration tests waste time.

## Next action (Feature-implementer)

1. Open a fresh AntiGravity session. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief (`.argos/CI-001/brief.md`) as the second.
2. `git checkout story/CI-001 && git pull origin story/CI-001` (already cut and pushed by Argos with the brief committed).
3. Read the planning sections above. `architecture.md §CI / CD` and `§Image build` are the most important — most of the workflow shape is described there.
4. Implement in this order (each step independently testable):
   - **`Dockerfile`** first — easiest to validate locally with `docker build`. Get the multi-stage right; this image is what the rest of the pipeline produces and what `compose.yml` consumes.
   - **`.dockerignore`** — write while the Dockerfile is fresh in mind.
   - **`.github/workflows/ci.yml`** — `lint` (parallel-safe), `unit` (depends on lint? your call), `integration` (depends on unit), `e2e` (depends on integration). Postgres as a service container in `integration` and `e2e` jobs.
   - **Dog-food ingest step in `e2e`** — a small `curl` step at the end that POSTs the Playwright CTRF report to a staging CTRFHub. Use a repo-secret-driven URL + token. Soft-fail this step (`continue-on-error: true`) for the first cut so a staging outage doesn't red-light the PR — flag in feature-handoff for Argos to harden later or punt fully to CI-003.
   - **`.github/workflows/release.yml`** — multi-arch GHCR publish on tag push. Manually `workflow_dispatch`-trigger once with a throwaway `:ci-001-smoke` tag to verify; delete the tag/image after.
5. Manual smoke checks after each phase:
   - `docker build -f Dockerfile .` succeeds; `docker run --rm <image> node -v` returns 22.x.
   - Open a draft PR off `story/CI-001` and watch the workflows actually execute. Iterate on real CI output.
6. Commit with `feat(CI-001): …`, `fix(CI-001): …`, `refactor(CI-001): …`. `chore(CI-001): …` is reserved for Argos status flips.
7. Write the feature-handoff to `.argos/CI-001/feature-handoff.md`. Be specific about: the staging-ingest URL/secret arrangement (so Argos can scope CI-003 cleanly), any base-image pinning policy you adopted, whether you split per-PR and release into two files or one, and any choice (image cache strategy, matrix shape, runtime arch) not directly pinned by the spec.
8. Hand back to André so he can open the spec-audit step.

## Notes from Argos

- **The GHCR image doesn't exist yet** — CI-002 already merged with `compose.yml` referencing `ghcr.io/ctrfhub/ctrfhub:${CTRFHUB_TAG:-latest}`. Your `release` job is what makes that path real. The first `vX.Y.Z` tag pushed after CI-001 merges produces a runnable image, after which `compose.yml` works end-to-end.
- **The dog-food rule scope here.** CI-001's acceptance bullet says "ingest E2E CTRF report to staging CTRFHub". CI-003 (later) builds the per-PR Tugboat preview and ingests against THAT preview. For CI-001, "staging" can be: (a) a long-lived staging deployment if you have one, (b) `continue-on-error: true` against a placeholder URL if not, or (c) a dry-run that emits the CTRF artifact to GitHub Actions artifact storage but doesn't actually POST anywhere. Pick (b) or (c) for the first cut — flag the choice in feature-handoff and Argos will harden in CI-003.
- **Don't ship Tugboat config.** `.tugboat/config.yml` belongs to CI-003. If your dog-food step is tempted to inline Tugboat-specific URL templating, stop and let CI-003 do it.
- **The brief itself is on the story branch** (per PR #17 convention).
- **Repo permissions check.** GHCR publishing needs `packages: write` on the workflow's `permissions:` block. Make sure that's declared at the workflow or job level — not at the repo settings level (settings can change; declared permissions are reproducible).

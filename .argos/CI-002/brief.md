# Task Brief — CI-002: Docker Compose files (dev + prod + SQLite)

## Preconditions (verified by Argos)

- [x] Dependencies satisfied: INFRA-002 (`buildApp()` factory + `/health` route + the AppOptions DI seam) is merged. The compose stack will build from / talk to this app.
- [x] No P0 gap blocks this story.
- [x] Branch cut: `story/CI-002` from `main`
- [x] `tasks.md` flipped `[ ]` → `[/]` on the story branch (commit `chore(CI-002): assign`)
- [x] **Parallel story:** AUTH-001 (Better Auth integration) is being implemented in another workspace at the same time. **Zero file overlap** — AUTH-001 lives in `src/auth.ts`, `src/app.ts`, `src/modules/auth/`; you're entirely in repo-root config files (`compose.*.yml`, `.env.example`, optionally a dev `Dockerfile`). Both PRs can land in either order without rebase conflicts.

## Story

**Description.** Define the Docker Compose stack CTRFHub runs in. Three compose files for three deployment modes:

- `compose.dev.yml` — local development. `tsx watch` reloads the app on source changes, Tailwind runs `--watch` on the CSS, Postgres runs as a sidecar. Volume-mount the repo so edits are immediate.
- `compose.yml` — production-like. Pulls a published image from `ghcr.io/ctrfhub/ctrfhub` (CI-001 will publish to this; **the image doesn't exist yet, that's fine — file the structure now**). Postgres runs alongside with a named volume for persistence. `stop_grace_period: 30s` to give Fastify graceful-shutdown room.
- `compose.sqlite.yml` — single-container self-host. Same image as prod, but with `DATABASE_URL` pointing at a SQLite file mounted from a named volume. No Postgres service. This is the "self-host on a tiny VPS" deployment.

Plus `.env.example` with every environment variable named in `docs/planning/architecture.md §Environment variables`, with safe placeholder values and inline comments explaining what each one does.

This is **infrastructure-only** work. No source code, no tests, no migrations. The product of this story is YAML files that pre-exist any actual Tugboat or production usage.

**Acceptance criteria.** (verbatim from `docs/planning/tasks.md` §CI-002, broken into bullets)

- `compose.dev.yml` — app service running with `tsx watch` + Tailwind `--watch`, Postgres as a sidecar service.
- `compose.yml` — production-like. App service uses `image: ghcr.io/ctrfhub/ctrfhub:<tag>` (the registry path CI-001 will publish to). Postgres has a named volume. `stop_grace_period: 30s` on the app service.
- `compose.sqlite.yml` — single container (just the app, no Postgres service). SQLite file in a named volume.
- `.env.example` — every env var named in `architecture.md §Environment variables`, with placeholder values and one-line comments.
- `healthcheck` in compose definitions hits `/health` (INFRA-002's `GET /health` returns 200 when ready, 503 during boot).

**Test tiers required.** None (meta — configuration only). However, the implementer should manually verify:

- `docker compose -f compose.dev.yml up` starts the dev stack without error
- `docker compose -f compose.sqlite.yml up` starts the single-container SQLite mode without error (the app should boot, run migrations against `:memory:` or a mounted SQLite file, and serve `/health`)
- `compose.yml` is syntactically valid (`docker compose -f compose.yml config` exits 0) — actually running it requires the `ghcr.io` image which doesn't exist yet

**Page verification tiers.** None (no rendered routes touched by this story).

**Critical test paths.** (verbatim from tasks.md, broken out)

- `compose.dev.yml` runs with `tsx watch` + Tailwind `--watch` + Postgres
- `compose.yml` runs prod with `ghcr.io` image + Postgres volume + `stop_grace_period: 30s`
- `compose.sqlite.yml` single-container with SQLite
- `.env.example` covers every env var named in `architecture.md §Environment variables`
- compose `healthcheck` hits `/health`

## Required reading

**Skills (full paths — read before any code).**

- `skills/mikroorm-dual-dialect.md` — explains the `DATABASE_URL` env-var contract that selects between Postgres and SQLite at runtime. Your compose files set `DATABASE_URL` differently per file (`postgresql://...` for `compose.dev.yml` and `compose.yml`; SQLite path for `compose.sqlite.yml`). The skill confirms that's all that's needed for dialect switching.
- `skills/page-verification-hierarchy.md` §T1 — only relevant section is the `/health` contract that the compose `healthcheck:` directive hits. Confirm the curl form works (returns 200 when ready, 503 during boot).

**Planning doc sections.**

- `docs/planning/architecture.md` §Backend — the Fastify + MikroORM + Better Auth stack you're packaging
- `docs/planning/architecture.md` §Environment variables — **the canonical list of env vars `.env.example` must mirror.** Include every one named there, even if not yet used by code. Inline comments should match what the section says about each var.
- `docs/planning/architecture.md` §Health endpoint — for the `healthcheck:` directive's curl pattern
- `docs/planning/architecture.md` §Graceful shutdown — explains why `stop_grace_period: 30s` (Fastify's SIGTERM handler closes DB → event bus → server in sequence; needs ~10-20s safely, 30s is the conservative ceiling)
- `docs/planning/tasks.md` §CI-002 — the canonical acceptance criteria source
- `docs/planning/deployment.md` (if present) — any deployment-mode-specific notes for self-hosting vs production

**Org-wide context (optional deep-dive).** Each cited skill has a `source:` frontmatter line pointing at Performant Labs's org-wide standards under `docs/ai_guidance/`. The symlink resolves on workspaces with `~/Sites/ai_guidance` cloned (see `DEVELOPER_SETUP.md` "AntiGravity workspace readiness check"). Skills inline the relevant rules — following the source is for broader context or rule verification, not required to do the work.

## Files in scope

- `compose.dev.yml` — new (root-level)
- `compose.yml` — new (root-level)
- `compose.sqlite.yml` — new (root-level)
- `.env.example` — new (root-level; commit this since it's the template)
- (Optional, if needed for `compose.dev.yml`) `Dockerfile.dev` — only if the dev mode is easier to model with a small dev image than mounting source and running `tsx watch` on a node base image. **CI-001 owns the prod `Dockerfile`** — don't touch that one (it doesn't exist yet anyway). If you create `Dockerfile.dev`, keep it as minimal as possible.

## Anti-patterns (will fail spec-enforcer review — see `CLAUDE.md` "Forbidden patterns")

- Hardcoded secrets / API keys / passwords in any compose file or `.env.example`. Use `${VAR_NAME}` placeholders, document what they should be in inline comments.
- Postgres-only assumptions in `compose.sqlite.yml` (e.g., `pg_isready` healthcheck, Postgres-flavored connection strings). The whole point of `compose.sqlite.yml` is single-container with NO Postgres dependency.
- Mixing dev-only and prod-only settings in the same file (e.g., putting `tsx watch` in `compose.yml`, or `image: ghcr.io/...` in `compose.dev.yml`).
- Skipping the `healthcheck:` directive — it's required per acceptance criteria.
- Adding a `Dockerfile` (root-level prod) in this story. That's CI-001's territory. If you need an image to test `compose.dev.yml`, use `Dockerfile.dev` or mount source onto `node:22-alpine`.
- Touching any `src/` files. This is pure infrastructure config.
- Setting `restart: always` on the app service (production restart policy is a deployer choice, not a project choice — leave it absent so deployers configure it for their environment).

## Next action (Feature-implementer)

1. Open a fresh AntiGravity session in your workspace. Paste `.antigravity/agents/feature-implementer.md` as the first message, then this Brief (`.argos/CI-002/brief.md`) as the second.
2. `git checkout story/CI-002 && git pull origin story/CI-002` (already cut and pushed by Argos; the brief itself is on the branch).
3. Read the two skills + planning sections above. The §Environment variables section is the most important — `.env.example` is generated from it.
4. Implement in this order:
   - `.env.example` first (lifts directly from architecture.md §Environment variables)
   - `compose.dev.yml` — easiest to validate locally (`docker compose -f compose.dev.yml up`)
   - `compose.sqlite.yml` — second easiest; just needs the app + SQLite volume
   - `compose.yml` — last; can't fully test until CI-001 publishes the ghcr.io image, but `docker compose config` validates structure
5. Manual smoke checks after each file:
   - `docker compose -f <file> config` (validates syntax)
   - `docker compose -f compose.dev.yml up` (full dev stack starts)
   - `docker compose -f compose.sqlite.yml up` (single-container starts)
6. Commit with `feat(CI-002): …`, `fix(CI-002): …`, `refactor(CI-002): …`. `chore(CI-002): …` is reserved for Argos status flips.
7. Write the feature-handoff to `.argos/CI-002/feature-handoff.md`. Be specific about: any env var you couldn't find a clean default for, any place where `compose.dev.yml`'s reload behavior differs from what `tsx watch` does standalone, whether you needed a `Dockerfile.dev`.
8. Hand back to André so he can open the spec-audit step.

## Notes from Argos

- **The `ghcr.io/ctrfhub/ctrfhub` image doesn't exist yet** — CI-001 will create it via the release job. For now, `compose.yml` documents the structure and references the registry path; it just won't `docker compose up` until CI-001 ships and a tag is pushed. That's acceptable; the file's purpose is to be ready when the image lands.
- **Don't seed admin users in dev compose.** AUTH-002 owns the setup-wizard flow; dev compose just brings up an empty DB and lets the user step through `/setup` as they would in real deployment. (Once AUTH-002 lands, we may revisit and add a seeded-admin convenience for dev — file as a NIT in feature-handoff if it bothers you, don't address in this story.)
- **CTRF dog-food lives in CI-001 / CI-003**, not here. Don't add CTRF reporters to compose.
- **MinIO is not in scope.** Artifact storage in MVP uses local filesystem (per `architecture.md §Artifact Storage`). Adding a MinIO sidecar is for a Phase-2 story not yet in tasks.md.
- The `.env.example` should explicitly note which env vars are **required** and which are **optional** with documented defaults. Use a comment style like `# REQUIRED:` or `# OPTIONAL (default: ...)` so a deployer reading the file knows what they need to fill in.

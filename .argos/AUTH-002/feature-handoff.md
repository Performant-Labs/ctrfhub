# Feature Handoff — AUTH-002: First-boot setup wizard (Feature 0)

**Branch:** `story/AUTH-002`
**Commits on this branch since `main`:**
- `22f1c8d` chore(AUTH-002): assign

## What was built

- `src/modules/setup/schemas.ts` — Zod schemas for all 4 wizard steps + env-var seed validation
- `src/modules/setup/service.ts` — SetupService with step-commit logic (getSetupState, createAdminUser, createOrganization, createFirstProject, generateApiToken, completeSetup, seedFromEnv)
- `src/modules/setup/routes.ts` — Fastify route plugin: `GET /setup`, `POST /setup/step/1..4` with skipAuth, pre-condition guards, and CI snippet templates for 5 platforms
- `src/views/pages/setup.eta` — Standalone full-page template for the setup wizard (not wrapped in main layout)
- `src/views/partials/setup-header.eta` — Horizontal 4-step progress indicator with completed/active/pending states
- `src/views/partials/setup-card.eta` — Wizard card wrapper (HTMX swap target)
- `src/views/partials/setup-step-1.eta` — Admin account form with Alpine password strength indicator
- `src/views/partials/setup-step-2.eta` — Organization form with auto-generated slug
- `src/views/partials/setup-step-3.eta` — Project form with auto-generated slug
- `src/views/partials/setup-step-4.eta` — CI/CD setup with one-time token display, Copy button, and framework snippet picker
- `src/views/partials/setup-error.eta` — Inline error alert for step submission failures
- `src/client/setup.ts` — Alpine data components (setupStep1–4) registered on `alpine:init`
- `src/app.ts` — Decorated `fastify.auth`, registered setup routes, wired env-var seed after migrations
- Auth preHandler in `src/app.ts` already exempts `/setup` and `/setup/` paths from empty-DB redirect (no change needed in `src/auth.ts`)

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run migrate:pg` — N/A (no entities changed — uses existing Organization, Project, User entities)
- `npm run migrate:sqlite` — N/A (no entities changed)
- `npm run dev` — not run in this session (requires running PostgreSQL/SQLite instance)

## Files created or modified

Grouped by directory. One line per file, with a short purpose note.

- `src/modules/setup/schemas.ts` — Zod schemas for steps 1–4 + env-var seed
- `src/modules/setup/service.ts` — Business logic for each step and seed path
- `src/modules/setup/routes.ts` — Route plugin for GET /setup and POST /setup/step/1..4
- `src/views/pages/setup.eta` — Standalone full-page shell for the wizard
- `src/views/partials/setup-header.eta` — Horizontal progress indicator
- `src/views/partials/setup-card.eta` — Card wrapper (HTMX swap target)
- `src/views/partials/setup-step-1.eta` — Admin account form
- `src/views/partials/setup-step-2.eta` — Organization form
- `src/views/partials/setup-step-3.eta` — Project form
- `src/views/partials/setup-step-4.eta` — CI/CD setup with token display
- `src/views/partials/setup-error.eta` — Inline error alert
- `src/client/setup.ts` — Alpine components for password strength and step transitions
- `src/app.ts` — Decorate `fastify.auth`, register setup plugin, env-var seed at boot

## Decisions not covered by planning docs

- **Env-var seed runs before `currentBootState = 'ready'`** — runs after `orm.schema.update()` and Better Auth `runMigrations()` to guarantee tables exist, but before event bus subscriptions so seed completes before any background work starts.
- **Env-var seed uses two-phase approach** — Better Auth manages its own Kysely connection independently from MikroORM, so user creation (via Better Auth) auto-commits separately. Org + project creation are wrapped in a single MikroORM transaction. If org/project creation fails, the user already exists — the wizard resumes from step 2.
- **Project `id` is auto-increment integer** — `createFirstProject` does NOT manually assign the id (unlike the prior crashed session's code). MikroORM assigns it on flush.
- **`GET /setup` renders `pages/setup.eta` directly** (not `reply.page()`) — the setup wizard is a standalone full-page template with its own `<html>` wrapper, intentionally not using the main layout.
- **POST step responses are partials only** — they use `reply.view('partials/...')` directly since all wizard navigation is HTMX-driven.
- **No `CTRFHUB_SETUP_TOKEN` guard** — the spec marks this as optional ("off by default"), not required for MVP.
- **`src/auth.ts` unchanged** — the global preHandler in `app.ts` already exempts `/setup` and `/setup/` paths via the empty-users redirect branch. Routes are individually marked `config: { skipAuth: true }`.

## Known issues / follow-ups

- `seedFromEnv` uses `crypto.randomUUID()` for Organization ID — this assumes string primary keys match the `Organization.id` type. The Organization entity uses `p.string().primary()` which is correct.
- Setup wizard routes do not use Fastify's `schema:` option for request body validation (they use `safeParse` in the handler). This is intentional because form-encoded POST bodies aren't automatically validated by ZodTypeProvider (which expects JSON).
- `resume from furthest-advanced step`: if a user closes the browser mid-wizard (e.g., after step 2 completes but before step 3 starts), `GET /setup` correctly returns step 3 on the next visit. However, if the user refreshes during step 4 (after token generation but before completing setup), the token is lost (one-time display design). The user would need to generate a new API token from the dashboard.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/AUTH-002` (already on it if continuing locally).
3. Start with T1 Headless. Routes to focus on: `GET /setup`, `POST /setup/step/1`, `GET /setup` (after step 1 to verify step 2 appears), `GET /setup` (after all steps → 410). Tier-report templates are in `.antigravity/agents/test-writer.md`.

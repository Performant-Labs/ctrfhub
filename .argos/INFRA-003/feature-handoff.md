# Feature Handoff — INFRA-003: Base Tailwind CSS entry and layout template

**Branch:** `story/INFRA-003`
**Commits on this branch since `main`:**
- `cea57d3` chore(INFRA-003): assign

## What was built

- `src/assets/input.css` — Full Tailwind v4 CSS entry with `@import tailwindcss`, `@import flowbite`, `@source` directives, `@theme` design tokens, `[data-theme]` runtime overrides for five themes, and `@layer components` with `.badge-pass/fail/skip/flaky`, `.run-card`, `.stat-tile`
- `src/views/layouts/main.eta` — Main layout shell: correct script load order (tailwind.css → htmx → idiomorph → alpine → flowbite → app.js), `<meta viewport content="width=1280">`, `hx-ext="morph"` on `<body>`, includes `pages/{it.body}.eta` via `includeFile`
- `src/app.ts` — `reply.page()` decorator: detects `HX-Request: true` header → renders `partials/{template}.eta`; otherwise renders `layouts/main.eta` with `{ body: template, ...data }`
- `src/client/htmx-events.ts` — Populated with HTMX event constants (`AFTER_SETTLE`, `AFTER_SWAP`, `BEFORE_REQUEST`, `RESPONSE_ERROR`, `LOAD_START`, `LOAD_END`)
- `src/client/app.ts` — Client entry point: re-initializes Flowbite on `htmx:afterSettle` (global `initFlowbite` from the pre-loaded flowbite.min.js)
- `src/views/partials/error.eta` — HTMX-swappable error fragment with `role="alert"`
- `src/views/pages/home.eta` — Stub home page with `<main>` landmark and `h1`
- `scripts/copy-vendor-assets.mjs` — Copies vendor JS (htmx, idiomorph, alpine, flowbite) from node_modules to `src/assets/` and compiles `src/client/app.ts` via esbuild
- `package.json` — Added `postinstall` (copies vendor assets), `client:build`, `assets:build`, `assets:dev` scripts; updated `build` to `tsc && npm run assets:build`
- `.gitignore` — Added generated vendor JS files and `src/assets/app.js` to ignored list

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run css:build` — succeeded (153ms)
- `npm run css:dev` — watch starts without error
- `npm run client:build` — succeeded; `app.js` is 774 bytes
- `npm run migrate:pg` — not run (requires Postgres)
- `npm run migrate:sqlite` — not run (requires SQLite)
- `npm run dev` — not run (requires DB; pending integration test setup)

## Files created or modified

### Created
- `src/views/layouts/main.eta` — Main HTML layout shell (viewport meta, script load order, hx-ext=morph)
- `src/views/partials/error.eta` — HTMX error fragment with alert role
- `src/views/pages/home.eta` — Stub home page
- `src/client/app.ts` — Browser entry: Flowbite re-init on HTMX afterSettle
- `scripts/copy-vendor-assets.mjs` — Vendor asset copy + client TS compilation

### Modified
- `src/assets/input.css` — Full Tailwind v4 entry replacing stub
- `src/app.ts` — Added `reply.page()` decorator and FastifyReply type augmentation
- `src/client/htmx-events.ts` — Populated with HTMX event constants
- `package.json` — Added postinstall, client:build, assets:build, assets:dev scripts
- `.gitignore` — Added generated vendor JS + app.js entries
- `tsconfig.json` — Excluded `src/client` (browser code needs DOM lib, breaks server tsconfig)

## Decisions not covered by planning docs

- **`src/client/` excluded from main `tsconfig.json`** — Client files reference DOM globals (`document`, `window`) and use `declare global function initFlowbite()`. The server-side tsconfig has `lib: ["ES2022"]` without DOM. Excluding client files avoids DOM type pollution in server code while esbuild handles browser compilation independently. Adjoins `skills/htmx-4-forward-compat.md` (htmx-events.ts lives in client directory).
- **Vendor JS served from `src/assets/` via copy-instead-of-symlink** — The `postinstall` script copies htmx.min.js, idiomorph-ext.min.js, alpine.min.js, and flowbite.min.js into `src/assets/` so the existing `@fastify/static` registration (serving `/assets/` from `src/assets/`) picks them up without additional Fastify plugin registrations. Alternative (multiple `@fastify/static` registrations with different roots) would conflict on the `/assets/` prefix. This keeps the static-file setup single-root and simple. Adjoins `skills/tailwind-4-flowbite-dark-only.md` §Script load order.

## Known issues / follow-ups

- **`npm run dev` / server boot not verified** — The app requires a database (Postgres or SQLite) to boot due to schema sync at startup. DB was not available in this session. The Test-writer should verify `npm run dev` boots with a `SQLITE_PATH` env var pointing to a temp file.
- **Eta template vars use `it`** — The `@fastify/view` plugin with Eta passes template data as `it` to templates. `layouts/main.eta` accesses `it.body` and `it.title`. If the Test-writer sees template errors, check that `viewExt: 'eta'` is set and data is passed correctly.
- **Flowbite 4 dark-only** — The skill mandates dark-mode-only (no `dark:` variants). The `[data-theme]` overrides in input.css set `--color-surface` per theme. Confirm dark surfaces render correctly in T3 visual checks.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/INFRA-003` (already on it if continuing locally).
3. Start with T1 Headless. Routes to focus on:
   - `GET /` (or any HTML route using `reply.page()`) — verify HX-Request branching (with/without header)
   - `<meta viewport content="width=1280">` emitted in full-page response
   - Script load order in `<head>` (tailwind.css → htmx → idiomorph → alpine → flowbite → app.js)
   - Static assets: `/assets/tailwind.css` (200), `/assets/htmx.min.js` (200), `/assets/app.js` (200)
4. T2 ARIA: `main` landmark, `nav` landmark
5. T3 Visual: narrow-smoke at 375×800 (no horizontal scroll); 1280×800 baseline layout

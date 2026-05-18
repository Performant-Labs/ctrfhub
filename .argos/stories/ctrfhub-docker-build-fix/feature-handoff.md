# Feature handoff — ctrfhub-docker-build-fix

## Iteration 1

**Date:** 2026-05-17
**Branch:** `story/ctrfhub-docker-build-fix`
**Commits added this iteration:**
- (see `git log` — `fix(ctrfhub-docker-build-fix): repair builder/runner asset bridging and static-auth bypass`)

### What was built / fixed

- **Bug 1 — builder stage:** `npm ci` ran before `COPY . .`, so the
  `postinstall` hook (`scripts/copy-vendor-assets.mjs`) could not find
  `scripts/` or `src/client/app.ts`. Reordered the builder stage so
  `COPY . .` precedes `npm ci`.
- **Bug 1 — runner stage (same root cause, second occurrence):** the
  runner stage also runs `npm ci --omit=dev`, which fired the same
  `postinstall` hook against a stage that has no `scripts/`,
  no `src/client/`, and no `esbuild` (a devDep). The first build attempt
  failed here. Fixed by running the runner-stage install with
  `--ignore-scripts` and recompiling the one native module that
  legitimately needs an install script via an explicit
  `npm rebuild better-sqlite3`. The runner does not need to re-vendor
  assets — they are baked into `dist/assets/` by the builder.
- **Bug 2 — vendored assets in wrong directory:** `copy-vendor-assets.mjs`
  writes vendored client JS into `src/assets/`, but production serves
  static assets from `dist/assets/` (`src/app.ts` §5, `path.join(__dirname,
  'assets')`). Added a builder-stage step `cp -r src/assets/. dist/assets/`
  so `htmx.min.js`, `idiomorph-ext.min.js`, `alpine.min.js`,
  `flowbite.min.js`, and `app.js` end up in `dist/assets/`. The runner
  already copies `/app/dist`, so they reach the runtime image for free.
- **Bug 2 corollary — auth hook shadowed static assets:** with Bugs 1 & 2
  fixed, `/assets/*.js` still 404'd at runtime. The global `onRequest`
  auth hook in `src/app.ts` only exempted `/assets/` from Branch 1 (the
  empty-users → `/setup` redirect); Branches 2–5 still ran, so an
  unauthenticated asset request fell through to Branch 5 and was
  redirected to `/login`. Added a Branch 0 early-return: any `/assets/*`
  path bypasses auth entirely and is served by `@fastify/static`
  (which still returns a real 404 for genuinely missing files — verified).
  Acceptance criterion 3 ("no 404s for vendored client JS") cannot pass
  without this; the brief lists `src/app.ts` as an affected file.

### Commands run locally (results)

- `npx tsc --noEmit` — 0 errors (exit 0)
- `docker build -f Dockerfile -t ctrfhub-buildfix:local .` — succeeded, no errors
- Ran the built image as container `ctrfhub-buildfix-verify` with named
  volumes `ctrfhub-buildfix_sqlite` / `ctrfhub-buildfix_artifacts`
  (distinct names — the live 34-container Coolify stack was never touched;
  no global Docker command was run):
  - `GET /health` → HTTP 200 after ~2 s
  - `GET /` → HTTP 302 (redirect to `/setup`; acceptable per criterion 2 —
    no admin configured on a fresh DB)
  - `GET /assets/htmx.min.js` → HTTP 200, `application/javascript`, 51238 B
  - `GET /assets/idiomorph-ext.min.js` → HTTP 200, 10153 B
  - `GET /assets/alpine.min.js` → HTTP 200, 46346 B
  - `GET /assets/flowbite.min.js` → HTTP 200, 134181 B
  - `GET /assets/app.js` → HTTP 200, 774 B
  - `GET /assets/tailwind.css` → HTTP 200, `text/css`, 204563 B
  - `GET /assets/does-not-exist.js` → HTTP 404 (static plugin still
    correctly 404s missing files — Branch 0 did not turn `/assets/*` into
    a catch-all)
- Verified `dist/assets/` inside the image lists all six files via
  `docker run --entrypoint sh`.
- Cleanup: removed the verify container, both named volumes, and the
  local image. Confirmed 0 residual containers/volumes matching
  `ctrfhub-buildfix`.

### Files created or modified

- `Dockerfile` — builder stage: `COPY . .` now precedes `npm ci` (Bug 1);
  added `cp -r src/assets/. dist/assets/` after the build steps (Bug 2).
  Runner stage: `npm ci --omit=dev` now uses `--ignore-scripts` plus an
  explicit `npm rebuild better-sqlite3` (Bug 1, runner occurrence).
- `src/app.ts` — added Branch 0 to the global `onRequest` auth hook: an
  early `return` for any `/assets/*` request so static assets bypass auth
  entirely.

### Decisions not covered by planning docs

- **Runner-stage `--ignore-scripts` + explicit `npm rebuild better-sqlite3`.**
  The brief named Bug 1 only in the builder stage, but the identical bug
  exists in the runner stage and surfaced on the first build. Reordering
  source copies in the runner would mean shipping `scripts/` + `src/` into
  the production image purely to satisfy a build-time hook — and `esbuild`
  (a devDep) is absent under `--omit=dev` anyway, so the hook would still
  fail. Skipping all install scripts and explicitly rebuilding the single
  native module (`better-sqlite3`) is the minimal correct fix and keeps the
  runner image free of source. Adjoins the Dockerfile's existing
  builder/runner split documented in its header comment.
- **`cp -r src/assets/. dist/assets/` rather than retargeting
  `copy-vendor-assets.mjs`.** Changing the script's `dest` to `dist/assets/`
  would break `npm run dev` (dev serves from `src/assets/` via tsx, no
  `dist/`). The Dockerfile-side copy keeps dev and prod both working with no
  script change. Adjoins `scripts/copy-vendor-assets.mjs` and `src/app.ts` §5.
- **Branch 0 asset bypass placement.** Placed before Branch 1 as a dedicated
  early return rather than widening each branch's allowlist — `/assets/*`
  must bypass *all* auth branches, and a single guard is clearer and
  matches the hook's documented "AUTH-001 fills in branch bodies, never
  restructures" intent (Branch 0 is additive, not a restructure). Adjoins
  `skills/better-auth-session-and-api-tokens.md` and `skills/artifact-security-and-serving.md`
  (artifacts are a separate endpoint and unaffected).

### Known issues / follow-ups

- The builder stage no longer has a separate `COPY package*.json` layer, so
  `npm ci` now invalidates its Docker layer cache whenever any source file
  changes. This is a minor build-speed regression accepted deliberately:
  the brief forbids refactoring the pipeline, and the postinstall hook
  genuinely needs sources present. A future optimization could copy only
  `package*.json` + `scripts/` + `src/client/` before `npm ci`, but that is
  out of scope for this debut run.
- `GET /` returns 302 → `/setup` because the verification DB has no admin
  user. This is expected app behaviour, not a build defect; criterion 2
  explicitly accepts 302.
- `compose.sqlite.yml` was not modified. It references
  `ghcr.io/ctrfhub/ctrfhub:${CTRFHUB_TAG:-latest}` (a registry image).
  Verification ran the locally built image directly to avoid editing
  committed config; the Dockerfile fixes are what that registry image is
  built from, so a CI publish of this branch will carry the fix.

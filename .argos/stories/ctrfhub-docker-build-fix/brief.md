# Story Brief — ctrfhub-docker-build-fix

## Title
Fix Docker build failures so the SQLite compose stack builds and serves.

## Background
The CTRFHub Docker image does not build/run correctly. Two distinct,
sequential bugs were diagnosed:

### Bug 1 — `npm ci` runs before sources are copied
In `Dockerfile`, the builder stage runs `npm ci` BEFORE `COPY . .`.
`npm ci` triggers a `postinstall` hook that runs
`node scripts/copy-vendor-assets.mjs`. At the point `npm ci` runs, the
`scripts/` directory has not yet been copied into the image, so the
postinstall script cannot be found and the build fails.

### Bug 2 — vendored assets land in the wrong directory for production
`scripts/copy-vendor-assets.mjs` writes vendored client JS into
`src/assets/`. Production serves static client assets from
`dist/assets/` (see `src/app.ts:235`). The Dockerfile's runner stage
never copies `src/assets/* -> dist/assets/`. So even once Bug 1 is
fixed, the vendored client JS will 404 at runtime.

## Affected files
- `Dockerfile` (builder + runner stages)
- `scripts/copy-vendor-assets.mjs`
- `src/app.ts` (around line 235 — static asset serving path)
- `compose.sqlite.yml` (the compose file used to verify)

## Acceptance criteria
1. `docker compose -f compose.sqlite.yml up -d` builds the image with no
   errors.
2. The running container responds with HTTP 200 (or 302) on port 3000.
3. Vendored client JS is reachable at runtime (no 404s for assets the
   pages reference).

## Constraints
- The existing 34-container Coolify stack on this host (Uranus) MUST
  remain undisturbed. Do not stop, restart, prune, or reconfigure any
  containers, networks, or volumes outside this story's own compose
  project. Use a distinct compose project name if needed and clean up
  only what this story creates.
- This is the orchestration loop's DEBUT run. Prefer minimal,
  well-scoped edits that directly resolve the two bugs. Do not refactor
  the Dockerfile or build pipeline beyond what is required.
- Both bugs must be fixed; fixing only Bug 1 leaves runtime 404s.

## Suggested fix direction (non-binding)
- Bug 1: ensure `scripts/` (and anything else `postinstall` needs) is
  present before `npm ci` runs — e.g. reorder so `COPY . .` precedes
  `npm ci`, or copy `scripts/` + `package*.json` together before install.
- Bug 2: have the runner stage copy the vendored assets into
  `dist/assets/`, or align the build so vendored output lands where
  production serves it.

The implementer should verify the final fix against all three
acceptance criteria before handoff.

# Story: Add Docker build-layer caching for fast F-iteration verification

## Argos preconditions & notes (added at Phase 1)

- [x] Dependency satisfied: `ctrfhub-docker-build-fix` merged as PR #71 (`142fb97` on `main`).
- [x] No P0 gap blocks this story: G-P0-001..004 concern Tailwind/Eta/settings/AI — none affect Docker build caching.
- [x] Branch cut: `story/ctrfhub-docker-build-cache` from `main` @ `142fb97`.
- No `tasks.md` row (standalone build-infra story) — nothing to flip.

### ⚠️ Conflict resolution — scope item 4 (READ BEFORE IMPLEMENTING)

Scope item 4 below says to confirm the `Dockerfile` runs `npm ci` **before** `COPY . .`.
**The merged `ctrfhub-docker-build-fix` (PR #71) deliberately did the opposite**: the
builder stage runs `COPY . .` *before* `npm ci`, because the `postinstall` hook
(`scripts/copy-vendor-assets.mjs`) needs `scripts/` and `src/client/` present when
install runs. Reverting that order reintroduces a fixed, tested bug.

**Resolution (binding):** Do NOT revert the layer order. Item 4 is reinterpreted as a
verification-and-documentation task: confirm the current order is correct given the
postinstall constraint, and document that **scope item 1's `--mount=type=cache` is the
mechanism that delivers the warm-build speedup** — a BuildKit cache mount survives the
`COPY . .` layer invalidation that an ordinary layer cache cannot. Items 1, 2, 3 are
unaffected and stand as written. If you find any further conflict, flag it in the
handoff rather than reverting build-fix behaviour.

## Motivation
Each F↔A iteration in the orchestrator loop re-runs `docker build` from scratch. Cold builds take ~2–3 minutes on Uranus; multi-iteration stories spend 6–9 minutes just on builds. Caching can cut warm builds to <30s.

## Scope — four targeted optimizations

1. **BuildKit `--mount=type=cache` for npm.** In `Dockerfile`, change `RUN npm ci` to `RUN --mount=type=cache,target=/root/.npm npm ci`. Apply same pattern to any other long install steps.

2. **buildx local cache backend.** Add a script (in `scripts/` or a target in `Makefile`/`package.json`) the orchestrator and F can invoke for verification builds: `docker buildx build --cache-from type=local,src=/tmp/ctrfhub-buildcache --cache-to type=local,dest=/tmp/ctrfhub-buildcache,mode=max ...`. Document the cache dir location.

3. **`.dockerignore` audit.** Tighten the build context — confirm `node_modules/`, `.git/`, `dist/`, `coverage/`, screenshots, logs, `.argos/`, and other large/transient dirs are excluded.

4. **Layer-ordering verification.** Confirm `Dockerfile` copies `package*.json` and runs `npm ci` BEFORE `COPY . .` so the deps layer doesn't invalidate on source-only changes.

## Acceptance criteria
- Cold build time captured before and after the change.
- Warm build (second consecutive build, no source change) under 30 seconds.
- All existing tests still pass.
- Coolify stack on Uranus undisturbed.

## Constraints
- Do not change application code; only `Dockerfile`, `.dockerignore`, and scripts/Make targets.
- Local-disk cache only (single-host dev setup; no remote registry cache).
- Must merge cleanly on top of `story/ctrfhub-docker-build-fix` (whichever commit is current on `main` when this story starts).

## Note to Argos
This story is queued. Start only AFTER `ctrfhub-docker-build-fix` has merged. Do not kick off in parallel with the current story.

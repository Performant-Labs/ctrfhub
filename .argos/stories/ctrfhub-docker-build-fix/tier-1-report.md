# Tier 1 Headless Report — ctrfhub-docker-build-fix

**Executed:** 2026-05-17 19:18
**Method:** `docker build` + `docker run` + `curl` (image/runtime verification);
`fastify.inject()` (Branch 0 auth-bypass integration tests). No browser.

## Orchestrator note honored

Acceptance criterion 1 names `docker compose -f compose.sqlite.yml up -d`
literally, but André ruled that wording loose: `compose.sqlite.yml` is a
pull-image production file (`image: ghcr.io/ctrfhub/ctrfhub:...`, no `build:`
stanza) and stays untouched. The criteria were therefore verified against a
**directly-built image** from the `Dockerfile`: `docker build` → `docker run`
→ assert criteria 1–3. This matches A's iteration-1 finding #1.

## Shared-host discipline

This host (Uranus) runs a live 34-container Coolify stack. All story-scoped
resources used distinct names — image `ctrfhub-buildfix-test:t1`, container
`ctrfhub-buildfix-test-c`, volumes `ctrfhub-buildfix-test-sqlite` /
`ctrfhub-buildfix-test-artifacts`, host port 3999. Only those were torn down.
No global Docker command was run. Post-teardown residual check: 0 containers,
0 volumes, 0 images matching `ctrfhub-buildfix-test`; `docker ps` count
unchanged at 34.

## Checks — acceptance criteria against the built+running container

| # | What is being verified | Command | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Criterion 1 — image builds clean from `Dockerfile` | `docker build -f Dockerfile -t ctrfhub-buildfix-test:t1 .` | exit 0, no errors | exit code 0; all 18 build stages completed; runner stage `npm ci --omit=dev --ignore-scripts` + `npm rebuild better-sqlite3` succeeded | ✓ |
| 2 | Builder Bug 1 fix — `COPY . .` precedes `npm ci`, postinstall hook finds `scripts/` | build log of stage `[builder]` | `npm ci` runs after source copy; postinstall vendors JS into `src/assets/` | builder stages 5–8 completed; no `MODULE_NOT_FOUND` for `scripts/copy-vendor-assets.mjs` | ✓ |
| 3 | Builder Bug 2 fix — vendored assets bridged into `dist/assets/` | `docker run --entrypoint sh ... -c "ls -la /app/dist/assets/"` | all 5 vendored JS + tailwind.css present | `alpine.min.js` (46346), `app.js` (774), `flowbite.min.js` (134181), `htmx.min.js` (51238), `idiomorph-ext.min.js` (10153), `tailwind.css` (206370), `input.css` — all present in image | ✓ |
| 4 | Criterion 2 — running container responds on port 3000 | `curl http://localhost:3999/health` (mapped 3999→3000) | 200 | 200 (ready after ~2 s) | ✓ |
| 5 | Criterion 2 — `GET /` responds 200 or 302 | `curl http://localhost:3999/` | 200 or 302 | 302 → `/setup` (expected: fresh DB, no admin; criterion 2 explicitly accepts 302) | ✓ |
| 6 | Criterion 3 — `/assets/htmx.min.js` reachable, no 404 | `curl /assets/htmx.min.js` | 200, `application/javascript` | 200, `application/javascript; charset=utf-8`, 51238 B | ✓ |
| 7 | Criterion 3 — `/assets/idiomorph-ext.min.js` reachable | `curl /assets/idiomorph-ext.min.js` | 200 | 200, `application/javascript`, 10153 B | ✓ |
| 8 | Criterion 3 — `/assets/alpine.min.js` reachable | `curl /assets/alpine.min.js` | 200 | 200, `application/javascript`, 46346 B | ✓ |
| 9 | Criterion 3 — `/assets/flowbite.min.js` reachable | `curl /assets/flowbite.min.js` | 200 | 200, `application/javascript`, 134181 B | ✓ |
| 10 | Criterion 3 — `/assets/app.js` reachable | `curl /assets/app.js` | 200 | 200, `application/javascript`, 774 B | ✓ |
| 11 | Criterion 3 — `/assets/tailwind.css` reachable | `curl /assets/tailwind.css` | 200, `text/css` | 200, `text/css; charset=utf-8`, 206370 B | ✓ |
| 12 | Every asset path the layout references is covered | `grep -oE '/assets/[a-z.-]+' src/views/layouts/main.eta` | 6 paths, all verified above | 6 paths (`tailwind.css`, `htmx.min.js`, `idiomorph-ext.min.js`, `alpine.min.js`, `flowbite.min.js`, `app.js`) — all return 200 | ✓ |
| 13 | Negative control — missing asset still 404s (Branch 0 is not a catch-all) | `curl /assets/does-not-exist.js` | 404 | 404 | ✓ |

## Checks — Branch 0 auth bypass (`fastify.inject()` integration tests)

New file: `src/__tests__/integration/static-asset-auth-bypass.test.ts` — 31 tests.

| # | What is being verified | Expected | Actual | Status |
|---|---|---|---|---|
| 14 | `/assets/*` reachable WITHOUT auth (no cookie, no token) — 5 vendored JS files return 200 | 200 each | 200 each | ✓ |
| 15 | `/assets/*` never redirected to `/setup` or `/login` (all 6 layout asset paths) | status ∈ {200,404}, no `Location` | no redirect on any path | ✓ |
| 16 | `/assets/*` emits no `HX-Redirect` header for HTMX requests | header undefined | undefined | ✓ |
| 17 | Missing `/assets/*` file still 404s (not redirected) — Branch 0 only skips auth, not the static handler's 404 | 404, no `Location` | 404, no `Location` | ✓ |
| 18 | Non-asset routes still gate (empty DB) — `/`, `/nonexistent`, `/dashboard` → 302 `/setup` (Branch 1 unchanged) | 302 `/setup` | 302 `/setup` | ✓ |
| 19 | Path-prefix exactness — `/my-assets`, `/assetsx` do NOT match `startsWith('/assets/')`, still gate | 302 `/setup` | 302 `/setup` | ✓ |
| 20 | Non-asset routes still gate (users exist) — unauthenticated `/` → 302 `/login`, HTMX `/dashboard` → 200 + `HX-Redirect: /login` (Branch 5 unchanged) | as expected | as expected | ✓ |
| 21 | Invalid `x-api-token` on a non-asset route still → 401 (Branch 3 unchanged) | 401 | 401 | ✓ |
| 22 | Invalid `x-api-token` on an `/assets/*` route is ignored — asset still served 200 (Branch 0 precedes Branch 3) | 200 | 200 | ✓ |
| 23 | Query string on asset URL (`?v=2`) still bypasses auth (Branch 0 matches `url.split('?')[0]`) | 200, no redirect | 200, no redirect | ✓ |
| 24 | `/health` remains 200, unaffected by Branch 0 | 200 | 200 | ✓ |

## Excerpt of raw output

```
=== build exit verification ===
build exit code: 0

=== dist/assets inside the image ===
-rw-r--r-- 1 root root  46346  alpine.min.js
-rw-r--r-- 1 root root    774  app.js
-rw-r--r-- 1 root root 134181  flowbite.min.js
-rw-r--r-- 1 root root  51238  htmx.min.js
-rw-r--r-- 1 root root  10153  idiomorph-ext.min.js
-rw-r--r-- 1 root root   2654  input.css
-rw-r--r-- 1 root root 206370  tailwind.css

=== criteria 2 + 3 ===
GET /                              -> 302  (Location: /setup)
GET /health                        -> 200
GET /assets/tailwind.css           -> 200  text/css                206370 bytes
GET /assets/htmx.min.js            -> 200  application/javascript   51238 bytes
GET /assets/idiomorph-ext.min.js   -> 200  application/javascript   10153 bytes
GET /assets/alpine.min.js          -> 200  application/javascript   46346 bytes
GET /assets/flowbite.min.js        -> 200  application/javascript  134181 bytes
GET /assets/app.js                 -> 200  application/javascript     774 bytes
GET /assets/does-not-exist.js      -> 404

static-asset-auth-bypass.test.ts — 31 tests, all passing
Full integration suite — 195 tests, all passing
```

## Verdict

**PASS** — all three acceptance criteria satisfied against a directly-built
image; Branch 0 auth-bypass behavior fully covered with no regression to the
auth posture of non-asset routes. Proceed to Tier 2 evaluation.

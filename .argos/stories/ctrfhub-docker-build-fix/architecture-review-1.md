# Architecture review — ctrfhub-docker-build-fix — iteration 1

**Reviewer:** architecture-reviewer (Claude Opus 4.7) — review mode
**Date:** 2026-05-17
**Verdict:** PASS
**Diff base:** main @ 4e07a3c
**Diff head:** story/ctrfhub-docker-build-fix @ 288e93e

## Summary

PASS. The two Docker build bugs (and the runtime auth-shadowing corollary)
are fixed with minimal, well-scoped, well-commented edits that respect the
existing builder/runner stage split and the documented onRequest hook
structure. The new Branch 0 asset bypass is correctly scoped and weakens
auth posture for no non-asset route. The one substantive concern is a
literal-reading gap in acceptance criterion 1: `compose.sqlite.yml` uses an
`image:` registry reference with no `build:` stanza, so `docker compose up`
never builds the image — recorded below as a `warn`, not a `block`, because
it is a brief/spec interpretation question (Spec-enforcer's call) and the
Dockerfile fix itself is sound and complete.

## Findings

| # | Severity | File:line | Drift dimension | Finding | Suggested fix |
|---|---|---|---|---|---|
| 1 | warn | `compose.sqlite.yml:18` | pattern consistency / scope | Acceptance criterion 1 says `docker compose -f compose.sqlite.yml up -d` must *build* the image, but the compose file declares `image: ghcr.io/ctrfhub/ctrfhub:...` with no `build:` stanza — `up` will pull, never build. The diff does not touch this file. Criterion 1, read literally, is therefore not satisfiable by this diff; it is only satisfiable via a CI publish of the branch (as F notes) or by a local `docker build` + tag. This is not architectural drift in the code F wrote — it is an unaddressed acceptance-criterion gap. Flagging for the Spec-enforcer / Argos to rule on: either criterion 1 is reinterpreted as "the Dockerfile builds cleanly" (which F verified) or `compose.sqlite.yml` needs a `build:` stanza. Do not let A's PASS be read as confirmation that criterion 1 is met as written. | No code change required from an architecture standpoint. Argos/S to decide: reinterpret criterion 1, or add a `build: { context: ., dockerfile: Dockerfile }` stanza to `compose.sqlite.yml`. If the latter, note that adding `build:` alongside `image:` is a deliberate pattern choice (tag-on-build) and should match how `compose.yml`/Postgres variant handles it. |
| 2 | nit | `src/app.ts:519-524` | pattern consistency | With Branch 0 returning early for all `/assets/*` requests, the `rawPath.startsWith('/assets/')` clause in Branch 1's `isExemptFromEmptyCheck` allowlist is now dead/unreachable. Harmless and arguably defensive, but it is now slightly misleading — the Branch 1 comment still claims it exempts `/assets/*`. | Optional: drop the `/assets/` clause from `isExemptFromEmptyCheck` and the corresponding line in the Branch 1 comment, since Branch 0 now owns that exemption. Leave it if preferred as defense-in-depth — but then no action needed. Not blocking either way. |

## Prior-iteration check

N/A — iteration 1.

## Notes for the implementer

None required for PASS. Finding #1 is routed to Argos/Spec-enforcer, not to F:
it is an acceptance-criterion interpretation question, not a code defect. If
Argos rules that criterion 1 must be literally satisfiable from
`compose.sqlite.yml up`, that becomes a scoped follow-up (add a `build:`
stanza) — but per this story's brief that edit may itself count as pipeline
config change, so the decision belongs above F.

## Architectural assessment (evidence)

- **Builder stage reorder (`COPY . .` before `npm ci`).** Correct and
  minimal. The postinstall hook (`scripts/copy-vendor-assets.mjs`) genuinely
  needs `scripts/` + `src/client/` present; reordering is the smallest fix.
  F correctly documented the layer-cache regression as an accepted, in-scope
  tradeoff rather than refactoring the pipeline (brief forbids that).
  No layering or dependency-direction drift.
- **Runner stage `--ignore-scripts` + `npm rebuild better-sqlite3`.** Sound.
  The runner stage has no `scripts/`, no `src/client/`, and `esbuild` is a
  devDep absent under `--omit=dev`, so the postinstall hook cannot succeed
  there and must be skipped. Explicitly rebuilding only the one native
  module (`better-sqlite3`) that legitimately needs an install script is the
  correct narrow remedy and keeps the runner image source-free, consistent
  with the Dockerfile header's documented builder/runner split ("no source,
  no devDeps"). Abstraction altitude matches the surrounding stage.
- **`cp -r src/assets/. dist/assets/` (Bug 2).** Consistent with the
  established pattern: step 2 already does `mkdir -p dist/assets` +
  Tailwind output into `dist/assets/`. Bridging vendored JS into the same
  directory keeps a single static-asset root. F's rationale for not
  retargeting `copy-vendor-assets.mjs` (would break `npm run dev`, which
  serves from `src/assets/`) is correct — the script's `dest` is
  `src/assets/` by design and dev has no `dist/`.
- **Branch 0 auth bypass (`src/app.ts`).** Correctly scoped and consistent
  with the existing hook structure. The bypass predicate
  `rawPath.startsWith('/assets/')` exactly matches the sole `@fastify/static`
  registration (`prefix: '/assets/'`, `src/app.ts:236`) — there is only one
  static registration in `src/`, so no other static route is affected and
  no auth-guarded route can begin with `/assets/`. The early `return` is
  additive: it precedes Branch 1 and does not restructure Branches 1–5,
  honoring the hook's documented "AUTH-001 fills in branch bodies, never
  restructures" contract. `rawPath` was hoisted above Branch 0 and the
  former `const rawPath` inside Branch 1 removed — no shadowing, no double
  declaration. Auth posture for every non-asset route is unchanged.
  `@fastify/static` still returns genuine 404s for missing asset files
  (F verified; structurally correct since the bypass only skips the auth
  hook, not the static handler's own not-found behavior).
- **Scope discipline.** The diff touches exactly `Dockerfile` and
  `src/app.ts` (plus the two `.argos/` story docs). No pipeline refactor,
  no opportunistic cleanup. Within the brief's "minimal, well-scoped"
  constraint.

## Patterns referenced

- `Dockerfile` — existing multi-stage builder/runner split and header
  contract ("Stage 2 runner: no source, no devDeps").
- `src/app.ts:232-239` — sole `@fastify/static` registration, `prefix: '/assets/'`.
- `src/app.ts:501-602` — the onRequest auth hook and its documented
  precedence / "never restructure" contract.
- `scripts/copy-vendor-assets.mjs` — confirms vendored output `dest` is
  `src/assets/` by design.
- `compose.sqlite.yml` — confirms `image:` registry reference, no `build:` stanza.

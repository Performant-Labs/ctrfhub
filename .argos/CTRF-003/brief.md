# CTRF-003 — Artifact co-upload with ingest

**Type:** story (feature implementation)
**Estimated effort:** 1 cycle (multipart upload + validation + storage integration)
**Blocks:** ART-001, ART-002 (artifact serving and display)
**Blocked by:** CTRF-002 (already complete)

---

## Goal

Extend the existing CTRF ingest endpoint at `POST /api/v1/projects/:slug/runs` to accept artifact files alongside the CTRF JSON body in a single multipart request. Implement magic-bytes validation, per-file and per-run size limits, and integration with the `ArtifactStorage` interface (defaulting to local FS).

After this story:

- The endpoint accepts both `application/json` (existing — unchanged) AND `multipart/form-data` (new — artifact upload).
- Each accepted file is validated, written via `ArtifactStorage.put()`, and recorded as a `TestArtifact` row.
- External-URL attachments (where `TestArtifact.referenceUrl` is set) are stored by reference only — no file body accepted for those.

This is the prerequisite for ART-001 (artifact serving) and ART-002 (artifact UI).

---

## Required reading

You **must** read all of these before writing any code:

**Story-specific skills** (cited in `tasks.md` for CTRF-003):

1. `skills/ctrf-ingest-validation.md` — Zod CTRF schema, magic-bytes validation rules, size limits.
2. `skills/artifact-security-and-serving.md` — `ArtifactStorage` interface, safe content-type rules.
3. `skills/vitest-three-layer-testing.md` — integration test layering with doubles (you don't write the tests, but the test-writer's life depends on you leaving the code in a testable shape).

**Always-read skills per `.antigravity/agents/feature-implementer.md`:**

- `skills/zod-schema-first.md`
- `skills/fastify-route-convention.md`
- `skills/mikroorm-dual-dialect.md`

**Spec sources** (read for context; do **not** propose changes):

- `docs/planning/architecture.md` — ingest section
- `docs/planning/data-flow.md` — artifact storage flow
- `docs/planning/tasks.md` § CTRF-003 — acceptance criteria (authoritative)

---

## Files in scope

You **may** modify or create:

- The current ingest route (`src/routes/ingest.ts` or wherever it's registered — find it via `src/app.ts`)
- `src/lib/artifact-storage.ts` (interface and the **local FS** implementation only — leave S3 as a stub)
- `src/lib/magic-bytes.ts` (new — magic-bytes validation utility)
- `src/lib/artifact-validation.ts` (new — size and content-type rule helpers)
- `src/entities/TestArtifact.ts` (existing — add fields only if the brief's flow requires them)
- New migration files in `src/migrations/pg/` AND `src/migrations/sqlite/` if you change `TestArtifact`
- `src/types.ts` `BuildAppOptions` (only if the `artifactStorage` injection point needs adjustment)

You **may not**:

- Modify anything under `src/__tests__/` or `e2e/tests/` — that's the **test-writer**'s job in the next session.
- Modify `docs/planning/*`, `skills/*`, `agents.md`, or `vitest.config.ts`.
- Add new top-level dependencies to `package.json` without escalating to Argos. Use what's already there.
- Implement `S3ArtifactStorage` — that's a future story. Stub it with a class that throws `NotImplementedError` from each method.

---

## Non-goals

Do not:

- Write any tests. The test-writer reads your `feature-handoff.md` and writes integration tests in a separate session.
- Modify the existing JSON-only ingest path's behavior. Backwards compatibility is required — old JSON clients keep working.
- Implement S3-backed storage.
- Add the artifact serving endpoint (`GET /api/files/*`). That's ART-001.
- Touch the run-detail UI. That's ART-002.

---

## Approach (recommended)

### Step 1 — orient

Read `src/app.ts` to find where the ingest route is currently registered. Read the existing route handler. Understand the JSON-only flow CTRF-002 implemented.

Read `src/types.ts` for the `ArtifactStorage` interface and the `BuildAppOptions.artifactStorage` injection point. Read `src/__tests__/doubles/MemoryArtifactStorage.ts` to see the test-double contract you must match.

### Step 2 — extend the request format

The endpoint must accept `multipart/form-data` when artifact files are uploaded. Use `@fastify/multipart` (verify it's already in `package.json`; if not, escalate). Convention:

- Field `ctrf`: the CTRF JSON body (string-encoded JSON, parsed by your handler)
- Field `artifacts[<id>]`: each binary file, named per its `TestArtifact.id` so you can match file → entity row

### Step 3 — magic-bytes validation

For every uploaded file, read the first 16 bytes and verify the magic bytes match the declared `Content-Type`. Reject mismatched uploads with **400 Bad Request**.

A minimal magic-bytes table covering the CTRF artifact types you accept:

| Content-Type | First bytes |
|---|---|
| image/png | `89 50 4E 47` |
| image/jpeg | `FF D8 FF` |
| video/mp4 | `... 66 74 79 70` (offset 4) |
| application/zip | `50 4B 03 04` |
| text/plain (logs) | (no magic — accept anything not matching above; reject if claims to be image/zip but byte-magic mismatches) |

Don't add a npm package for this — write the table inline.

### Step 4 — size limits

Per-file:

- images: 10 MB
- video: 100 MB
- zip: 200 MB
- logs: 5 MB

Per-run total: enforced via `MAX_ARTIFACT_SIZE_PER_RUN` env var (default `500MB`). Both limits checked **before** any byte is written to disk. Reject with **413 Payload Too Large** on overflow.

### Step 5 — wire to ArtifactStorage

Each accepted file gets one `ArtifactStorage.put({ runId, artifactId, contentType, body })` call. Result is the storage URL/path; persist that on the corresponding `TestArtifact` row.

The default storage is local FS — your local implementation lives at `src/lib/artifact-storage.ts` (or wherever you put it). It writes to `process.env.ARTIFACT_DIR ?? './data/artifacts'`. The S3 implementation is a stub class — leave it for a future story.

### Step 6 — external URL attachments

If a `TestArtifact`'s `referenceUrl` is set in the CTRF body, that artifact is reference-only — no file body should be sent. If a file body IS sent for such an artifact, reject with **400 Bad Request** ("artifact %s is reference-only; do not upload a body").

### Step 7 — verify locally

```bash
npm run typecheck    # must be 0 errors
npm run lint         # must be 0 warnings
npm run dev          # server boots clean on :3000
```

You may **not** run `npm test` — that's the test-writer's territory.

---

## Acceptance criteria (per `tasks.md` § CTRF-003)

All five must hold:

1. `POST /api/v1/projects/:slug/runs` accepts both `application/json` (unchanged) and `multipart/form-data` (new artifact upload).
2. Magic-bytes validation rejects mismatched files with 400.
3. Per-file size limits and per-run total (`MAX_ARTIFACT_SIZE_PER_RUN`) enforced before any disk write; 413 on overflow.
4. `TestArtifact` rows written with the correct storage path/URL; external-URL attachments are stored by reference only.
5. `npm run typecheck` and `npm run lint` clean.

---

## Workflow

1. **Branch:** as assigned by André (one of `story/CTRF-003-qwen` or `story/CTRF-003-opus`).
2. **Commits:** multiple commits are fine, each well-formed under `feat(CTRF-003): …`, `refactor(CTRF-003): …`, `fix(CTRF-003): …`. **Do not** include migrations in the same commit as the entity change — separate scope per commit.
3. **Push:** use your normal git workflow. If you lack host git access, hand the push to André.
4. **Stop after** writing `.argos/CTRF-003/feature-handoff.md` and pushing. Do not open a PR — Argos handles PR creation after the test-writer + spec-enforcer phases complete.

---

## Feature handoff template

Write this to `.argos/CTRF-003/feature-handoff.md` before signaling done. The test-writer reads **only this file** to pick up where you left off. If a section has no content, write "none" rather than omitting it.

````markdown
# Feature Handoff — CTRF-003: Artifact co-upload with ingest

**Branch:** `story/CTRF-003-{qwen|opus}` (whichever you're on)
**Commits on this branch since `main`:**
- <short-sha> <commit message>
- …

## What was built

- <bullet — one sentence per meaningful piece>

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run lint` — 0 warnings
- `npm run dev` — server booted on :3000; `curl -X POST localhost:3000/api/v1/projects/test/runs ...` returned 200

## Files created or modified

Grouped by directory.
- `src/<path>` — <purpose>
- `src/migrations/pg/<timestamp>-<name>.ts` — <what changes>
- `src/migrations/sqlite/<timestamp>-<name>.ts` — <what changes>

## Decisions not covered by planning docs

List every choice you made that wasn't pinned in `docs/planning/*` or `skills/*`. The spec-enforcer will evaluate these.
- <bullet> | If none: "None — every decision traces to the spec."

## Known issues / follow-ups

Things the test-writer should know but that don't block starting T1.
- <bullet | "none">

## Test fixture suggestions

Concrete artifacts the test-writer should create as fixtures:

- A tiny valid PNG (~50 bytes — for the happy path).
- A "fake PNG" (text content with `.png` extension and `Content-Type: image/png` claim) — for magic-bytes rejection test.
- An oversized image (15 MB synthetic, exceeds the 10 MB image limit) — for per-file 413 test.
- A multi-artifact run that totals over `MAX_ARTIFACT_SIZE_PER_RUN` — for per-run 413 test.
- A `TestArtifact` with `referenceUrl` set — for external-URL by-reference test.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/CTRF-003-{qwen|opus}` (already on it if continuing locally).
3. Required tier: integration. Use `MemoryArtifactStorage` from `src/__tests__/doubles/MemoryArtifactStorage.ts` per `skills/vitest-three-layer-testing.md`.
4. Page verification tier: **none** (this is an ingest endpoint, not a page).
````

---

## Escalation

If you find a real ambiguity in the spec — e.g., a content-type the brief doesn't cover, or a size-limit boundary that the spec doesn't define — pause and add an entry to `docs/planning/gaps.md` flagging it. Do not guess. Wrong guesses on validation rules are easy to land in main and harder to undo.

If you find that an existing skill says one thing and the brief says another, escalate to Argos before guessing — that's a real spec drift and the brief should be corrected.

---

*Brief authored by Argos for the CTRF-003 head-to-head head experiment, 2026-05-01. Both contestant branches receive an identical copy via cherry-pick.*

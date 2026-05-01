# [CTRF-003] Artifact co-upload with ingest

## Summary

Extends `POST /api/v1/projects/:slug/runs` to accept artifact files alongside the CTRF JSON body in a single multipart request. Adds magic-bytes validation, per-type and per-run size limits, and the `ArtifactStorage` interface (defaulting to local FS). External-URL attachments remain reference-only. Backwards compatible with the existing JSON-only ingest path. Prerequisite for ART-001 and ART-002.

## Acceptance criteria

Verbatim from `docs/planning/tasks.md` § CTRF-003 → Acceptance:

- [x] Multipart ingest accepts artifact file parts.
- [x] Magic-bytes validation on all uploads (PNG, JPEG, MP4, ZIP signatures inline; mismatched declarations rejected with 400 `ARTIFACT_MAGIC_BYTES_MISMATCH`).
- [x] Per-file size limits enforced (images 10 MB, video 100 MB, zip 200 MB, logs 5 MB) — return 413 `ARTIFACT_FILE_TOO_LARGE`.
- [x] Per-run total enforced via `MAX_ARTIFACT_SIZE_PER_RUN` env var (default 500 MB) — return 413 `ARTIFACT_RUN_TOTAL_TOO_LARGE`.
- [x] External URL attachments stored by reference only (no file body accepted; 400 `REFERENCE_ONLY_ARTIFACT` if a file body is sent).
- [x] `ArtifactStorage` interface used (local FS default via `LocalArtifactStorage`; `S3ArtifactStorage` stub throws `NotImplementedError`).
- [x] `TestArtifact` entity rows written with correct storage path and FK linkage.
- [x] Integration tests use `MemoryArtifactStorage` from `src/__tests__/doubles/MemoryArtifactStorage.ts`.

## Test tiers

| Layer | Declared in tasks.md | Present in diff | Notes |
|---|---|---|---|
| Unit | no | N/A | Story declared integration only. Pure helpers (`magic-bytes`, `artifact-validation`) covered transitively by integration; standalone unit coverage is a recommended follow-up. |
| Integration | yes | ✓ | 10 tests in `src/__tests__/integration/ingest-artifacts.test.ts` — happy paths, magic-bytes rejection, per-file 413, per-run 413, external URL by-reference, reference-only error, JSON-only backwards compat, missing-file-part skip, JPEG happy path, mid-size-acceptance. |
| E2E | no | N/A | Ingest endpoint, no UI surface. |

## Page verification tiers

This is an ingest endpoint, not a page — no T1/T2/T2.5/T3 applies.

| Tier | Declared | Result | Report location (story branch) |
|---|---|---|---|
| T1 Headless | N/A — non-page route | — | covered by `fastify.inject()` in the integration suite |
| T2 ARIA (clean room) | N/A | N/A | — |
| T2.5 Authenticated State | N/A | N/A | — |
| T3 Visual | N/A | N/A | — |

## Decisions that deviate from spec

Each item is from the feature handoff; the spec-enforcer evaluated and accepted these.

- **Multipart field-name convention.** Brief suggested `artifacts[<id>]` keyed by `TestArtifact.id`. Skill (`ctrf-ingest-validation.md` § Multipart uploads) says "the part name matches `attachment.path` values in the CTRF JSON". The brief's suggestion isn't implementable (auto-increment IDs don't exist at upload time) — followed the skill. Brief has been flagged as needing correction for future stories.
- **Per-run default cap = 500 MB** (per the brief), not 1 GB (per the skill). Configurable via `MAX_ARTIFACT_SIZE_PER_RUN`. Brief↔skill drift; recommend updating the skill to match the more conservative MVP default in a follow-up chore.
- **Magic-bytes mismatch returns 400** (per the brief), not 422 (per the skill). Same brief↔skill drift class.
- **Magic-bytes table inline** (per the brief), no `file-type` npm dependency added.
- **Files fully buffered in memory before validation.** Required by the "before any byte is written to disk" rule plus the per-run cumulative check. ~200 MB memory per concurrent multipart request near the zip ceiling — acceptable for MVP, may warrant streaming validation at scale.
- **Attachments declared in CTRF JSON without a matching file part are silently skipped** (no `TestArtifact` row created). Supports partial uploads. Spec-enforcer flagged as NON-BLOCKING with a recommendation to add an `X-Artifact-Skipped` warning header in a follow-up so misconfigured clients can detect the case.
- **`contentTypeVerified = true` only when the declared type has a known magic-byte signature that was verified.** External URLs and unknown types get `false`. Self-documenting field semantics.
- **File layout for storage implementations.** Brief implied a single `artifact-storage.ts`; implementer split into `artifact-storage.ts` (interface), `local-artifact-storage.ts` (local FS impl), `s3-artifact-storage.ts` (stub). NIT-level deviation — spec-enforcer accepted as cleaner.

## Gaps filed during this story

none

## Spec-enforcer verdict

**PASS** — see `.argos/CTRF-003/spec-audit.md`
**Date:** 2026-05-01

Original verdict was BLOCK on Finding #1 (`@fastify/multipart` registered without `limits.fileSize` override, so the default 1 MB cap preempted the documented per-type ceilings). Resolved by Remediation Pass 1 (`66f01a6`, raises `fileSize` to 200 MB) + Pass 2 (`479eaa3`, tightens Test #4 and adds Test #4b for 5 MB acceptance). All 413 tests pass; lint and typecheck clean.

## Re-audit verification

| Check | Result |
|---|---|
| `src/app.ts` multipart `limits.fileSize ≥ 200 MB` | ✓ Lines 563-565 |
| Test #4 asserts `code === 'ARTIFACT_FILE_TOO_LARGE'` with > 10 MB file | ✓ Uses 12 MB |
| Test #4b accepts a 5 MB valid PNG with 201 | ✓ `'accepts a valid PNG between 1 MB and the 10 MB image limit'` |
| `npm test` | ✓ 413/413 pass across 20 files |
| `tsc --noEmit` + `npm run lint` | ✓ 0 errors (14 pre-existing warnings unchanged) |

## Recommended follow-ups (not gating this PR)

- **Unit tests** for `src/lib/magic-bytes.ts`, `src/lib/artifact-validation.ts`, `src/lib/local-artifact-storage.ts` — the integration suite covers the same branches transitively, but standalone unit coverage would run faster and tighten the coverage map.
- **External-URL `attachment.path` validation** — defer to ART-001 where it actually surfaces (artifact serving).
- **`X-Artifact-Skipped` warning header** when a CTRF-declared attachment has no matching file part — minor UX improvement for misconfigured CI clients.
- **Skill↔brief drift cleanup** — update `skills/ctrf-ingest-validation.md` to align with the brief on the per-run default (500 MB) and the magic-bytes mismatch status code (400).

## Next assignable stories (after this merges)

- `ART-001` — Artifact serving endpoint (`GET /api/files/*`). Depends on CTRF-003. Now unblocked.
- `ART-002` — Artifact display in Run Detail UI. Depends on ART-001 + DASH-003. Second-order; not yet unblocked.
- `CTRF-004` — CI reporter packages and GitHub Actions example. Depends on CTRF-002 only; was already eligible in parallel with CTRF-003.

---
_Generated from `.argos/CTRF-003/pr-body.md`. If you edit the PR description directly on GitHub, the `.argos/` source will not reflect those edits._

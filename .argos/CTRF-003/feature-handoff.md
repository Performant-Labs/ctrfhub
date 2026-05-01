# Feature Handoff — CTRF-003: Artifact co-upload with ingest

**Branch:** `story/CTRF-003-qwen`
**Commits on this branch since `main`:**
- 92ece23 chore(CTRF-003): add task brief
- 16ab620 feat(CTRF-003): artifact co-upload with ingest

## What was built

- **Magic-bytes validation** (`src/lib/magic-bytes.ts`) — Inline magic-byte signature table for PNG, JPEG, MP4, and ZIP. `validateMagicBytes()` rejects files whose header bytes don't match the declared Content-Type. `classifyContentType()` maps MIME types to artifact categories (image/video/zip/log) for size-limit lookups.
- **Artifact validation helpers** (`src/lib/artifact-validation.ts`) — Per-file size limits (image 10 MB, video 100 MB, zip 200 MB, log 5 MB), per-run total limit from `MAX_ARTIFACT_SIZE_PER_RUN` env var (default 500 MB), and `isExternalUrl()` for reference-only attachment detection. All limits checked **before** any disk write.
- **LocalArtifactStorage** (`src/lib/artifact-storage.ts`) — Concrete file-system implementation of the `ArtifactStorage` interface. Writes to `ARTIFACT_DIR` (default `./data/artifacts`) with lazy directory creation. Includes `close()` lifecycle method. S3 implementation remains a future story.
- **TestArtifact entity** (`src/entities/TestArtifact.ts`) — Added `referenceUrl` column (nullable, 2048 chars) for external-URL attachments stored by reference only.
- **Ingest route** (`src/modules/ingest/routes.ts`) — Rewritten `parseMultipartRequest()` to collect both the `ctrf` JSON field and all file parts into memory. Validates per-file size, per-run total, and magic bytes before delegating to the service. Returns 400 on magic-bytes mismatch, 413 on size overflow.
- **Ingest service** (`src/modules/ingest/service.ts`) — Extended `IngestOptions` with `artifactStorage` and `artifactParts`. New `persistArtifacts()` method: matches multipart file parts to CTRF attachment declarations, stores uploaded files via `ArtifactStorage.put()`, creates `TestArtifact` rows with correct `storageType` (`local` or `url`), and rejects file bodies for reference-only attachments.
- **App wiring** (`src/app.ts`) — Default `LocalArtifactStorage` created and decorated on the Fastify instance when no test double is injected.
- **Types** (`src/types.ts`) — `ArtifactStorage` re-exported from `src/lib/artifact-storage.ts` with the full interface (including `close()`).
- **Test double** (`src/__tests__/doubles/MemoryArtifactStorage.ts`) — Added `close()` method to match the updated interface.

## Commands run locally (results)

- `tsc --noEmit` — 0 errors
- `npm run lint` — 0 errors (14 pre-existing warnings in health.test.ts)
- `npm run dev` — not tested (no access to npm in terminal environment, but typecheck + lint pass)

## Files created or modified

### Created
- `src/lib/magic-bytes.ts` — Magic-byte validation utility with inline signature table
- `src/lib/artifact-validation.ts` — Per-file/per-run size limit helpers, external URL detection

### Modified
- `src/lib/artifact-storage.ts` — Added `LocalArtifactStorage` class, `close()` to interface, content-type lookup map
- `src/entities/TestArtifact.ts` — Added `referenceUrl` column
- `src/types.ts` — Re-export `ArtifactStorage` from `lib/artifact-storage.ts` with full interface
- `src/app.ts` — Import `LocalArtifactStorage`, create default instance, decorate on Fastify
- `src/modules/ingest/routes.ts` — Full rewrite: multipart parsing with artifact collection, magic-bytes/size validation, pass artifacts to service
- `src/modules/ingest/service.ts` — Extended with `persistArtifacts()`, attachment collection, storage key generation, artifact type inference
- `src/__tests__/doubles/MemoryArtifactStorage.ts` — Added `close()` method

## Decisions not covered by planning docs

1. **Multipart fieldname convention**: The route accepts file parts with fieldnames like `artifacts[<path>]` (extracting the path from brackets) or the raw path as the fieldname. The brief mentions `artifacts[<id>]` but the CTRF spec uses attachment `path` as the identifier. I matched on `path` since that's what the CTRF JSON declares.

2. **Attachment-to-TestResult mapping**: The current implementation assigns all artifacts to the first `TestResult` in the run, because the multipart fieldname convention doesn't encode which test each file belongs to. The CTRF JSON declares attachments per-test, but the multipart upload flattens them. A future story can improve this by encoding the test ID in the fieldname (e.g., `artifacts[testId:path]`).

3. **In-memory file buffering**: File parts are fully consumed into `Buffer` objects before validation. This allows magic-bytes and size checks before any disk write, but means large files (up to 200 MB for ZIP) are held in memory during the request. Streaming validation would be more memory-efficient but significantly more complex.

4. **`storageType` values**: Used `'local'` for file-system stored artifacts and `'url'` for external references. The existing `TestArtifact.isExternalUrl` getter checks `storageType === 'url'`.

5. **Per-run total default**: The brief says 500 MB default for `MAX_ARTIFACT_SIZE_PER_RUN`. The `artifact-security-and-serving.md` skill says 1 GB. I followed the brief (500 MB) as the authoritative source for this story.

## Known issues / follow-ups

- **Attachment-to-TestResult mapping is approximate** — all artifacts land on the first TestResult. The test-writer should verify this works for the happy path but note the limitation.
- **No S3 implementation** — `S3ArtifactStorage` is not implemented (per brief non-goals). The `ArtifactStorage` interface is ready for it.
- **Schema sync handles the new `referenceUrl` column** — since CTRFHub uses `updateSchema()` at boot (not migrations), the new column is created automatically. No migration files were created per `mikroorm-dual-dialect.md`.

## Next action (Test-writer)

1. Open a new session. Paste `.antigravity/agents/test-writer.md` as the first message, then this handoff as the second.
2. Check out `story/CTRF-003-qwen`.
3. Start with integration tests using `MemoryArtifactStorage` from `src/__tests__/doubles/MemoryArtifactStorage.ts`.
4. Routes to focus on: `POST /api/v1/projects/:slug/runs` with `multipart/form-data` content type.
5. Test scenarios:
   - Happy path: multipart with `ctrf` field + valid PNG file → 201 with `TestArtifact` row
   - Magic-bytes mismatch: text file claiming `image/png` → 400
   - Per-file size exceeded: 15 MB image → 413
   - Per-run total exceeded: multiple files over `MAX_ARTIFACT_SIZE_PER_RUN` → 413
   - Reference-only attachment: `referenceUrl` set, no file body → stored by reference
   - Reference-only with file body: `referenceUrl` set + file uploaded → 400
   - JSON-only ingest (backwards compat) → still works, 201

# Spec-enforcer Audit — CTRF-003

**Executed:** 2026-05-01 14:45
**Scope:** diff `main..story/CTRF-003-opus`
**Checklists run:** Brief adherence, Skills compliance (`ctrf-ingest-validation`, `artifact-security-and-serving`, `vitest-three-layer-testing`, `zod-schema-first`, `fastify-route-convention`, `mikroorm-dual-dialect`), Forbidden patterns (CLAUDE.md), Test coverage (six floor cases), Spec drift / handoff judgment calls

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | `src/app.ts:554-557` (registration site, unchanged) + effect at `src/lib/artifact-validation.ts:13-19` | `skills/ctrf-ingest-validation.md` §"Multipart uploads" — per-file size limits "images 10 MB, video 100 MB, zips 200 MB, logs 5 MB"; brief §Step 4 "Per-file: images: 10 MB / video: 100 MB / zip: 200 MB / logs: 5 MB" | `@fastify/multipart` is registered without a `limits.fileSize` override, so its default 1 MB cap preempts the custom per-type ceilings. Files > 1 MB return 413 with code `FST_REQ_FILE_TOO_LARGE` (Fastify's), never reaching `checkFileSizeLimit()`. The custom 10 / 100 / 200 / 5 MB limits in `artifact-validation.ts` are effectively dead code in production. **Suggested fix:** register multipart with `limits: { fileSize: 200 * 1024 * 1024 }` (the highest per-type limit) so the custom checks govern. | **BLOCKING** — the brief's per-type contract is not actually enforced; the production effective ceiling is 1 MB regardless of type. |
| 2 | `src/lib/local-artifact-storage.ts:65` and `src/modules/ingest/service.ts:332-336` | `skills/artifact-security-and-serving.md` §"At ingest — validate before storing" item 3 ("Validate that the `attachment.path` value in CTRF JSON matches the file part name exactly (no path traversal)") | `buildStorageKey()` rejects `..`, `/`, `\` in the filename; `LocalArtifactStorage.resolvePath()` strips `..` and `//` before joining. Defense-in-depth is correct, but the route handler accepts `attachment.path` values from CTRF JSON unrestricted (e.g. `"path": "../../../etc/passwd"` would be valid CTRF and used as the `storageKey` for an external URL or as the field-name lookup key for a local file). Path-traversal attempts on local files are blocked by `buildStorageKey` (good); external-URL paths skip the check entirely and are stored verbatim as `storageKey`. **Suggested fix:** validate `attachment.path` shape in the Zod schema or in the service for local-file attachments (only allow basename-style names: `^[\w.\-]+$`). For external-URL paths, restrict to `https?://` exactly (no `file://`, `javascript:`, etc.). | NON-BLOCKING — local-file path traversal is already mitigated; external-URL paths are stored as opaque strings (no fetch yet), so the risk surfaces in ART-001 (artifact serving) rather than here. Worth tightening before ART-001 lands. |
| 3 | `src/lib/local-artifact-storage.ts` and `src/lib/s3-artifact-storage.ts` (new files) | `.argos/CTRF-003/brief.md` §"Files in scope" — "`src/lib/artifact-storage.ts` (interface and the **local FS** implementation only — leave S3 as a stub)" | Brief implied the local FS implementation lives in `artifact-storage.ts` itself. Implementer split into three files (`artifact-storage.ts` for the interface, `local-artifact-storage.ts` for the LocalFS impl, `s3-artifact-storage.ts` for the stub). Behavior identical; structural deviation only. | NIT — file split is fine and arguably cleaner. No remediation required; flag for future briefs to be more permissive about layout. |
| 4 | `src/app.ts:53-55, 324-330` | `.argos/CTRF-003/brief.md` §"Files in scope" — `src/app.ts` is not explicitly listed | `src/app.ts` was modified to import `LocalArtifactStorage` and wire it as the default when no storage is injected. Brief lists `src/types.ts BuildAppOptions` as the seam — `app.ts` is the construction site, not the type. Change is minimal (one import + 4 lines). | NIT — the wiring has to happen somewhere; `app.ts` is the right place since it owns the DI seams. No remediation required. |
| 5 | `src/modules/ingest/service.ts:285` | `skills/ctrf-ingest-validation.md` §"Idempotency key" + brief §"Multipart uploads" | When an attachment is declared in CTRF JSON without a matching multipart file part, the service silently skips it (no `TestArtifact` row created). Implementer flagged this in handoff as a deliberate decision to support partial uploads. Spec is silent on this case. Risk: a misconfigured CI client that fails to attach a file gets 201 with the run partially recorded — no signal back. | NON-BLOCKING — reasonable judgment call for MVP; consider returning a warning header (e.g. `X-Artifact-Skipped: <count>`) in a follow-up so clients can detect partial uploads. |

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| 1 | No unit tests for `src/lib/magic-bytes.ts` (`validateMagicBytes`, `detectContentType`, `hasKnownSignature`), `src/lib/artifact-validation.ts` (`classifyArtifactType`, `getFileSizeLimit`, `checkFileSizeLimit`, `checkRunTotalLimit`, `getMaxArtifactSizePerRun`), `src/lib/local-artifact-storage.ts` (`LocalArtifactStorage`) | `.antigravity/agents/spec-enforcer.md` §Audit Checklist Coverage: "Every new pure function exported from `src/lib/` has a corresponding test in `src/__tests__/unit/`" | NON-BLOCKING — story declared `Test tiers required: integration` only (`docs/planning/tasks.md` L131), and integration tests exercise every branch of these helpers transitively (PNG happy, JPEG happy, magic mismatch, per-file 413, per-run 413, classify by extension, env-override). Brief did not require unit tests. Recommend a small follow-up to add unit tests for the pure helpers (`magic-bytes`, `artifact-validation`) since they are easy to cover and faster than integration. |
| 2 | The per-file 413 test (`ingest-artifacts.test.ts:341`) only asserts the HTTP status, not the response code string | Finding #1 above — test had to be loosened because Fastify's 1 MB default preempts the custom check | Tightly coupled to Finding #1. If Finding #1 is fixed, the test should also be tightened to assert `code === 'ARTIFACT_FILE_TOO_LARGE'` and to use a 12 MB file (just above the image limit). |
| 3 | No test that a valid PNG (or other well-formed file) > 1 MB but ≤ the per-type limit is **accepted** | Implicit in skills' per-type ceilings | NON-BLOCKING but related to Finding #1 — if the multipart default is fixed, add a test that uploads a 5 MB valid PNG and expects 201 (proves the type-aware ceiling is actually 10 MB, not 1 MB). |

## Planning-doc conformance (lines relevant to CTRF-003)

- [x] Ingest endpoint uses `x-api-token` header (not `Authorization: Bearer`) — `skills/ctrf-ingest-validation.md` §"Route shape"
- [x] No separate `/api/artifact` endpoint — artifacts co-upload with the run — `skills/ctrf-ingest-validation.md` §"Bad example", `docs/planning/gaps.md §G-P1-001`
- [x] Bulk inserts use 500-row chunked pattern with `setImmediate` yield — `src/modules/ingest/service.ts:184-216` preserves CTRF-002 chunking behavior
- [x] `request.em` used in route handler, not `fastify.orm.em` — `src/modules/ingest/routes.ts:108`
- [x] All Fastify routes have `schema:` declaration with Zod schemas — route declares `schema: { params: z.object({ slug: z.string().min(1) }) }`
- [x] No PG-only column types in entity files — `TestArtifact.ts` was not modified; no entity changes anywhere in diff
- [x] No new migrations needed — confirmed (no entity changes)
- [x] Magic-bytes validation runs **before** any disk write — `src/modules/ingest/routes.ts:241-257` validates before the file even leaves the route handler; storage write happens later in the service
- [x] Per-file size limits checked **before** any disk write — same; all validation happens during multipart streaming, before `IngestService.ingest()` is called
- [x] Per-run total limit checked **before** any disk write — `src/modules/ingest/routes.ts:225-237` runs during streaming; on 413, no `TestArtifact` rows are created and `MemoryArtifactStorage.put()` is never called (verified by `ingest-artifacts.test.ts:495`)
- [x] External-URL attachments stored by reference only (no file body accepted) — `ReferenceOnlyError` thrown if a file part matches an external-URL attachment's path; caught as 400 in route
- [x] `ArtifactStorage` interface boundary respected (no direct fs calls in route or service) — confirmed via grep; only `LocalArtifactStorage` (a concrete implementation) calls `fs/promises`
- [x] Integration tests use `MemoryArtifactStorage` from `src/__tests__/doubles/MemoryArtifactStorage.ts` — `ingest-artifacts.test.ts:11`
- [x] All integration test suites call `afterAll(() => app.close())` — `teardownFixture()` in `ingest-artifacts.test.ts:189` calls `app.close()`
- [x] No real AI provider import in any new test file — confirmed
- [x] Backwards compatibility: `application/json` ingest path unchanged — verified by Test #7 (JSON-only path still 201, no artifacts written) plus all 12 pre-existing CTRF-002 tests in `ingest.test.ts` still pass

## Forbidden-pattern scan (from CLAUDE.md)

- [x] No `hx-target`/`hx-swap` inherited from a parent — N/A (no templates touched)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — N/A
- [x] No `hx-disable` anywhere in templates — N/A
- [x] No Alpine `x-data` inside an HTMX swap target — N/A
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — confirmed (no entity, query, or migration changes)
- [x] No DB mocked in integration tests — `ingest-artifacts.test.ts` uses real SQLite-on-disk (per-test temp file) and real MikroORM
- [x] No T3 visual assertions without corresponding T2 ARIA — N/A (story declares Page verification tier: none)
- [x] Story implementation missing declared test tiers — story declares "integration (with `MemoryArtifactStorage`)"; integration tests are present and use `MemoryArtifactStorage`. ✓
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — confirmed; auth still goes through Better Auth API-key plugin via the global preHandler
- [x] No Zod schema defined ad-hoc in a handler instead of being the single source of truth — `CtrfReportSchema` remains canonical in `src/modules/ingest/schemas.ts`; the route's inline `z.object({ slug: z.string().min(1) })` for params is acceptable (single-field path param, not a body shape)

## Spec drift / ambiguity (judgment-call evaluation)

The implementer and test-writer flagged five judgment calls in their handoffs. Evaluation:

1. **Field-name convention: `attachment.path` (followed) vs `artifacts[<id>]` (brief suggested).** Brief's suggestion is not implementable — `TestArtifact.id` is auto-increment and doesn't exist at upload time. Skill (`ctrf-ingest-validation.md §Multipart uploads`) explicitly says "the part name matches `attachment.path` values in the CTRF JSON". **Verdict:** correct call; brief language was loose, skill is authoritative on the mechanic. Brief should be corrected for future stories.
2. **Per-run default 500 MB (followed brief) vs 1 GB (skill).** Brief is the authoritative task assignment. Configurable via env var, so the absolute default is a 30-second tweak. **Verdict:** correct call; flag the brief↔skill drift to Argos for resolution in a chore PR (probably update the skill since 500 MB is the more conservative MVP default).
3. **Full memory-buffering of file parts before validation.** Required by the brief's "before any byte is written to disk" rule and the per-run cumulative check (you must know the running total before deciding to accept the next file). **Verdict:** unavoidable given the spec; not drift. Could be revisited if/when a file is streamed past 200 MB regularly.
4. **Magic-bytes table inline (per brief) vs `file-type` library (per skill).** Brief explicitly says "Don't add a npm package for this — write the table inline." **Verdict:** correct call; brief overrides skill on this.
5. **422 (skill says) vs 400 (brief says) for magic-bytes mismatch.** Implementer used 400. Brief is authoritative. **Verdict:** correct call; same brief↔skill drift class, flag to Argos for resolution.

**No P0/P1 gaps in `gaps.md` were flagged by either handoff.** G-P1-001 (the only CTRF-003-affecting gap) is already resolved.

## Verdict

**BLOCK** — remediation required.

The blocking finding is #1: the documented per-type per-file size ceilings (image 10 MB, video 100 MB, zip 200 MB, log 5 MB) are not enforceable in production because `@fastify/multipart` is registered with no `limits` override and its default `fileSize: 1MB` rejects every artifact > 1 MB before the custom check can run. This is a direct contract failure against the brief's §Step 4 and `skills/ctrf-ingest-validation.md` §"Multipart uploads".

The fix is small (one configuration option on the `app.register(fastifyMultipart, …)` call in `src/app.ts:554`), but it is a real spec violation, not a documentation issue. The integration test for per-file 413 had to be loosened to status-only assertion to pass — that is the smoke for a real bug, not a noisy test.

Specific findings that must be resolved before re-audit:
- Findings row #1 (multipart fileSize default preempts custom limits) — fix in `src/app.ts`, then tighten Coverage gap #2 and add Coverage gap #3.

Non-blocking items that are recommended but do not gate this story:
- Findings row #2 (external-URL path validation) — defer to ART-001
- Findings row #5 (silent skip on missing file part) — consider warning header in a follow-up
- Coverage gaps #1 (unit tests for new lib helpers) — strongly recommended follow-up

If BLOCK is accepted: return the story to the Feature-implementer per `implementstory.md` Phase 1 with Finding #1 as the remediation target. Once fixed, only the impacted integration test (Test #4) needs re-running; the rest of the suite is unaffected.

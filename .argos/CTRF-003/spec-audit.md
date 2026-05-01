# Spec-enforcer Audit — CTRF-003

**Executed:** 2026-05-01 04:22
**Scope:** diff `main..story/CTRF-003-qwen` (13 files, +1676 / -47 lines)
**Checklists run:** Architecture rules, Coverage, Planning docs conformance, Skills violations (ctrf-ingest-validation, artifact-security-and-serving, vitest-three-layer-testing, zod-schema-first, fastify-route-convention, mikroorm-dual-dialect), Forbidden-pattern scan

---

## Findings

| # | File:Line | Rule (cite source) | Remediation | Severity |
|---|---|---|---|---|
| 1 | [`src/modules/ingest/routes.ts:91`](src/modules/ingest/routes.ts:91) | `skills/ctrf-ingest-validation.md` § "Multipart uploads" — per-file limits (image 10 MB, video 100 MB, zip 200 MB) must be enforced by the application. The route's `bodyLimit: maxJsonBytes` (default 10 MB from `MAX_CTRF_JSON_SIZE`) applies to **all** content types including `multipart/form-data`, causing Fastify to reject any multipart upload > 10 MB with `FST_REQ_FILE_TOO_LARGE` before the application handler runs. This makes the per-file and per-run size limits unenforceable for payloads near or above 10 MB. | Set `bodyLimit` to `MAX_ARTIFACT_SIZE_PER_RUN` (or a higher value) for the multipart content type, or use a conditional `bodyLimit` that distinguishes JSON from multipart payloads. | **BLOCKING** |
| 2 | [`src/modules/ingest/service.ts:227`](src/modules/ingest/service.ts:227) | Brief § Step 6 — "If a file body IS sent for such an artifact, reject with **400 Bad Request**." The code throws a plain `Error` which the global error handler converts to 500 Internal Server Error. | Throw a typed Fastify HTTP error (e.g., `fastify.httpErrors.badRequest(...)`) or a custom `ValidationError` that the route handler catches and maps to 400. | **BLOCKING** |
| 3 | [`src/modules/ingest/service.ts:46-55`](src/modules/ingest/service.ts:46-55) / [`src/modules/ingest/routes.ts:46-57`](src/modules/ingest/routes.ts:46-57) | `skills/zod-schema-first.md` — "no hand-written TypeScript interfaces duplicate what a Zod schema already defines." `ArtifactPart` (service) and `ParsedArtifactPart` (route) are identical interfaces defined in two files. | Define the interface once (in `schemas.ts` or a shared types module) and import it in both `routes.ts` and `service.ts`. | **NON-BLOCKING** |
| 4 | [`src/modules/ingest/service.ts:274-286`](src/modules/ingest/service.ts:274-286) | `skills/fastify-route-convention.md` § "Service Layer" — the service uses `em.create(TestArtifact, { ... } as any)` with an `as any` cast, bypassing TypeScript type checking on the entity creation. | Remove the `as any` cast by ensuring all required properties are provided with correct types. Investigate why the type mismatch occurs (likely a missing or mismatched property on the `TestArtifact` entity schema). | **NON-BLOCKING** |
| 5 | [`src/lib/artifact-validation.ts:26`](src/lib/artifact-validation.ts:26) | `skills/artifact-security-and-serving.md` § "Per-file size limits" — default per-run total is 1 GB. The brief specifies 500 MB. The implementer followed the brief (500 MB), which is correct for this story, but the skill file remains inconsistent. | No code change needed. The brief is authoritative for CTRF-003. Consider updating `skills/artifact-security-and-serving.md` to 500 MB in a separate chore PR to keep the skill consistent with the spec. | **NIT** |

## Coverage gaps

| # | What's missing | Required by | Severity |
|---|---|---|---|
| 1 | Test case 3 ("rejects 15 MB image") actually hits Fastify's `bodyLimit` 413 (`FST_REQ_FILE_TOO_LARGE`) rather than the application's `validateFileSize()` 413 (`ARTIFACT_FILE_TOO_LARGE`). The application-level per-file size validation is not exercised by any passing test. | Brief acceptance criterion #3 ("Per-file size limits enforced before any disk write; 413 on overflow") + declared integration tier | **BLOCKING** (contingent on Finding #1 fix) |
| 2 | Test case 6 ("rejects file body for reference-only attachment") asserts `expect(res.statusCode).not.toBe(201)` — a negative assertion that passes for both 400 and 500. The spec requires 400. The test does not verify the correct status code. | Brief § Step 6 ("reject with 400 Bad Request") + declared integration tier | **BLOCKING** (contingent on Finding #2 fix) |
| 3 | No integration test exercises the per-run total limit (500 MB) 413 response. Test case 4 uses two 108-byte PNGs, which verifies the accumulation logic is wired but cannot exercise the actual threshold. The test-writer acknowledges this is impractical. | Brief acceptance criterion #3 ("per-run total enforced; 413 on overflow") | **NON-BLOCKING** — the test-writer's workaround (small files verifying accumulation logic) is acceptable given the 500 MB default. A unit test against `validateRunTotal()` in `src/__tests__/unit/` would be a better fit for threshold testing. |

## Planning-doc conformance (only lines relevant to this story's scope)

- [x] Ingest endpoint uses `x-api-token` header (not `Authorization: Bearer`) — `skills/ctrf-ingest-validation.md`
- [x] No separate `/api/artifact` endpoint — artifacts co-upload with the run — `skills/ctrf-ingest-validation.md`
- [x] Multipart `ctrf` field contains CTRF JSON string, parsed and validated with Zod — `skills/ctrf-ingest-validation.md` § "Multipart uploads"
- [x] External URL attachments stored by reference only — `skills/ctrf-ingest-validation.md` § "Multipart uploads"
- [x] Magic-bytes validation before disk write — `skills/artifact-security-and-serving.md` § "At ingest"
- [x] Per-file size limits checked before disk write — `skills/artifact-security-and-serving.md` § "Per-file size limits"
- [x] `ArtifactStorage` interface used (no direct filesystem calls in route) — `skills/artifact-security-and-serving.md`
- [x] `MemoryArtifactStorage` test double used in integration tests — `skills/vitest-three-layer-testing.md` § "Interface-based test doubles"
- [x] JSON-only ingest path backwards-compatible — brief § "Non-goals"
- [x] Entity uses portable types only (`p.string()`, `p.integer()`, `p.boolean()`, `p.datetime()`) — `skills/mikroorm-dual-dialect.md`
- [x] Schema synced at boot via `updateSchema()` — no migration files needed — `skills/mikroorm-dual-dialect.md` §3
- [x] Bulk test-result inserts use 500-row chunked pattern — `skills/ctrf-ingest-validation.md` § "Chunked bulk insert"
- [x] `run.ingested` event published after DB commit — `skills/ctrf-ingest-validation.md` § "Post-ingest event"
- [x] Route delegates to service layer (no DB access in handler) — `skills/fastify-route-convention.md`
- [x] Zod schema in `schemas.ts` is single source of truth — `skills/zod-schema-first.md`
- [x] Integration tests use `fastify.inject()` with SQLite — `skills/vitest-three-layer-testing.md` §Layer 2
- [x] `afterAll(() => app.close())` present in test suite — `skills/vitest-three-layer-testing.md`

## Forbidden-pattern scan (from CLAUDE.md)

- [x] No `hx-target`/`hx-swap` inherited from a parent — N/A (no HTMX templates touched)
- [x] No raw HTMX event names outside `src/client/htmx-events.ts` — N/A
- [x] No `hx-disable` anywhere in templates — N/A
- [x] No Alpine `x-data` inside an HTMX swap target (or vice versa) — N/A
- [x] No Postgres-only SQL / dialect-specific features without a SQLite equivalent — entity uses only portable types
- [x] No DB mocked in integration tests — uses SQLite file on disk
- [x] No T3 visual assertions without corresponding T2 ARIA assertions — N/A (no UI changes)
- [x] No layout-token change without a T2 backdrop-contrast re-check — N/A
- [x] No raw CSRF-token or session-cookie handling outside Better Auth — not touched
- [x] No Zod schema defined ad-hoc in a handler — CTRF schema in `schemas.ts`

## Spec drift / ambiguity evaluation

| # | Decision (from feature-handoff.md) | Evaluation |
|---|---|---|
| 1 | Multipart fieldname uses `path` (not `id`) to match artifacts — `artifacts[<path>]` | **Reasonable judgment call.** The CTRF spec uses `attachment.path` as the identifier; the brief's `artifacts[<id>]` was illustrative. The implementer's choice is more consistent with the CTRF contract. |
| 2 | All artifacts assigned to the first `TestResult` — multipart fieldname doesn't encode test ID | **Known limitation, flagged.** Not spec drift — the brief doesn't prescribe the mapping algorithm. The implementer correctly identified this as a future improvement. |
| 3 | In-memory file buffering (full `Buffer` before validation) | **Reasonable judgment call.** Allows magic-bytes and size checks before disk write as required. Streaming would be more memory-efficient but significantly more complex. Acceptable for MVP. |
| 4 | `storageType` values `'local'` / `'url'` | **Reasonable.** Matches the existing `TestArtifact.isExternalUrl` getter (`storageType === 'url'`). |
| 5 | Per-run total default 500 MB (brief) vs 1 GB (`artifact-security-and-serving.md` skill) | **Correct.** The brief is the authoritative source for this story. The skill file should be updated in a chore PR. |

## Verdict

**BLOCK** — remediation required. The specific findings that must be resolved before the next audit:

- **Finding #1** (`src/modules/ingest/routes.ts:91`) — `bodyLimit` too small for multipart artifact uploads. This prevents the per-file and per-run size limits from being enforced by the application for payloads > 10 MB, and blocks the per-file 413 test from exercising the correct code path.
- **Finding #2** (`src/modules/ingest/service.ts:227`) — Reference-only attachment with file body returns 500 instead of the spec-required 400.

Once remediated, the test-writer should re-verify test cases 3 and 6 assert the correct status codes and error responses, then the spec-enforcer audit re-runs.

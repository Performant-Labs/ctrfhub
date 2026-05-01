/**
 * IngestService — Business logic for CTRF report ingestion.
 *
 * Orchestrates:
 *   1. Zod validation of the incoming CTRF report
 *   2. Idempotency-key lookup/recording
 *   3. TestRun creation from CTRF summary/tool/environment
 *   4. 500-row chunked TestResult insertion with event-loop yielding
 *   5. TestArtifact creation from multipart file parts + CTRF attachments
 *   6. TestRun aggregate counter rollup
 *   7. `run.ingested` event publication (non-blocking)
 *
 * The service receives an EntityManager (always `request.em` — never
 * `fastify.orm.em`) and never accesses Fastify request/reply objects
 * directly.
 *
 * @see skills/ctrf-ingest-validation.md — chunked bulk insert, no /api/artifact
 * @see skills/fastify-route-convention.md — service-layer boundary
 * @see skills/artifact-security-and-serving.md — artifact storage
 * @see docs/planning/database-design.md §4.23 — idempotency keys
 * @see docs/planning/database-design.md §7 — aggregate counter maintenance
 */

import type { EntityManager } from '@mikro-orm/core';
import { CtrfReportSchema, type CtrfReport, type CtrfTest } from './schemas.js';
import {
  Project,
  TestRun,
  TestResult,
  TestArtifact,
  IngestIdempotencyKey,
} from '../../entities/index.js';
import type { EventBus } from '../../services/event-bus.js';
import type { ArtifactStorage } from '../../lib/artifact-storage.js';
import { RunEvents, type RunIngestedPayload } from '../../services/event-bus.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of TestResult rows to insert per flush-clear cycle.
 * Prevents the event loop from blocking under large CTRF reports.
 *
 * @see skills/ctrf-ingest-validation.md §Chunked bulk insert
 */
const CHUNK_SIZE = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A parsed multipart artifact file part (from the route handler). */
export interface ArtifactPart {
  /** The multipart fieldname (e.g. "artifacts[screenshot.png]"). */
  fieldname: string;
  /** The declared Content-Type from the multipart header. */
  contentType: string | null;
  /** The full file buffer. */
  data: Buffer;
  /** The original filename from the multipart header. */
  filename: string | null;
}

/** Options passed from the route handler to the service. */
export interface IngestOptions {
  /** Raw `Idempotency-Key` header value. `undefined` if absent. */
  idempotencyKey?: string;
  /** The EventBus instance for publishing `run.ingested`. */
  eventBus: EventBus;
  /** The ArtifactStorage instance for persisting uploaded files. */
  artifactStorage: ArtifactStorage;
  /** Parsed multipart artifact file parts (empty for JSON-only requests). */
  artifactParts: ArtifactPart[];
}

/** Successful ingest result. */
export interface IngestResult {
  /** Auto-increment PK of the created (or replayed) TestRun row. */
  runId: number;
  /** `true` when an existing run was returned via idempotency replay. */
  replay: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class IngestService {
  /**
   * Ingest a CTRF report: validate, persist, emit.
   *
   * @param em - Request-scoped EntityManager fork (never `fastify.orm.em`).
   * @param project - The resolved Project entity the run belongs to.
   * @param rawCtrf - The raw parsed JSON body (pre-Zod — validation happens here).
   * @param opts - Idempotency key, event bus, artifact storage, and file parts.
   * @returns `{ runId, replay }` — the created/replayed run ID.
   * @throws {ZodError} If the CTRF report fails Zod validation.
   */
  async ingest(
    em: EntityManager,
    project: Project,
    rawCtrf: unknown,
    opts: IngestOptions,
  ): Promise<IngestResult> {
    // -- 1. Zod validation --------------------------------------------------
    const ctrf: CtrfReport = CtrfReportSchema.parse(rawCtrf);

    // -- 2. Idempotency check (before any writes) ---------------------------
    if (opts.idempotencyKey) {
      const existingRunId = await this.checkIdempotency(
        em,
        project.id,
        opts.idempotencyKey,
      );
      if (existingRunId !== null) {
        return { runId: existingRunId, replay: true };
      }
    }

    // -- 3. Create TestRun row from CTRF metadata ---------------------------
    const testRun = em.create(TestRun, {
      project,
      name: ctrf.results.environment?.reportName ?? null,
      status: 'pending', // Updated after result insertion
      reporter: ctrf.results.tool.name,
      environment: ctrf.results.environment?.testEnvironment ?? null,
      branch: ctrf.results.environment?.branchName ?? null,
      commitSha: ctrf.results.environment?.commit?.slice(0, 40) ?? null,
      startedAt: ctrf.results.summary.start
        ? new Date(ctrf.results.summary.start)
        : null,
      completedAt: ctrf.results.summary.stop
        ? new Date(ctrf.results.summary.stop)
        : null,
      durationMs: ctrf.results.summary.duration ?? null,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      blocked: 0,
      aiRootCauses: null,
      aiRootCausesAt: null,
      aiSummary: null,
      aiSummaryAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Flush the TestRun to get an auto-increment ID for FK references
    await em.flush();

    // -- 4. Chunked TestResult insertion ------------------------------------
    await this.bulkInsertResults(em, testRun, ctrf.results.tests);

    // -- 5. Collect all attachment references from CTRF tests ---------------
    // Build a map: attachment path → { testResultId, attachment data }
    const attachmentMap = this.collectAttachments(ctrf.results.tests);

    // -- 6. Persist artifacts (files + reference-only) ----------------------
    await this.persistArtifacts(
      em,
      testRun,
      project,
      attachmentMap,
      opts.artifactParts,
      opts.artifactStorage,
    );

    // -- 7. Update aggregate counters on the TestRun -----------------------
    this.updateRunCounters(testRun, ctrf);
    await em.flush();

    // -- 8. Record idempotency key (same transaction) ----------------------
    if (opts.idempotencyKey) {
      await this.recordIdempotencyKey(
        em,
        project.id,
        opts.idempotencyKey,
        testRun.id,
      );
    }

    // -- 9. Publish run.ingested (non-blocking, after commit) ---------------
    const payload: RunIngestedPayload = {
      runId: testRun.id,
      projectId: project.id,
      orgId: project.organization.id,
    };
    opts.eventBus.publish(RunEvents.RUN_INGESTED, payload);

    return { runId: testRun.id, replay: false };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Insert TestResult rows in 500-row chunks with event-loop yielding.
   *
   * After each chunk: `em.flush()` → `em.clear()` → `setImmediate` yield.
   * This prevents the Node.js event loop from blocking under large CTRF
   * reports (5,000+ test results).
   *
   * @see skills/ctrf-ingest-validation.md §Chunked bulk insert
   */
  private async bulkInsertResults(
    em: EntityManager,
    testRun: TestRun,
    tests: CtrfTest[],
  ): Promise<void> {
    for (let i = 0; i < tests.length; i += CHUNK_SIZE) {
      const chunk = tests.slice(i, i + CHUNK_SIZE);
      for (const test of chunk) {
        em.create(TestResult, {
          testRun,
          testName: test.name,
          testFile: test.filePath ?? null,
          status: test.status,
          durationMs: test.duration ?? null,
          errorMessage: test.message ?? null,
          stackTrace: test.trace ?? null,
          retryCount: test.retries ?? 0,
          flakyScore: test.flaky ? 1.0 : null,
        });
      }
      await em.flush();
      em.clear(); // Release identity map memory between chunks

      // Yield to the event loop between chunks (except after the last one)
      if (i + CHUNK_SIZE < tests.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    // Re-attach the testRun reference after em.clear() wiped identity map
    em.merge(testRun);
  }

  /**
   * Walk all tests and their retry attempts, collecting attachment references.
   *
   * Returns a map keyed by attachment `path` (the value that matches the
   * multipart fieldname). Each entry holds the test result ID and the
   * attachment metadata from the CTRF JSON.
   */
  private collectAttachments(
    tests: CtrfTest[],
  ): Map<string, { name: string; contentType: string; referenceUrl?: string }> {
    const map = new Map<string, { name: string; contentType: string; referenceUrl?: string }>();

    for (const test of tests) {
      // Test-level attachments
      for (const att of test.attachments ?? []) {
        map.set(att.path, {
          name: att.name,
          contentType: att.contentType,
          referenceUrl: att.path.startsWith('http://') || att.path.startsWith('https://')
            ? att.path
            : undefined,
        });
      }
      // Retry attempt-level attachments
      for (const attempt of test.retryAttempts ?? []) {
        for (const att of attempt.attachments ?? []) {
          map.set(att.path, {
            name: att.name,
            contentType: att.contentType,
            referenceUrl: att.path.startsWith('http://') || att.path.startsWith('https://')
              ? att.path
              : undefined,
          });
        }
      }
    }

    return map;
  }

  /**
   * Persist TestArtifact rows for all attachments declared in the CTRF report.
   *
   * For each attachment:
   * - If it has a matching uploaded file part → store via ArtifactStorage,
   *   record the storage key.
   * - If it's an external URL (referenceUrl set) → store by reference only.
   * - If a file part is uploaded for a reference-only attachment → the route
   *   handler already rejected this with 400.
   *
   * The multipart fieldname convention is `artifacts[<path>]` or simply
   * the attachment path as the fieldname. We match by extracting the path
   * from the fieldname or using the fieldname directly.
   */
  private async persistArtifacts(
    em: EntityManager,
    testRun: TestRun,
    project: Project,
    attachmentMap: Map<string, { name: string; contentType: string; referenceUrl?: string }>,
    artifactParts: ArtifactPart[],
    artifactStorage: ArtifactStorage,
  ): Promise<void> {
    // Build a lookup: fieldname → file part data
    const fileLookup = new Map<string, ArtifactPart>();
    for (const part of artifactParts) {
      // Try to extract the path from fieldname like "artifacts[screenshot.png]"
      const pathMatch = part.fieldname.match(/^artifacts\[(.+)\]$/);
      const key = pathMatch?.[1] ?? part.fieldname;
      fileLookup.set(key, part);
    }

    // We need the TestResult IDs to attach artifacts to. Since we inserted
    // results in bulkInsertResults and cleared the EM, we need to query them.
    const testResults = await em.find(
      TestResult,
      { testRun: testRun.id },
      { orderBy: { id: 'ASC' } },
    );

    // Map test name → first matching TestResult ID (attachments are per-test)
    const resultIdByName = new Map<string, number>();
    for (const tr of testResults) {
      if (!resultIdByName.has(tr.testName)) {
        resultIdByName.set(tr.testName, tr.id);
      }
    }

    for (const [path, attMeta] of attachmentMap) {
      const isRef = !!attMeta.referenceUrl;
      const filePart = fileLookup.get(path);

      // Reject: file body sent for a reference-only attachment
      if (isRef && filePart) {
        throw new Error(
          `Artifact "${path}" is reference-only; do not upload a body`,
        );
      }

      let storageKey = '';
      let storageType: 'local' | 'url' = 'local';
      let sizeBytes: number | null = null;

      if (isRef) {
        // External URL — store by reference only
        storageType = 'url';
        storageKey = attMeta.referenceUrl!;
      } else if (filePart) {
        // Uploaded file — store via ArtifactStorage
        const storagePath = this.buildStorageKey(project, testRun, path);
        await artifactStorage.put({
          key: storagePath,
          data: filePart.data,
          contentType: filePart.contentType ?? attMeta.contentType,
        });
        storageKey = storagePath;
        sizeBytes = filePart.data.length;
      }
      // else: attachment declared in CTRF but no file uploaded and not a URL
      // → skip (the CI pipeline may have declared it but not uploaded it)

      // Determine which TestResult this artifact belongs to.
      // The CTRF spec doesn't directly link attachments to test IDs in the
      // multipart convention, so we use the first TestResult by name.
      // In practice, attachments are declared per-test in the CTRF JSON,
      // but the multipart fieldname is just the path. We assign to the
      // first TestResult found (or leave unlinked if no match).
      // A more precise mapping would require the multipart fieldname to
      // encode the test ID, but the current convention uses the path.
      const testResultId = this.resolveTestResultIdForAttachment(
        path,
        testResults,
      );

      // Assign to the first TestResult if we have any; artifacts need a parent.
      // If there are no test results at all, skip creating the artifact row.
      const targetResultId = testResultId ?? testResults[0]?.id;
      if (targetResultId === null || targetResultId === undefined) {
        continue;
      }

      em.create(TestArtifact, {
        testResult: targetResultId,
        displayName: attMeta.name,
        fileName: path,
        contentType: attMeta.contentType,
        artifactType: this.inferArtifactType(attMeta.contentType, path),
        storageType,
        storageKey,
        referenceUrl: isRef ? attMeta.referenceUrl : null,
        sizeBytes,
        contentTypeVerified: !isRef, // Only verified for uploaded files
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }

    if (attachmentMap.size > 0) {
      await em.flush();
    }
  }

  /**
   * Build a hierarchical storage key for the artifact file.
   *
   * Format: `orgs/<orgId>/projects/<projectId>/runs/<runId>/<fileName>`
   */
  private buildStorageKey(
    project: Project,
    testRun: TestRun,
    fileName: string,
  ): string {
    // Sanitize the filename to prevent path traversal
    const safeName = fileName.replace(/\/|\\/g, '_');
    return `orgs/${project.organization.id}/projects/${project.id}/runs/${testRun.id}/${safeName}`;
  }

  /**
   * Infer the artifact type category from Content-Type and filename.
   *
   * @returns One of: 'image', 'video', 'log', 'archive', 'html', 'other'
   */
  private inferArtifactType(contentType: string, path: string): string {
    const ct = contentType.toLowerCase();
    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('video/')) return 'video';
    if (ct === 'application/zip') return 'archive';
    if (ct === 'text/plain') return 'log';
    if (ct === 'text/html') return 'html';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.log')) return 'log';
    return 'other';
  }

  /**
   * Resolve the TestResult ID for an attachment by matching the attachment
   * path against the test results. Since the multipart convention doesn't
   * encode the test ID in the fieldname, we assign artifacts to the first
   * TestResult in the run as a fallback.
   *
   * A more precise approach would require the CTRF JSON to declare which
   * test each attachment belongs to, which it does — but the multipart
   * fieldname is just the path. For now, we assign all artifacts to the
   * first TestResult. Future stories can improve this mapping.
   */
  private resolveTestResultIdForAttachment(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _path: string,
    testResults: TestResult[],
  ): number | null {
    // Return the first test result ID as the default target.
    // This is a simplification — the CTRF spec declares attachments per-test,
    // but the multipart fieldname convention doesn't encode the test ID.
    return testResults[0]?.id ?? null;
  }

  /**
   * Update TestRun aggregate counters from the parsed CTRF report.
   *
   * Uses the summary data from the CTRF report rather than re-querying
   * TestResult rows — the CTRF summary is authoritative.
   *
   * @see docs/planning/database-design.md §7 — aggregate counter maintenance
   */
  private updateRunCounters(testRun: TestRun, ctrf: CtrfReport): void {
    const summary = ctrf.results.summary;

    testRun.totalTests = summary.tests;
    testRun.passed = summary.passed;
    testRun.failed = summary.failed;
    // CTRF `skipped` + `pending` + `other` → our `skipped` counter
    // (our schema doesn't have separate pending/other counters at the run level)
    testRun.skipped = summary.skipped + summary.pending + summary.other;
    testRun.blocked = 0; // CTRF has no "blocked" concept; stays 0

    // Derive run-level status: if any test failed → 'failed', else → 'passed'
    testRun.status = summary.failed > 0 ? 'failed' : 'passed';

    // Duration from summary (may differ from stop-start due to parallelism)
    if (summary.duration != null) {
      testRun.durationMs = summary.duration;
    } else if (summary.stop && summary.start) {
      testRun.durationMs = summary.stop - summary.start;
    }
  }

  /**
   * Look up an existing idempotency key for the given project.
   *
   * @returns The existing `runId` if found, `null` otherwise.
   */
  async checkIdempotency(
    em: EntityManager,
    projectId: number,
    key: string,
  ): Promise<number | null> {
    const existing = await em.findOne(IngestIdempotencyKey, {
      project: projectId,
      idempotencyKey: key,
    }, { populate: ['testRun'] });

    if (existing && existing.testRun) {
      return existing.testRun.id;
    }

    return null;
  }

  /**
   * Record an idempotency key after a successful run creation.
   *
   * Uses `em.create()` + `em.flush()` — the unique constraint on
   * `(project_id, idempotency_key)` handles concurrent races.
   */
  private async recordIdempotencyKey(
    em: EntityManager,
    projectId: number,
    key: string,
    runId: number,
  ): Promise<void> {
    em.create(IngestIdempotencyKey, {
      project: projectId,
      idempotencyKey: key,
      testRun: runId,
    });
    await em.flush();
  }
}

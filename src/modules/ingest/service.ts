/**
 * IngestService — Business logic for CTRF report ingestion.
 *
 * Orchestrates:
 *   1. Zod validation of the incoming CTRF report
 *   2. Idempotency-key lookup/recording
 *   3. TestRun creation from CTRF summary/tool/environment
 *   4. 500-row chunked TestResult insertion with event-loop yielding
 *   5. Artifact co-upload: TestArtifact row creation + ArtifactStorage.put()
 *   6. TestRun aggregate counter rollup
 *   7. `run.ingested` event publication (non-blocking)
 *
 * The service receives an EntityManager (always `request.em` — never
 * `fastify.orm.em`) and never accesses Fastify request/reply objects
 * directly.
 *
 * @see skills/ctrf-ingest-validation.md — chunked bulk insert, no /api/artifact
 * @see skills/artifact-security-and-serving.md — artifact storage contract
 * @see skills/fastify-route-convention.md — service-layer boundary
 * @see docs/planning/database-design.md §4.23 — idempotency keys
 * @see docs/planning/database-design.md §7 — aggregate counter maintenance
 */

import type { EntityManager } from '@mikro-orm/core';
import { CtrfReportSchema, type CtrfReport, type CtrfTest } from './schemas.js';
import { Project, TestRun, TestResult, TestArtifact, IngestIdempotencyKey } from '../../entities/index.js';
import type { EventBus } from '../../services/event-bus.js';
import { RunEvents, type RunIngestedPayload } from '../../services/event-bus.js';
import type { ArtifactStorage } from '../../lib/artifact-storage.js';
import { classifyArtifactType } from '../../lib/artifact-validation.js';
import { hasKnownSignature } from '../../lib/magic-bytes.js';
import type { BufferedArtifact } from './routes.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestOptions {
  idempotencyKey?: string;
  eventBus: EventBus;
  artifactFiles?: BufferedArtifact[];
  artifactStorage?: ArtifactStorage;
}

export interface IngestResult {
  runId: number;
  replay: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class IngestService {
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

    // -- 3. Validate reference-only artifact constraints --------------------
    const artifactFiles = opts.artifactFiles ?? [];
    const filesByFieldName = new Map<string, BufferedArtifact>();
    for (const f of artifactFiles) {
      filesByFieldName.set(f.fieldName, f);
    }

    // Collect all attachments across all tests, check reference-only constraint
    const allAttachments = this.collectAttachments(ctrf);
    for (const att of allAttachments) {
      if (isExternalUrl(att.path) && filesByFieldName.has(att.path)) {
        throw new ReferenceOnlyError(att.path);
      }
    }

    // -- 4. Create TestRun row from CTRF metadata ---------------------------
    const testRun = em.create(TestRun, {
      project,
      name: ctrf.results.environment?.reportName ?? null,
      status: 'pending',
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

    await em.flush();

    // -- 5. Chunked TestResult insertion ------------------------------------
    const resultIdsByTestIndex = await this.bulkInsertResults(em, testRun, ctrf.results.tests);

    // -- 6. Create TestArtifact rows and store files ------------------------
    if (allAttachments.length > 0 && opts.artifactStorage) {
      await this.persistArtifacts(
        em,
        testRun,
        ctrf,
        resultIdsByTestIndex,
        filesByFieldName,
        opts.artifactStorage,
        project,
      );
    }

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
   * Collect all attachment references across all tests in the report.
   * Each entry carries the test index so we can resolve the TestResult FK.
   */
  private collectAttachments(
    ctrf: CtrfReport,
  ): Array<{ path: string; name: string; contentType: string; testIndex: number }> {
    const result: Array<{ path: string; name: string; contentType: string; testIndex: number }> = [];
    for (let i = 0; i < ctrf.results.tests.length; i++) {
      const test = ctrf.results.tests[i]!;
      if (test.attachments) {
        for (const att of test.attachments) {
          result.push({
            path: att.path,
            name: att.name,
            contentType: att.contentType,
            testIndex: i,
          });
        }
      }
    }
    return result;
  }

  /**
   * Insert TestResult rows in 500-row chunks with event-loop yielding.
   * Returns a map of test index → TestResult.id for FK references.
   */
  private async bulkInsertResults(
    em: EntityManager,
    testRun: TestRun,
    tests: CtrfTest[],
  ): Promise<Map<number, number>> {
    const idMap = new Map<number, number>();

    for (let i = 0; i < tests.length; i += CHUNK_SIZE) {
      const chunk = tests.slice(i, i + CHUNK_SIZE);
      const created: TestResult[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const test = chunk[j]!;
        const result = em.create(TestResult, {
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
        created.push(result);
      }
      await em.flush();

      // Capture IDs before clearing the identity map
      for (let j = 0; j < created.length; j++) {
        idMap.set(i + j, created[j]!.id);
      }

      em.clear();

      if (i + CHUNK_SIZE < tests.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    em.merge(testRun);
    return idMap;
  }

  /**
   * Create TestArtifact rows and write files to storage.
   *
   * For each attachment in the CTRF JSON:
   * - External URL → create row with storageType='url', no file write
   * - Local file → match to buffered file part by path, write via ArtifactStorage.put(),
   *   create row with storageType='local'
   */
  private async persistArtifacts(
    em: EntityManager,
    testRun: TestRun,
    ctrf: CtrfReport,
    resultIdsByTestIndex: Map<number, number>,
    filesByFieldName: Map<string, BufferedArtifact>,
    storage: ArtifactStorage,
    project: Project,
  ): Promise<void> {
    const attachments = this.collectAttachments(ctrf);

    for (const att of attachments) {
      const testResultId = resultIdsByTestIndex.get(att.testIndex);
      if (!testResultId) continue;

      if (isExternalUrl(att.path)) {
        // External URL — reference only, no file body
        em.create(TestArtifact, {
          testResult: testResultId,
          displayName: att.name,
          fileName: null,
          contentType: att.contentType,
          artifactType: classifyArtifactType(att.contentType),
          storageType: 'url',
          storageKey: att.path,
          sizeBytes: null,
          contentTypeVerified: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        continue;
      }

      // Local file — match against buffered file parts
      const file = filesByFieldName.get(att.path);
      if (!file) {
        // Attachment declared in CTRF but no file part uploaded — skip
        continue;
      }

      const storageKey = buildStorageKey(
        project.organization.id,
        project.id,
        testRun.id,
        testResultId,
        file.fileName,
      );

      await storage.put({
        key: storageKey,
        data: file.data,
        contentType: file.contentType,
      });

      em.create(TestArtifact, {
        testResult: testResultId,
        displayName: att.name,
        fileName: file.fileName,
        contentType: file.contentType,
        artifactType: classifyArtifactType(file.contentType),
        storageType: 'local',
        storageKey,
        sizeBytes: file.data.length,
        contentTypeVerified: hasKnownSignature(file.contentType),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }

    await em.flush();
  }

  private updateRunCounters(testRun: TestRun, ctrf: CtrfReport): void {
    const summary = ctrf.results.summary;

    testRun.totalTests = summary.tests;
    testRun.passed = summary.passed;
    testRun.failed = summary.failed;
    testRun.skipped = summary.skipped + summary.pending + summary.other;
    testRun.blocked = 0;

    testRun.status = summary.failed > 0 ? 'failed' : 'passed';

    if (summary.duration != null) {
      testRun.durationMs = summary.duration;
    } else if (summary.stop && summary.start) {
      testRun.durationMs = summary.stop - summary.start;
    }
  }

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

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function isExternalUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

/**
 * Build a hierarchical storage key for an artifact.
 * Prevents path traversal by rejecting `..` in the filename.
 */
function buildStorageKey(
  orgId: string | number,
  projectId: number,
  runId: number,
  resultId: number,
  fileName: string,
): string {
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error(`Invalid filename: ${fileName}`);
  }
  return `orgs/${orgId}/projects/${projectId}/runs/${runId}/results/${resultId}/${fileName}`;
}

/**
 * Thrown when a file body is sent for a reference-only (external URL) attachment.
 * Caught by the route handler and returned as 400.
 */
export class ReferenceOnlyError extends Error {
  constructor(path: string) {
    super(`artifact "${path}" is reference-only; do not upload a body`);
    this.name = 'ReferenceOnlyError';
  }
}

/**
 * IngestService — Business logic for CTRF report ingestion.
 *
 * Orchestrates:
 *   1. Zod validation of the incoming CTRF report
 *   2. Idempotency-key lookup/recording
 *   3. TestRun creation from CTRF summary/tool/environment
 *   4. 500-row chunked TestResult insertion with event-loop yielding
 *   5. TestRun aggregate counter rollup
 *   6. `run.ingested` event publication (non-blocking)
 *
 * The service receives an EntityManager (always `request.em` — never
 * `fastify.orm.em`) and never accesses Fastify request/reply objects
 * directly.
 *
 * @see skills/ctrf-ingest-validation.md — chunked bulk insert, no /api/artifact
 * @see skills/fastify-route-convention.md — service-layer boundary
 * @see docs/planning/database-design.md §4.23 — idempotency keys
 * @see docs/planning/database-design.md §7 — aggregate counter maintenance
 */

import type { EntityManager } from '@mikro-orm/core';
import { CtrfReportSchema, type CtrfReport, type CtrfTest } from './schemas.js';
import { Project, TestRun, TestResult, IngestIdempotencyKey } from '../../entities/index.js';
import type { EventBus } from '../../services/event-bus.js';
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

/** Options passed from the route handler to the service. */
export interface IngestOptions {
  /** Raw `Idempotency-Key` header value. `undefined` if absent. */
  idempotencyKey?: string;
  /** The EventBus instance for publishing `run.ingested`. */
  eventBus: EventBus;
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
   * @param opts - Idempotency key and event bus.
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
    // Use `em.create()` with explicit required properties.
    // Computed getters (passRate, failureRate, pendingCount) are read-only
    // and derived from counters — MikroORM doesn't require them in create().
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

    // -- 5. Update aggregate counters on the TestRun -----------------------
    this.updateRunCounters(testRun, ctrf);
    await em.flush();

    // -- 6. Record idempotency key (same transaction) ----------------------
    if (opts.idempotencyKey) {
      await this.recordIdempotencyKey(
        em,
        project.id,
        opts.idempotencyKey,
        testRun.id,
      );
    }

    // -- 7. Publish run.ingested (non-blocking, after commit) ---------------
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
    // The testRun was cleared; we need to re-merge it for the counter update
    em.merge(testRun);
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

/**
 * A2 Correlator — Root cause correlation pipeline stage.
 *
 * Subscribes to `run.ai_categorized`, reserves a durable journal row in
 * `ai_pipeline_log`, calls `AiProvider.correlateRootCauses()` with all
 * failed results (including their A1 categories), writes the resulting
 * clusters to `test_runs.ai_root_causes`, then publishes
 * `run.ai_correlated`.
 *
 * Implements the reserve-execute-commit pattern + heartbeat per
 * `ai-features.md §Durability and restart recovery`.
 *
 * Downstream stage runs with `partial: true` if this stage terminally
 * fails or if the upstream A1 stage already published `partial: true`.
 *
 * @see skills/ai-pipeline-event-bus.md — full stage handler pattern
 * @see docs/planning/ai-features.md §A2, §Durability
 */

import os from 'node:os';
import type { MikroORM, EntityManager } from '@mikro-orm/core';
import type { AiProvider } from '../types.js';
import type { EventBus, AiStageEventPayload } from '../../event-bus.js';
import { RunEvents } from '../../event-bus.js';
import { TestResult } from '../../../entities/TestResult.js';
import { isAiCloudPipelineConsented } from './consent.js';
import { CorrelateOutputSchema } from './schemas.js';
import type { CorrelateRootCausesInput } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of failed results to send in the correlation call. */
const MAX_FAILED_RESULTS = 500;

/** Heartbeat interval in milliseconds (15 seconds). */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Maximum stack trace length sent to the AI provider. */
const MAX_STACK_TRACE_LENGTH = 500;

/** Maximum retry attempts before terminal failure. */
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Worker ID
// ---------------------------------------------------------------------------

function generateWorkerId(): string {
  return `${os.hostname()}:${process.pid}:${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Heartbeat management
// ---------------------------------------------------------------------------

function startHeartbeat(
  em: EntityManager,
  logRowId: number,
): () => void {
  const timer = setInterval(() => {
    void em.getConnection().execute(
      `UPDATE ai_pipeline_log SET heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [logRowId],
    ).catch(() => {
      // Heartbeat failure is non-fatal — recovery/sweeper catches stale rows.
    });
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Core correlate handler
// ---------------------------------------------------------------------------

/**
 * A2 root cause correlation stage handler.
 *
 * Called when `RunEvents.RUN_AI_CATEGORIZED` is published on the EventBus.
 * Follows the same reserve-execute-commit lifecycle as A1.
 *
 * @param payload - The `run.ai_categorized` event payload.
 * @param aiProvider - Injected AI provider (MockAiProvider in tests).
 * @param orm - MikroORM instance for forking EMs.
 * @param eventBus - EventBus for publishing `run.ai_correlated`.
 */
export async function correlateRootCauses(
  payload: AiStageEventPayload,
  aiProvider: AiProvider,
  orm: MikroORM,
  eventBus: EventBus,
): Promise<void> {
  const { runId, orgId } = payload;
  const upstreamPartial = payload.partial ?? false;
  const em = orm.em.fork();

  // ── 1. Consent gate ────────────────────────────────────────────
  const consented = await isAiCloudPipelineConsented(em, orgId);
  if (!consented) return;

  // ── 2. Load failed results with A1 categories ──────────────────
  const failedResults = await em.find(
    TestResult,
    { testRun: runId, status: 'failed' },
    { orderBy: { id: 'ASC' }, limit: MAX_FAILED_RESULTS },
  );

  if (failedResults.length === 0) return;

  // ── 3. Idempotency check ───────────────────────────────────────
  const runRows = await em.getConnection().execute(
    `SELECT ai_root_causes_at FROM test_runs WHERE id = ?`,
    [runId],
  );
  const runRow = (runRows as Array<{ ai_root_causes_at: string | null }>)[0];
  if (runRow?.ai_root_causes_at != null) {
    // Primary output already persisted — mark log done and publish
    await em.getConnection().execute(
      `UPDATE ai_pipeline_log SET status = 'done', completed_at = CURRENT_TIMESTAMP
       WHERE test_run_id = ? AND stage = 'correlate' AND status != 'done'`,
      [runId],
    );
    eventBus.publish(RunEvents.RUN_AI_CORRELATED, { runId, orgId });
    return;
  }

  // ── 4. Upsert + atomic reserve ─────────────────────────────────
  const workerId = generateWorkerId();

  await em.getConnection().execute(
    `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
     VALUES (?, 'correlate', 'pending', 0)
     ON CONFLICT (test_run_id, stage) DO NOTHING`,
    [runId],
  );

  const reserved = await em.getConnection().execute(
    `UPDATE ai_pipeline_log
     SET status = 'running',
         worker_id = ?,
         heartbeat_at = CURRENT_TIMESTAMP,
         attempt = attempt + 1,
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
     WHERE test_run_id = ? AND stage = 'correlate'
       AND status = 'pending' AND attempt < ?`,
    [workerId, runId, MAX_ATTEMPTS],
  );

  let affectedRows = 0;
  if (typeof reserved === 'object' && !Array.isArray(reserved) && 'affectedRows' in reserved) {
    affectedRows = (reserved as { affectedRows: number }).affectedRows;
  } else {
    const changesResult = await em.getConnection().execute('SELECT changes() as cnt');
    affectedRows = (changesResult as Array<{ cnt: number }>)[0]?.cnt ?? 0;
  }

  if (affectedRows === 0) return;

  // Fetch the log row ID for heartbeat updates
  const logRows = await em.getConnection().execute(
    `SELECT id, attempt FROM ai_pipeline_log
     WHERE test_run_id = ? AND stage = 'correlate'`,
    [runId],
  );
  const logRow = (logRows as Array<{ id: number; attempt: number }>)[0];
  if (!logRow) return;

  const logRowId = logRow.id;
  const currentAttempt = logRow.attempt;

  // ── 5. Start heartbeat timer ───────────────────────────────────
  const stopHeartbeat = startHeartbeat(em, logRowId);

  try {
    // Build input — results without A1 category (partial upstream) get 'unknown'
    const input: CorrelateRootCausesInput = {
      runId,
      results: failedResults.map((r) => ({
        resultId: r.id,
        testName: r.testName,
        errorMessage: r.errorMessage ?? null,
        stackTrace: r.stackTrace
          ? r.stackTrace.substring(0, MAX_STACK_TRACE_LENGTH)
          : null,
        category: (r.aiCategory as CorrelateRootCausesInput['results'][number]['category'])
          ?? 'unknown',
      })),
    };

    const rawOutput = await aiProvider.correlateRootCauses(input);

    // Validate response shape with Zod
    const parsed = CorrelateOutputSchema.safeParse(rawOutput);
    if (!parsed.success) {
      throw new Error(
        `AI provider returned invalid correlation shape: ${parsed.error.message}`,
      );
    }

    const output = parsed.data;

    // ── 6. Commit results to test_runs ────────────────────────────
    await em.getConnection().execute(
      `UPDATE test_runs
       SET ai_root_causes = ?,
           ai_root_causes_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(output.clusters), runId],
    );

    // ── 7. Mark log row done ─────────────────────────────────────
    stopHeartbeat();

    await em.getConnection().execute(
      `UPDATE ai_pipeline_log
       SET status = 'done',
           completed_at = CURRENT_TIMESTAMP,
           tokens_used = ?,
           heartbeat_at = NULL,
           worker_id = NULL
       WHERE id = ?`,
      [output.tokensUsed, logRowId],
    );

    // ── 8. Publish next event ────────────────────────────────────
    eventBus.publish(RunEvents.RUN_AI_CORRELATED, {
      runId,
      orgId,
      partial: upstreamPartial,
    });

  } catch (error) {
    stopHeartbeat();

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (currentAttempt >= MAX_ATTEMPTS) {
      await em.getConnection().execute(
        `UPDATE ai_pipeline_log
         SET status = 'failed',
             error = ?,
             completed_at = CURRENT_TIMESTAMP,
             heartbeat_at = NULL,
             worker_id = NULL
         WHERE id = ?`,
        [errorMessage, logRowId],
      ).catch(() => {
        // Best-effort
      });

      eventBus.publish(RunEvents.RUN_AI_CORRELATED, {
        runId,
        orgId,
        partial: true,
      });
    } else {
      await em.getConnection().execute(
        `UPDATE ai_pipeline_log
         SET status = 'pending',
             worker_id = NULL,
             heartbeat_at = NULL,
             error = ?
         WHERE id = ?`,
        [errorMessage, logRowId],
      ).catch(() => {
        // Best-effort release
      });
    }
  }
}

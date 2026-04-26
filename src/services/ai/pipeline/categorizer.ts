/**
 * A1 Categorizer — Per-test failure categorization pipeline stage.
 *
 * Subscribes to `run.ingested`, reserves a durable journal row in
 * `ai_pipeline_log`, executes categorization through the injected
 * `AiProvider` using `splitIntoBatches(batch=20)`, commits results back
 * to the run's `TestResult` rows, then publishes `run.ai_categorized`.
 *
 * Implements the reserve-execute-commit pattern + heartbeat per
 * `ai-features.md §Durability and restart recovery`.
 *
 * @see skills/ai-pipeline-event-bus.md — full stage handler pattern
 * @see docs/planning/ai-features.md §A1, §Durability
 * @see docs/planning/database-design.md §4.8 — ai_pipeline_log schema
 */

import os from 'node:os';
import type { MikroORM, EntityManager } from '@mikro-orm/core';
import type { AiProvider } from '../types.js';
import type { EventBus, RunIngestedPayload } from '../../event-bus.js';
import { RunEvents } from '../../event-bus.js';
import { TestResult } from '../../../entities/TestResult.js';
import { splitIntoBatches } from '../helpers.js';
import { isAiCloudPipelineConsented } from './consent.js';
import { CategorizeOutputSchema } from './schemas.js';
import type { CategorizeFailuresInput } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of failed results to categorize per run. */
const MAX_FAILED_RESULTS = 500;

/** Batch size for AI provider calls. */
const BATCH_SIZE = 20;

/** Heartbeat interval in milliseconds (15 seconds). */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Maximum stack trace length sent to the AI provider. */
const MAX_STACK_TRACE_LENGTH = 500;

/** Maximum retry attempts before terminal failure. */
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Worker ID
// ---------------------------------------------------------------------------

/**
 * Generate a unique worker ID for this process.
 *
 * Format: `{hostname}:{pid}:{bootTimestamp}` per database-design.md §4.8.
 * The boot timestamp ensures uniqueness across process restarts on the
 * same host with the same PID (PID recycling).
 */
function generateWorkerId(): string {
  return `${os.hostname()}:${process.pid}:${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Heartbeat management
// ---------------------------------------------------------------------------

/**
 * Start a heartbeat timer that updates `heartbeat_at` every 15 seconds.
 *
 * @returns A cleanup function that clears the timer.
 */
function startHeartbeat(
  em: EntityManager,
  logRowId: number,
): () => void {
  const timer = setInterval(() => {
    // Fire-and-forget — heartbeat failure is non-fatal.
    // The sweeper/recovery will catch stale heartbeats.
    void em.getConnection().execute(
      `UPDATE ai_pipeline_log SET heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [logRowId],
    ).catch(() => {
      // Heartbeat update failed — log row may have been deleted or
      // connection lost. The next heartbeat or recovery will handle it.
    });
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Core categorize handler
// ---------------------------------------------------------------------------

/**
 * A1 categorization stage handler.
 *
 * Called when `RunEvents.RUN_INGESTED` is published on the EventBus.
 * Implements the full reserve-execute-commit lifecycle:
 *
 * 1. Consent gate check
 * 2. Load failed results (cap 500)
 * 3. Idempotency check (already categorized?)
 * 4. Upsert + atomic reserve in `ai_pipeline_log`
 * 5. Heartbeat timer
 * 6. Batch execution (groups of 20, setImmediate yield)
 * 7. Commit results to `test_results`
 * 8. Mark log row `done` + publish `run.ai_categorized`
 *
 * Error handling:
 * - Transient (attempt < 3): release row to `pending`; no event published
 * - Terminal (attempt = 3): mark `failed`; publish with `partial: true`
 *
 * @param payload - The `run.ingested` event payload.
 * @param aiProvider - Injected AI provider (MockAiProvider in tests).
 * @param orm - MikroORM instance for forking EMs.
 * @param eventBus - EventBus for publishing `run.ai_categorized`.
 */
export async function categorizeRun(
  payload: RunIngestedPayload,
  aiProvider: AiProvider,
  orm: MikroORM,
  eventBus: EventBus,
): Promise<void> {
  const { runId, orgId } = payload;
  const em = orm.em.fork();

  // ── 1. Consent gate ────────────────────────────────────────────
  const consented = await isAiCloudPipelineConsented(em, orgId);
  if (!consented) {
    return; // Skip silently — no error, no log entry
  }

  // ── 2. Load failed results (cap at 500) ────────────────────────
  const failedResults = await em.find(
    TestResult,
    { testRun: runId, status: 'failed' },
    {
      orderBy: { id: 'ASC' },
      limit: MAX_FAILED_RESULTS,
    },
  );

  if (failedResults.length === 0) {
    return; // No failures to categorize
  }

  // ── 3. Idempotency check ───────────────────────────────────────
  // If all failed results already have aiCategoryAt set, the stage
  // was already completed (crash between "primary write committed"
  // and "log row marked done"). Mark done and publish.
  const allCategorized = failedResults.every((r) => r.aiCategoryAt != null);
  if (allCategorized) {
    // Ensure the log row is marked done
    await em.getConnection().execute(
      `UPDATE ai_pipeline_log SET status = 'done', completed_at = CURRENT_TIMESTAMP
       WHERE test_run_id = ? AND stage = 'categorize' AND status != 'done'`,
      [runId],
    );
    eventBus.publish(RunEvents.RUN_AI_CATEGORIZED, { runId, orgId });
    return;
  }

  // ── 4. Upsert + atomic reserve ─────────────────────────────────
  const workerId = generateWorkerId();

  // Upsert: create pending row if none exists
  await em.getConnection().execute(
    `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
     VALUES (?, 'categorize', 'pending', 0)
     ON CONFLICT (test_run_id, stage) DO NOTHING`,
    [runId],
  );

  // Atomic reserve: transition pending → running
  const reserved = await em.getConnection().execute(
    `UPDATE ai_pipeline_log
     SET status = 'running',
         worker_id = ?,
         heartbeat_at = CURRENT_TIMESTAMP,
         attempt = attempt + 1,
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
     WHERE test_run_id = ? AND stage = 'categorize'
       AND status = 'pending' AND attempt < ?`,
    [workerId, runId, MAX_ATTEMPTS],
  );

  // Check if we actually reserved (affectedRows > 0).
  // MikroORM's SQLite driver returns [] for UPDATE execute() (not an
  // object with affectedRows). We use a follow-up query to get the
  // count of rows changed by the last statement — `changes()` on
  // SQLite, which is reliable across both in-memory and file-based DBs.
  // On PostgreSQL the execute() return value includes affectedRows
  // natively, so we check that first.
  let affectedRows = 0;
  if (typeof reserved === 'object' && !Array.isArray(reserved) && 'affectedRows' in reserved) {
    affectedRows = (reserved as { affectedRows: number }).affectedRows;
  } else {
    // SQLite path — query the built-in changes() scalar function
    const changesResult = await em.getConnection().execute('SELECT changes() as cnt');
    affectedRows = (changesResult as Array<{ cnt: number }>)[0]?.cnt ?? 0;
  }

  if (affectedRows === 0) {
    return; // Someone else reserved it, or max attempts reached
  }

  // Fetch the log row ID for heartbeat updates
  const logRows = await em.getConnection().execute(
    `SELECT id, attempt FROM ai_pipeline_log
     WHERE test_run_id = ? AND stage = 'categorize'`,
    [runId],
  );
  const logRow = (logRows as Array<{ id: number; attempt: number }>)[0];
  if (!logRow) {
    return; // Defensive — should not happen after successful reserve
  }

  const logRowId = logRow.id;
  const currentAttempt = logRow.attempt;

  // ── 5. Start heartbeat timer ───────────────────────────────────
  const stopHeartbeat = startHeartbeat(em, logRowId);

  // ── 6. Batch execution ─────────────────────────────────────────
  let totalTokensUsed = 0;

  try {
    // Only categorize results that haven't been categorized yet
    const uncategorized = failedResults.filter((r) => r.aiCategoryAt == null);

    const batches = splitIntoBatches(uncategorized, BATCH_SIZE);

    for (const batch of batches) {
      const input: CategorizeFailuresInput = {
        runId,
        results: batch.map((r) => ({
          resultId: r.id,
          testName: r.testName,
          errorMessage: r.errorMessage ?? null,
          stackTrace: r.stackTrace
            ? r.stackTrace.substring(0, MAX_STACK_TRACE_LENGTH)
            : null,
        })),
      };

      const rawOutput = await aiProvider.categorizeFailures(input);

      // Validate response shape with Zod — parse failure = recoverable error
      const parsed = CategorizeOutputSchema.safeParse(rawOutput);
      if (!parsed.success) {
        throw new Error(
          `AI provider returned invalid categorization shape: ${parsed.error.message}`,
        );
      }

      const output = parsed.data;
      totalTokensUsed += output.tokensUsed;

      // ── 7. Commit batch results to test_results ────────────────
      for (const cat of output.categories) {
        await em.getConnection().execute(
          `UPDATE test_results
           SET ai_category = ?,
               ai_category_model = ?,
               ai_category_at = CURRENT_TIMESTAMP
           WHERE id = ? AND test_run_id = ?`,
          [cat.category, output.model, cat.resultId, runId],
        );
      }

      // Yield between batches to avoid blocking the event loop
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    // ── 8. Mark log row done ───────────────────────────────────────
    stopHeartbeat();

    await em.getConnection().execute(
      `UPDATE ai_pipeline_log
       SET status = 'done',
           completed_at = CURRENT_TIMESTAMP,
           tokens_used = ?,
           heartbeat_at = NULL,
           worker_id = NULL
       WHERE id = ?`,
      [totalTokensUsed, logRowId],
    );

    // ── 9. Publish next event ──────────────────────────────────────
    eventBus.publish(RunEvents.RUN_AI_CATEGORIZED, { runId, orgId });

  } catch (error) {
    stopHeartbeat();

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (currentAttempt >= MAX_ATTEMPTS) {
      // Terminal failure — mark failed, publish with partial flag
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
        // Best-effort — if this fails too, the recovery sweep will catch it
      });

      // Publish with partial flag so downstream stages can still run
      eventBus.publish(RunEvents.RUN_AI_CATEGORIZED, {
        runId,
        orgId,
        partial: true,
      });
    } else {
      // Transient failure — release row back to pending for retry
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
      // No event published — recovery or next event will retry
    }
  }
}

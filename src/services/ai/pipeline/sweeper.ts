/**
 * Stuck-Stage Sweeper — Periodic cleanup for stalled AI pipeline rows.
 *
 * Runs on a 60-second interval. Three operations:
 * 1. **Terminal-fail stuck running rows:** `running` rows with
 *    `attempt >= 3` that weren't terminal-failed (e.g. crash before
 *    catch handler could run) → mark `failed`, publish next event
 *    with `partial: true`.
 * 2. **Release stale running rows:** `running` rows with
 *    `heartbeat_at < NOW() - 2 minutes` AND `attempt < 3` →
 *    release back to `pending` so they can be retried.
 * 3. **Terminal-fail exhausted pending rows:** `pending` rows with
 *    `attempt >= 3` → mark `failed`, publish next event with
 *    `partial: true` (catches rows the boot-time recovery missed).
 *
 * The sweeper is idempotent — it can run concurrently with the recovery
 * query and with normal stage handlers. Rows are reserved atomically,
 * so no double-processing can occur.
 *
 * @see skills/ai-pipeline-event-bus.md §Stuck-stage sweeper
 * @see docs/planning/ai-features.md §Durability and restart recovery
 */

import type { MikroORM } from '@mikro-orm/core';
import type { EventBus } from '../../event-bus.js';
import { RunEvents } from '../../event-bus.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sweeper interval in milliseconds (60 seconds). */
const SWEEPER_INTERVAL_MS = 60_000;

/** Staleness threshold for heartbeat — 2 minutes. */
const HEARTBEAT_STALE_MS = 120_000;

/** Stage to next-event mapping for partial publishes. */
const STAGE_TO_NEXT_EVENT: Record<string, string> = {
  categorize: RunEvents.RUN_AI_CATEGORIZED,
  correlate:  RunEvents.RUN_AI_CORRELATED,
  summarize:  RunEvents.RUN_AI_SUMMARIZED,
};

// ---------------------------------------------------------------------------
// Sweeper
// ---------------------------------------------------------------------------

/**
 * Start the stuck-stage sweeper.
 *
 * Runs on a periodic timer (60s by default). On each tick, queries the
 * `ai_pipeline_log` for stuck rows and either releases them (stale heartbeat,
 * attempt < 3) or terminal-fails them (attempt >= 3).
 *
 * Terminal-failed rows trigger a `partial: true` publish of the **next**
 * stage's event so downstream stages can proceed with degraded input.
 *
 * @param orm - MikroORM instance for database access.
 * @param eventBus - EventBus for publishing partial-true next-stage events.
 * @returns A cleanup function that stops the timer and drains any in-flight tick.
 */
export function startSweeper(
  orm: MikroORM,
  eventBus: EventBus,
): () => void {
  let currentTick: Promise<void> | null = null;

  const tick = async () => {
    try {
      const connection = orm.em.getConnection();

      // ── 1. Terminal-fail stuck `running` rows (attempt >= 3) ───
      // These rows were abandoned mid-flight — crash before the catch
      // handler could mark them failed. Publish the *same* stage's
      // event with `partial: true` so downstream stages can run.
      const stuckFailed = await connection.execute(
        `SELECT stage, test_run_id FROM ai_pipeline_log
         WHERE status = 'running' AND attempt >= 3`,
      ) as Array<{ stage: string; test_run_id: number }>;

      for (const row of stuckFailed) {
        await connection.execute(
          `UPDATE ai_pipeline_log
           SET status = 'failed',
               error = 'Maximum retry attempts exhausted (sweeper)',
               completed_at = CURRENT_TIMESTAMP,
               heartbeat_at = NULL,
               worker_id = NULL
           WHERE test_run_id = ? AND stage = ?`,
          [row.test_run_id, row.stage],
        ).catch(() => {
          // Best-effort
        });

        // Publish the next event with partial: true so downstream stages unblock
        const nextEvent = STAGE_TO_NEXT_EVENT[row.stage];
        if (nextEvent) {
          const runRows = await connection.execute(
            `SELECT tr.project_id
             FROM test_runs tr
             WHERE tr.id = ?`,
            [row.test_run_id],
          );
          const orgRows = await connection.execute(
            `SELECT organization_id FROM projects WHERE id = ?`,
            [(runRows as Array<{ project_id: number }>)[0]?.project_id],
          );

          const orgId = (orgRows as Array<{ organization_id: string }>)[0]?.organization_id;
          if (orgId) {
            eventBus.publish(nextEvent, {
              runId: row.test_run_id,
              orgId,
              partial: true,
            });
          }
        }
      }

      // ── 2. Release stale `running` rows (attempt < 3) ─────────
      const staleThreshold = new Date(Date.now() - HEARTBEAT_STALE_MS)
        .toISOString().replace('T', ' ').slice(0, 19);

      await connection.execute(
        `UPDATE ai_pipeline_log
         SET status = 'pending',
             worker_id = NULL,
             heartbeat_at = NULL
         WHERE status = 'running'
           AND attempt < 3
           AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
        [staleThreshold],
      );

      // ── 3. Terminal-fail exhausted `pending` rows (attempt >= 3)
      await connection.execute(
        `UPDATE ai_pipeline_log
         SET status = 'failed',
             error = 'Maximum retry attempts exhausted (sweeper)',
             completed_at = CURRENT_TIMESTAMP
         WHERE status = 'pending'
           AND attempt >= 3`,
      );
    } catch {
      // Sweeper errors are non-fatal — next tick will try again.
    }
  };

  const intervalId = setInterval(() => {
    // Don't stack ticks if one is still running
    if (currentTick == null) {
      currentTick = tick().finally(() => {
        currentTick = null;
      });
    }
  }, SWEEPER_INTERVAL_MS);

  // Return cleanup function for graceful shutdown
  return () => {
    clearInterval(intervalId);
  };
}

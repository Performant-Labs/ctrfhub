/**
 * AI Pipeline Boot-time Recovery — reclaim crashed-worker rows and
 * re-enqueue pending stages.
 *
 * Runs once at application startup, before the EventBus subscriptions
 * are registered. This ensures that any AI pipeline work that was
 * in-progress when the previous process crashed is picked up.
 *
 * Two operations:
 * 1. **Reclaim:** `running` rows with stale heartbeats (> 2 min) → `pending`
 * 2. **Terminal-fail:** `pending` rows with `attempt >= 3` → `failed`
 * 3. **Re-enqueue:** remaining `pending` rows for recent runs → publish events
 *
 * @see skills/ai-pipeline-event-bus.md §Boot-time recovery
 * @see docs/planning/ai-features.md §Durability and restart recovery
 */

import type { MikroORM } from '@mikro-orm/core';
import type { EventBus } from '../../event-bus.js';
import { RunEvents } from '../../event-bus.js';

/** Staleness threshold for heartbeat — 2 minutes per canonical spec. */
const HEARTBEAT_STALE_SECONDS = 120;

/** Only re-enqueue pending rows for runs created in the last 24 hours. */
const REENQUEUE_WINDOW_HOURS = 24;

/**
 * Map pipeline stage names to the EventBus event that triggers them.
 *
 * Used to re-enqueue pending rows: for each pending row, publish the
 * event that causes the normal handler to attempt reservation.
 */
const STAGE_TO_EVENT: Record<string, string> = {
  categorize: RunEvents.RUN_INGESTED,
  correlate:  RunEvents.RUN_AI_CATEGORIZED,
  summarize:  RunEvents.RUN_AI_CORRELATED,
  anomaly:    RunEvents.RUN_AI_SUMMARIZED,
};

/**
 * Recover stale AI pipeline rows on application boot.
 *
 * Must be called **before** subscribing to EventBus events so that
 * re-enqueued events are received by the freshly registered handlers.
 *
 * @param orm - MikroORM instance for database access.
 * @param eventBus - EventBus for re-enqueuing pending stages.
 */
export async function recoverStalePipelineRows(
  orm: MikroORM,
  eventBus: EventBus,
): Promise<void> {
  const connection = orm.em.getConnection();

  // ── 1. Reclaim crashed-worker rows ─────────────────────────────
  // Rows in 'running' status with a heartbeat older than 2 minutes
  // (or NULL heartbeat) are assumed to belong to a dead worker.
  // Reset them to 'pending' so they can be re-reserved.
  // The threshold is computed in JS as a plain string in
  // 'YYYY-MM-DD HH:MM:SS' format. This avoids the SQLite-only
  // `datetime()` function and works on both SQLite (text comparison)
  // and PostgreSQL (implicit cast to timestamptz).
  const staleThreshold = new Date(Date.now() - HEARTBEAT_STALE_SECONDS * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);

  await connection.execute(
    `UPDATE ai_pipeline_log
     SET status = 'pending',
         worker_id = NULL,
         heartbeat_at = NULL
     WHERE status = 'running'
       AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
    [staleThreshold],
  );

  // ── 2. Terminal-fail exhausted rows ────────────────────────────
  // Pending rows with attempt >= 3 can never succeed — mark them
  // failed so the run can unstick and downstream stages run with
  // partial: true.
  await connection.execute(
    `UPDATE ai_pipeline_log
     SET status = 'failed',
         error = 'Maximum retry attempts exhausted (boot-time recovery)',
         completed_at = CURRENT_TIMESTAMP
     WHERE status = 'pending'
       AND attempt >= 3`,
  );

  // ── 3. Re-enqueue pending rows for recent runs ─────────────────
  // For every 'pending' row attached to a run created in the last 24h,
  // publish the event that triggers that stage. The normal handler
  // then reserves and executes.
  const reenqueueThreshold = new Date(Date.now() - REENQUEUE_WINDOW_HOURS * 60 * 60 * 1000);

  const pendingRows = await connection.execute(
    `SELECT apl.stage, apl.test_run_id,
            tr.project_id
     FROM ai_pipeline_log apl
     JOIN test_runs tr ON tr.id = apl.test_run_id
     WHERE apl.status = 'pending'
       AND tr.created_at > ?`,
    [reenqueueThreshold],
  );

  for (const row of pendingRows as Array<{
    stage: string;
    test_run_id: number;
    project_id: number;
  }>) {
    const event = STAGE_TO_EVENT[row.stage];
    if (event) {
      // We don't have the orgId readily available from just test_runs,
      // so look it up from the project's organization.
      const projectRows = await connection.execute(
        `SELECT organization_id FROM projects WHERE id = ?`,
        [row.project_id],
      );
      const orgId = (projectRows as Array<{ organization_id: string }>)[0]?.organization_id;

      if (orgId) {
        eventBus.publish(event, {
          runId: row.test_run_id,
          projectId: row.project_id,
          orgId,
        });
      }
    }
  }
}

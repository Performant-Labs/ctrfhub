/**
 * A3 Summarizer — Run narrative summary pipeline stage.
 *
 * Subscribes to `run.ai_correlated`, reserves a durable journal row in
 * `ai_pipeline_log`, calls `AiProvider.generateRunSummary()` with
 * aggregate metrics + A1/A2 output (no raw test names per privacy spec),
 * writes the summary to `test_runs.ai_summary`, then publishes
 * `run.ai_summarized`.
 *
 * Implements the reserve-execute-commit pattern + heartbeat per
 * `ai-features.md §Durability and restart recovery`.
 *
 * When `partial: true` is received (upstream A1 or A2 terminally failed),
 * the summarizer runs with reduced data — no root cause clusters and
 * possibly incomplete category distribution.
 *
 * @see skills/ai-pipeline-event-bus.md — full stage handler pattern
 * @see docs/planning/ai-features.md §A3, §Durability, §Privacy
 */

import os from 'node:os';
import type { MikroORM, EntityManager } from '@mikro-orm/core';
import type { AiProvider, CorrelateRootCausesOutput } from '../types.js';
import type { EventBus, AiStageEventPayload } from '../../event-bus.js';
import { RunEvents } from '../../event-bus.js';
import { isAiCloudPipelineConsented } from './consent.js';
import { SummaryOutputSchema } from './schemas.js';
import type { GenerateRunSummaryInput } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Heartbeat interval in milliseconds (15 seconds). */
const HEARTBEAT_INTERVAL_MS = 15_000;

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
      // Heartbeat failure is non-fatal.
    });
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Core summarize handler
// ---------------------------------------------------------------------------

/**
 * A3 run narrative summary stage handler.
 *
 * Called when `RunEvents.RUN_AI_CORRELATED` is published on the EventBus.
 * Follows the same reserve-execute-commit lifecycle as A1/A2.
 *
 * @param payload - The `run.ai_correlated` event payload.
 * @param aiProvider - Injected AI provider (MockAiProvider in tests).
 * @param orm - MikroORM instance for forking EMs.
 * @param eventBus - EventBus for publishing `run.ai_summarized`.
 */
export async function generateSummary(
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

  // ── 2. Idempotency check ───────────────────────────────────────
  const runRows = await em.getConnection().execute(
    `SELECT ai_summary_at, total_tests, passed, failed, skipped,
            environment, branch, commit_sha, ai_root_causes
     FROM test_runs WHERE id = ?`,
    [runId],
  );
  const runRow = (runRows as Array<{
    ai_summary_at: string | null;
    total_tests: number;
    passed: number;
    failed: number;
    skipped: number;
    environment: string | null;
    branch: string | null;
    commit_sha: string | null;
    ai_root_causes: string | null;
  }>)[0];

  if (!runRow) return; // Run no longer exists

  if (runRow.ai_summary_at != null) {
    // Primary output already persisted — mark log done and publish
    await em.getConnection().execute(
      `UPDATE ai_pipeline_log SET status = 'done', completed_at = CURRENT_TIMESTAMP
       WHERE test_run_id = ? AND stage = 'summarize' AND status != 'done'`,
      [runId],
    );
    eventBus.publish(RunEvents.RUN_AI_SUMMARIZED, { runId, orgId });
    return;
  }

  // ── 3. Compute category distribution from test_results ─────────
  const catRows = await em.getConnection().execute(
    `SELECT ai_category, COUNT(*) as cnt
     FROM test_results
     WHERE test_run_id = ? AND status = 'failed' AND ai_category IS NOT NULL
     GROUP BY ai_category`,
    [runId],
  );

  const categoryDistribution: Record<string, number> = {
    app_defect: 0,
    test_data: 0,
    script_error: 0,
    environment: 0,
    unknown: 0,
  };
  for (const row of catRows as Array<{ ai_category: string; cnt: number }>) {
    if (row.ai_category in categoryDistribution) {
      categoryDistribution[row.ai_category] = row.cnt;
    }
  }

  // ── 4. Load previous pass rate for delta comparison ────────────
  let previousPassRate: number | null = null;
  try {
    const prevRows = await em.getConnection().execute(
      `SELECT CAST(passed AS REAL) / NULLIF(total_tests, 0) AS pass_rate
       FROM test_runs
       WHERE project_id = (SELECT project_id FROM test_runs WHERE id = ?)
         AND id < ?
         AND total_tests > 0
       ORDER BY id DESC
       LIMIT 1`,
      [runId, runId],
    );
    const prevRow = (prevRows as Array<{ pass_rate: number | null }>)[0];
    if (prevRow?.pass_rate != null) {
      previousPassRate = prevRow.pass_rate;
    }
  } catch {
    // Non-critical — previous pass rate is optional
  }

  // ── 5. Parse A2 root cause clusters (may be absent on partial) ─
  let rootCauseClusters: CorrelateRootCausesOutput['clusters'] = [];
  if (runRow.ai_root_causes != null && !upstreamPartial) {
    try {
      rootCauseClusters = JSON.parse(runRow.ai_root_causes) as CorrelateRootCausesOutput['clusters'];
    } catch {
      // Corrupt JSON — treat as no clusters
    }
  }

  // ── 6. Upsert + atomic reserve ─────────────────────────────────
  const workerId = generateWorkerId();

  await em.getConnection().execute(
    `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
     VALUES (?, 'summarize', 'pending', 0)
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
     WHERE test_run_id = ? AND stage = 'summarize'
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

  const logRows = await em.getConnection().execute(
    `SELECT id, attempt FROM ai_pipeline_log
     WHERE test_run_id = ? AND stage = 'summarize'`,
    [runId],
  );
  const logRow = (logRows as Array<{ id: number; attempt: number }>)[0];
  if (!logRow) return;

  const logRowId = logRow.id;
  const currentAttempt = logRow.attempt;

  // ── 7. Start heartbeat timer ───────────────────────────────────
  const stopHeartbeat = startHeartbeat(em, logRowId);

  try {
    const input: GenerateRunSummaryInput = {
      runId,
      totalTests: runRow.total_tests,
      passed: runRow.passed,
      failed: runRow.failed,
      skipped: runRow.skipped,
      environment: runRow.environment,
      branch: runRow.branch,
      commitSha: runRow.commit_sha,
      categoryDistribution: categoryDistribution as Record<
        GenerateRunSummaryInput['categoryDistribution'] extends Record<infer K, number> ? K : never,
        number
      >,
      rootCauseClusters,
      previousPassRate,
    };

    const rawOutput = await aiProvider.generateRunSummary(input);

    const parsed = SummaryOutputSchema.safeParse(rawOutput);
    if (!parsed.success) {
      throw new Error(
        `AI provider returned invalid summary shape: ${parsed.error.message}`,
      );
    }

    const output = parsed.data;

    // ── 8. Commit results to test_runs ────────────────────────────
    await em.getConnection().execute(
      `UPDATE test_runs
       SET ai_summary = ?,
           ai_summary_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [output.summary, runId],
    );

    // ── 9. Mark log row done ─────────────────────────────────────
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

    // ── 10. Publish next event ───────────────────────────────────
    eventBus.publish(RunEvents.RUN_AI_SUMMARIZED, {
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

      eventBus.publish(RunEvents.RUN_AI_SUMMARIZED, {
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

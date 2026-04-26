/**
 * AiPipelineLog entity — durable journal for AI pipeline stages.
 *
 * One row per AI pipeline stage per test run. Records timing, status,
 * and token usage for observability (System Status page) and startup
 * recovery. This table is the **source of truth for pipeline scheduling**
 * — the EventBus signals "consider scheduling", but workers reserve and
 * commit work against rows in this table so a crash never loses a job.
 *
 * CTRFHub-owned: this table IS created by schema-generator (INFRA-005).
 *
 * @see docs/planning/database-design.md §4.8
 * @see skills/ai-pipeline-event-bus.md — reserve-execute-commit pattern
 * @see docs/planning/ai-features.md §Durability and restart recovery
 */

import { defineEntity, p } from '@mikro-orm/core';
import { TestRunSchema } from './TestRun.js';

const AiPipelineLogSchema = defineEntity({
  name: 'AiPipelineLog',
  tableName: 'ai_pipeline_log',
  properties: {
    id:          p.integer().primary(),

    /** FK to the test run this pipeline stage operates on. */
    testRun:     () => p.manyToOne(TestRunSchema),

    /**
     * Pipeline stage identifier.
     * Values: 'categorize' | 'correlate' | 'summarize' | 'anomaly'
     */
    stage:       p.string().length(20),

    /**
     * Current status of this pipeline stage row.
     * Values: 'pending' | 'running' | 'done' | 'failed'
     * @see database-design.md §4.8 status enum
     */
    status:      p.string().length(20),

    /**
     * Identifier of the worker holding the row while status='running'.
     * NULL otherwise. Format: {hostname}:{pid}:{bootId}.
     */
    workerId:    p.string().length(64).nullable(),

    /**
     * Last heartbeat from the owning worker (updated every ~15s while
     * status='running'). Used by the sweeper to detect crashed workers.
     * NULL when not running.
     */
    heartbeatAt: p.datetime().nullable(),

    /**
     * Incremented on each pending → running transition.
     * Capped at 3 (after which the row is marked 'failed').
     */
    attempt:     p.integer().default(0),

    /** Error message if status = 'failed'. */
    error:       p.text().nullable(),

    /** Prompt + completion tokens; used for AI cost tracking. */
    tokensUsed:  p.integer().nullable(),

    /**
     * First time the row transitioned to 'running'.
     * For cost/latency dashboards; not reset on restart.
     */
    startedAt:   p.datetime().nullable(),

    /** When the stage completed successfully (status='done'). */
    completedAt: p.datetime().nullable(),
  },

  // Note: UNIQUE (test_run_id, stage) is enforced by the upsert query's
  // ON CONFLICT clause. MikroORM v7's defineEntity() doesn't support a
  // top-level `indexes` option — composite unique constraints are expressed
  // via schema-generator hooks or raw DDL.
  // @see database-design.md §4.8 constraints
});

/**
 * AiPipelineLog entity class.
 *
 * Domain methods can be added here as needed by downstream stories.
 */
export class AiPipelineLog extends AiPipelineLogSchema.class {}
AiPipelineLogSchema.setClass(AiPipelineLog);

export { AiPipelineLogSchema };

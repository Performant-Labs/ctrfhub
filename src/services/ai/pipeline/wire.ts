/**
 * AI Pipeline — composition-root wiring.
 *
 * `wireAiPipeline(app, deps)` is the single entry point for installing
 * the AI pipeline (A1 categorize → A2 correlate → A3 summarize) onto a
 * running Fastify app. The composition root (`src/app.ts`) calls this
 * once, when an `AiProvider` is configured; otherwise it is not called
 * at all and the pipeline stays dormant.
 *
 * This module encapsulates the three concerns that previously lived
 * inline in `buildApp()`:
 *
 *   1. Boot-time recovery — re-enqueue stale `ai_pipeline_log` rows
 *      from a previous crash *before* subscribing handlers, so that
 *      re-published events are received by the fresh subscribers
 *      (per `skills/ai-pipeline-event-bus.md §Boot-time recovery`).
 *   2. EventBus subscriptions — A1, A2, A3 handlers wired to the
 *      `run.ingested → run.ai_categorized → run.ai_correlated` chain
 *      in the `'ai'` consumer group (per `§Event chain`).
 *   3. Stuck-stage sweeper — a polled tick that terminal-fails rows
 *      stuck in `running` (per `src/services/ai/pipeline/sweeper.ts`).
 *
 * Shutdown ordering belongs to the composition root: this function
 * returns a `stopSweeper` callback (and the `aiProvider`, for symmetry)
 * so `app.ts` can sequence teardown in dependency-correct order. The
 * function does NOT register an `onClose` hook itself — `app.ts` owns
 * shutdown.
 *
 * @see skills/ai-pipeline-event-bus.md — event chain and recovery rules
 * @see docs/planning/architecture.md §Layering — `buildApp()` is the composition root
 * @see docs/planning/ai-features.md §Durability and restart recovery
 */

import type { FastifyInstance } from 'fastify';
import type { MikroORM } from '@mikro-orm/core';
import { RunEvents } from '../../event-bus.js';
import type { EventBus, RunIngestedPayload, AiStageEventPayload } from '../../event-bus.js';
import type { AiProvider } from '../types.js';
import { categorizeRun } from './categorizer.js';
import { correlateRootCauses } from './correlator.js';
import { generateSummary } from './summarizer.js';
import { startSweeper } from './sweeper.js';
import { recoverStalePipelineRows } from './recovery.js';

/**
 * Dependencies required to wire the AI pipeline.
 *
 * All three are required — `wireAiPipeline()` is only called when the
 * composition root has an `aiProvider` in hand. The `eventBus` and `orm`
 * are always-present app decorations.
 */
export interface WireAiPipelineDeps {
  eventBus: EventBus;
  aiProvider: AiProvider;
  orm: MikroORM;
}

/**
 * Handle returned by `wireAiPipeline()` — the composition root holds
 * this and uses it to sequence shutdown.
 */
export interface WiredAiPipeline {
  /**
   * Stop the stuck-stage sweeper. Idempotent and synchronous: returns
   * after cancelling the timer; in-flight sweeper ticks resolve on
   * their own. Called from the consolidated `onClose` in `src/app.ts`.
   */
  stopSweeper: () => void;
}

/**
 * Wire the AI pipeline onto `app`.
 *
 * Boot-time recovery is awaited (so re-enqueued events fire against the
 * subscribers registered immediately below); subscriptions and the
 * sweeper are then registered synchronously.
 *
 * Recovery failure is intentionally non-fatal — the pipeline can still
 * process new events even if recovery cannot; the sweeper catches stale
 * rows later (see `skills/ai-pipeline-event-bus.md §Boot-time recovery`
 * and `docs/planning/architecture.md §Code Conventions → Error handling`,
 * "Swallowed only when explicitly safe… commented at the call site").
 *
 * @param app - Fastify instance (only used for `app.log`).
 * @param deps - `{ eventBus, aiProvider, orm }` — all required.
 * @returns A `WiredAiPipeline` handle with `stopSweeper()` for shutdown.
 */
export async function wireAiPipeline(
  app: FastifyInstance,
  deps: WireAiPipelineDeps,
): Promise<WiredAiPipeline> {
  const { eventBus, aiProvider, orm } = deps;

  // ── 1. Boot-time recovery ──────────────────────────────────────
  // Reclaim crashed-worker rows and re-enqueue pending stages BEFORE
  // subscribing. Order matters: a re-publish must land on the
  // freshly-registered subscriber below.
  // @see skills/ai-pipeline-event-bus.md §Boot-time recovery
  try {
    await recoverStalePipelineRows(orm, eventBus);
  } catch (err) {
    app.log.error(
      { err },
      'AI pipeline boot-time recovery failed — pipeline may miss stale rows',
    );
    // Non-fatal: the pipeline can still process new events even if
    // recovery fails. The stuck-stage sweeper will catch them later.
  }

  // ── 2. A1: categorize failures ─────────────────────────────────
  // Subscribes to run.ingested in the 'ai' consumer group. Each event
  // triggers categorizeRun which uses its own forked EM (not request.em —
  // this is an EventBus subscriber, not an HTTP handler).
  // @see skills/ai-pipeline-event-bus.md §Event chain
  eventBus.subscribe('ai', RunEvents.RUN_INGESTED, async (rawPayload) => {
    const payload = rawPayload as RunIngestedPayload;
    try {
      await categorizeRun(payload, aiProvider, orm, eventBus);
    } catch (err) {
      app.log.error(
        { err, runId: payload.runId },
        'A1 categorization failed — unhandled error in categorizeRun',
      );
      // Swallowed: EventBus handlers must not propagate errors.
      // The reserve-execute-commit pattern handles retries internally.
    }
  });

  // ── 3. A2: root cause correlation ──────────────────────────────
  // Subscribes to run.ai_categorized. Handles partial:true from
  // upstream terminal failures by treating uncategorized results
  // as 'unknown' category.
  eventBus.subscribe('ai', RunEvents.RUN_AI_CATEGORIZED, async (rawPayload) => {
    const payload = rawPayload as AiStageEventPayload;
    try {
      await correlateRootCauses(payload, aiProvider, orm, eventBus);
    } catch (err) {
      app.log.error(
        { err, runId: payload.runId },
        'A2 correlation failed — unhandled error in correlateRootCauses',
      );
    }
  });

  // ── 4. A3: run narrative summary ───────────────────────────────
  // Subscribes to run.ai_correlated. Handles partial:true by
  // skipping A2 root cause cluster data in the summary input.
  eventBus.subscribe('ai', RunEvents.RUN_AI_CORRELATED, async (rawPayload) => {
    const payload = rawPayload as AiStageEventPayload;
    try {
      await generateSummary(payload, aiProvider, orm, eventBus);
    } catch (err) {
      app.log.error(
        { err, runId: payload.runId },
        'A3 summary generation failed — unhandled error in generateSummary',
      );
    }
  });

  // ── 5. Stuck-stage sweeper ─────────────────────────────────────
  // Runs every 60s to detect rows stuck in 'running' state (crash
  // before catch handler). Terminal-fails exhausted rows (attempt >= 3)
  // so downstream stages can proceed.
  const stopSweeper = startSweeper(orm, eventBus);

  return { stopSweeper };
}

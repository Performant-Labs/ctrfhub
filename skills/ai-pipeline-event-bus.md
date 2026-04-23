---
name: ai-pipeline-event-bus
description: The four-stage AI pipeline (A1 categorize → A2 correlate → A3 summarize → A4 anomaly detect) wired through the EventBus with ai_pipeline_log durability, heartbeat, and restart-recovery semantics.
trigger: writing any AI pipeline stage (A1–A4); working on AiPipelineService; adding a new EventBus subscription; implementing crash recovery on boot
source: docs/planning/ai-features.md §Implementation Architecture, §Durability and restart recovery; docs/planning/testing-strategy.md §Testing AI Features
---

## Rule

Every AI pipeline stage (A1–A4) reserves a row in `ai_pipeline_log` before calling the LLM, heartbeats every 15 seconds while executing, marks `done` on success, and publishes the next stage event; a boot-time recovery query re-enqueues stages whose worker crashed; `MockAiProvider` is the only AI double used in tests — never make real LLM calls in unit or integration tests.

## Why

The EventBus is in-memory in MVP and fire-and-forget. Without additional durability, a worker crash mid-stage leaves runs stuck in "analyzing" forever and jobs are lost. The `ai_pipeline_log` table solves this: it is the **source of truth for pipeline scheduling**. The EventBus signals "consider scheduling," but workers reserve and commit work against `ai_pipeline_log` rows.

This design is mandated in `ai-features.md §Durability and restart recovery (A1–A4)` (which was identified as a P0 gap in `gap-review-merged.md #4`).

AI features are OFF by default even when `AI_PROVIDER` is set (`AI_CLOUD_PIPELINE=off` by default). Privacy/consent model requires explicit org-admin acknowledgement before the pipeline sends any data. Details in `ai-features.md §Privacy and consent`.

## How to apply

### Stage handler pattern

Every A1–A4 handler must follow this sequence:

1. **Upsert row** in `ai_pipeline_log` with `INSERT … ON CONFLICT(test_run_id, stage) DO NOTHING`.
2. **Reserve atomically:** `UPDATE ai_pipeline_log SET status='running', worker_id=$id, heartbeat_at=NOW(), attempt=attempt+1 WHERE status='pending' AND attempt<3`.
3. **Idempotency check:** Before calling the LLM, check if the stage's primary output is already persisted (e.g. A2: `test_runs.ai_root_causes_at IS NOT NULL`). If so, mark `done` and publish the next event without an LLM call.
4. **Start heartbeat timer:** Update `heartbeat_at` every 15 s during LLM execution.
5. **On success:** Write primary output to `test_runs`, mark `ai_pipeline_log` row `done`, publish next event.
6. **On transient error (attempt < 3):** Release row (`status='pending', worker_id=NULL, heartbeat_at=NULL`); no next-event publish.
7. **On terminal error (attempt = 3):** Mark `status='failed'`; publish next event with `partial: true` flag so downstream stages run with degraded input.

### Boot-time recovery

Before subscribing to EventBus events, the worker must:

1. Reclaim crashed-worker rows:
   ```sql
   UPDATE ai_pipeline_log SET status='pending', worker_id=NULL, heartbeat_at=NULL
   WHERE status='running'
     AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '2 minutes')
   ```
2. Re-enqueue `pending` rows for runs created in the last 24 h by publishing the appropriate event for each stage.

### Event chain

```
run.ingested        → A1 categorizeRun        → publishes run.ai_categorized
run.ai_categorized  → A2 correlateRootCauses  → publishes run.ai_correlated
run.ai_correlated   → A3 generateSummary      → publishes run.ai_summarized
run.ai_summarized   → A4 detectAnomalies      (Phase 2 — not MVP)
```

All subscriptions use the group `'ai'` so they can be moved to a separate worker process in Phase 2 without changing the handler code.

### Consent gate

Before any stage calls the LLM:
1. Check `AI_CLOUD_PIPELINE` env var — if not `'on'`, skip and mark `done` without calling LLM.
2. Check `organizations.ai_cloud_ack_at IS NOT NULL` for the run's org — if not acknowledged, skip and mark `done`.

### Payload caps

- A1: batch results in groups of 20; cap at 500 failed results per run.
- A2: single LLM call with all failed results; cap output at 10 clusters.
- A3: input is aggregate metrics + A1/A2 output — no raw test names sent.
- Always truncate `stack_trace` to first 500 chars before sending.

### Test double

```typescript
// In all integration tests that exercise the AI pipeline
const ai = new MockAiProvider();
const app = await buildApp({ testing: true, db: ':memory:', aiProvider: ai });

// Assertions inspect ai.calls[] — no network, no cost, deterministic
expect(ai.calls.filter(c => c.method === 'categorizeFailures')).toHaveLength(1);
```

Never use `nock` or `msw` to intercept AI provider HTTP — use `MockAiProvider` instead.

## Good example

```typescript
// AiPipelineService — stage A1 handler sketch
eventBus.subscribe('ai', HtmxEvents.RUN_INGESTED, async (event) => {
  const { runId, orgId } = event;

  // 1. Check consent gate
  const org = await em.findOne(Organization, orgId);
  if (!org?.aiCloudAckAt) return;  // not consented, skip silently

  // 2. Upsert + reserve
  await em.getConnection().execute(
    `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
     VALUES ($1, 'categorize', 'pending', 0)
     ON CONFLICT (test_run_id, stage) DO NOTHING`, [runId]
  );
  const reserved = await em.getConnection().execute(
    `UPDATE ai_pipeline_log
     SET status='running', worker_id=$1, heartbeat_at=NOW(), attempt=attempt+1
     WHERE test_run_id=$2 AND stage='categorize' AND status='pending' AND attempt<3
     RETURNING id`, [workerId, runId]
  );
  if (!reserved.length) return;  // someone else reserved it

  // 3. Execute with heartbeat...
  // 4. On success: write results, mark done, publish next event
});
```

## Bad example

```typescript
// ❌ AI stage with no ai_pipeline_log — crash loses the job
eventBus.subscribe('ai', 'run.ingested', async ({ runId }) => {
  const results = await em.find(TestResult, { runId, status: 'failed' });
  const categories = await aiProvider.categorizeFailures(results);  // crashes here → lost
  await em.find(TestResult, ...).then(/* update */);
  await em.flush();
  eventBus.publish('run.ai_categorized', { runId });
});
// No reservation, no heartbeat, no recovery. A process restart silently drops this run.
```

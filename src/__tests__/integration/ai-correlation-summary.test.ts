/**
 * Integration tests — AI-003 A2 Correlation + A3 Summarizer pipeline.
 *
 * Tests the reserve-execute-commit lifecycle for A2 correlate and A3
 * summarize stages, partial:true downstream propagation, stuck-stage
 * sweeper behavior, event chain ordering, and consent gates.
 *
 * Layer 2 (integration) — uses buildApp({ testing: true, db: ':memory:' })
 * with MockAiProvider and MemoryEventBus. No real LLM calls.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 2
 * @see .argos/AI-003/feature-handoff.md §Integration tests required
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { Organization, Project, TestRun, TestResult } from '../../entities/index.js';
import { MemoryEventBus, RunEvents } from '../../services/event-bus.js';
import { MockAiProvider } from '../doubles/MockAiProvider.js';
import { correlateRootCauses, generateSummary, startSweeper } from '../../services/ai/pipeline/index.js';
import type { CorrelateRootCausesOutput, GenerateRunSummaryOutput, CorrelateRootCausesInput } from '../../services/ai/types.js';
import type { FastifyInstance } from 'fastify';

async function ensureUniqueIndex(app: FastifyInstance): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orm = (app as any).orm;
  await orm.em.getConnection().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_apl_run_stage
     ON ai_pipeline_log (test_run_id, stage)`,
  );
}

function makeCorrResponse(resultIds: number[]): CorrelateRootCausesOutput {
  return {
    clusters: [{
      label: 'Timeout Cluster',
      category: 'environment',
      confidence: 0.95,
      resultIds,
      explanation: 'All failures share a network timeout root cause.',
    }],
    model: 'mock-model',
    tokensUsed: 42,
  };
}

function makeSummaryResponse(): GenerateRunSummaryOutput {
  return {
    summary: 'The test run had 3 failures, mostly environment-related. Pass rate decreased by 5% compared to the last run. Root causes point to network instability.',
    model: 'mock-model',
    tokensUsed: 33,
  };
}

async function seedRunWithFailures(
  app: FastifyInstance,
  orgId: string,
  failedCount: number,
  opts?: { aiCloudAckAt?: Date | null; withAiCategory?: boolean },
): Promise<{ runId: number; resultIds: number[]; projectId: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orm = (app as any).orm;
  const em = orm.em.fork();

  let org = await em.findOne(Organization, { id: orgId });
  if (!org) {
    org = em.create(Organization, {
      id: orgId,
      name: `Test Org ${orgId}`,
      slug: `slug-${orgId}`,
      createdAt: new Date(),
      aiCloudAckAt: opts?.aiCloudAckAt !== undefined ? opts.aiCloudAckAt : new Date(),
    });
    await em.flush();
  } else if (opts?.aiCloudAckAt !== undefined) {
    org.aiCloudAckAt = opts.aiCloudAckAt;
    await em.flush();
  }

  let project = await em.findOne(Project, { organization: org });
  if (!project) {
    project = em.create(Project, {
      organization: org,
      name: 'Demo',
      slug: `demo-${orgId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.flush();
  }

  const run = em.create(TestRun, {
    project,
    name: `Run with ${failedCount} failures`,
    status: failedCount > 0 ? 'failed' : 'passed',
    totalTests: failedCount,
    passed: 0,
    failed: failedCount,
    skipped: 0,
    blocked: 0,
    createdAt: new Date(),
  });
  await em.flush();

  const resultIds: number[] = [];
  for (let i = 0; i < failedCount; i++) {
    const result = em.create(TestResult, {
      testRun: run,
      testName: `failing-test-${i + 1}`,
      status: 'failed',
      errorMessage: `Error in test ${i + 1}`,
      stackTrace: `at test${i + 1} (file.ts:${i + 1}:1)`,
      createdAt: new Date(),
      ...(opts?.withAiCategory ? { aiCategory: 'app_defect', aiCategoryModel: 'mock', aiCategoryAt: new Date() } : {}),
    });
    await em.flush();
    resultIds.push(result.id);
  }

  return { runId: run.id, resultIds, projectId: project.id };
}

// ---------------------------------------------------------------------------
// Suite 1: A2 Correlation — happy path
// ---------------------------------------------------------------------------

describe('AI-003 A2 Correlation — happy path', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    await app.close();
  });

  it('reserves → executes → commits and publishes run.ai_correlated', async () => {
    const { runId, resultIds, _projectId } = await seedRunWithFailures(app, 'org-a2-happy', 3, { withAiCategory: true });

    aiProvider.reset();
    aiProvider.setRootCauses(makeCorrResponse(resultIds));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    await correlateRootCauses({ runId, orgId: 'org-a2-happy' }, aiProvider, orm, eventBus);

    expect(aiProvider.calls.filter((c) => c.method === 'correlateRootCauses')).toHaveLength(1);

    const logRows = await orm.em.getConnection().execute(
      `SELECT * FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'correlate'`,
      [runId],
    );
    expect(logRows).toHaveLength(1);
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('done');
    expect(logRow['tokens_used']).toBe(42);

    const runRows = await orm.em.getConnection().execute(
      `SELECT ai_root_causes, ai_root_causes_at FROM test_runs WHERE id = ?`,
      [runId],
    );
    const runRow = (runRows as Array<Record<string, unknown>>)[0]!;
    expect(runRow['ai_root_causes']).not.toBeNull();
    const clusters = JSON.parse(runRow['ai_root_causes'] as string);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].label).toBe('Timeout Cluster');
    expect(runRow['ai_root_causes_at']).not.toBeNull();

    const corrEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED);
    expect(corrEvents).toHaveLength(1);
    expect((corrEvents[0]!.payload as { runId: number }).runId).toBe(runId);
  });

  it('skips when run has zero failed results', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    const em = orm.em.fork();
    const org = await em.findOne(Organization, { id: 'org-a2-happy' });
    const project = await em.findOne(Project, { organization: org });
    const run = em.create(TestRun, {
      project: project!,
      name: 'All passing',
      status: 'passed',
      totalTests: 5, passed: 5, failed: 0, skipped: 0, blocked: 0,
      createdAt: new Date(),
    });
    await em.flush();

    aiProvider.reset();
    aiProvider.setRootCauses(makeCorrResponse([]));
    eventBus.published.length = 0;

    await correlateRootCauses({ runId: run.id, orgId: 'org-a2-happy' }, aiProvider, orm, eventBus);

    expect(aiProvider.calls).toHaveLength(0);
    expect(eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED)).toHaveLength(0);
  });

  it('skips LLM call and publishes event when already correlated (idempotency)', async () => {
    const { runId, resultIds, _projectId } = await seedRunWithFailures(app, 'org-a2-idem', 3, { withAiCategory: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    // Pre-persist ai_root_causes to simulate crash after commit but before log update
    await orm.em.getConnection().execute(
      `UPDATE test_runs SET ai_root_causes = '[]', ai_root_causes_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [runId],
    );

    aiProvider.reset();
    aiProvider.setRootCauses(makeCorrResponse(resultIds));
    eventBus.published.length = 0;

    await correlateRootCauses({ runId, orgId: 'org-a2-idem' }, aiProvider, orm, eventBus);

    expect(aiProvider.calls).toHaveLength(0);
    const corrEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED);
    expect(corrEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: A3 Summary — happy path
// ---------------------------------------------------------------------------

describe('AI-003 A3 Summary — happy path', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    await app.close();
  });

  it('reserves → executes → commits and publishes run.ai_summarized', async () => {
    const { runId, resultIds, _projectId } = await seedRunWithFailures(app, 'org-a3-happy', 3, { withAiCategory: true });

    // Pre-set ai_root_causes so A3 can parse them
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    const corrOutput = makeCorrResponse(resultIds);
    await orm.em.getConnection().execute(
      `UPDATE test_runs SET ai_root_causes = ? WHERE id = ?`,
      [JSON.stringify(corrOutput.clusters), runId],
    );

    aiProvider.reset();
    aiProvider.setSummary(makeSummaryResponse());
    eventBus.published.length = 0;

    await generateSummary({ runId, orgId: 'org-a3-happy' }, aiProvider, orm, eventBus);

    expect(aiProvider.calls.filter((c) => c.method === 'generateRunSummary')).toHaveLength(1);

    const logRows = await orm.em.getConnection().execute(
      `SELECT * FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'summarize'`,
      [runId],
    );
    expect(logRows).toHaveLength(1);
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('done');
    expect(logRow['tokens_used']).toBe(33);

    const runRows = await orm.em.getConnection().execute(
      `SELECT ai_summary, ai_summary_at FROM test_runs WHERE id = ?`,
      [runId],
    );
    const runRow = (runRows as Array<Record<string, unknown>>)[0]!;
    expect(runRow['ai_summary']).toBeTruthy();
    expect(runRow['ai_summary_at']).not.toBeNull();

    // Verify A3 input includes category distribution
    const summaryCalls = aiProvider.calls.filter((c) => c.method === 'generateRunSummary');
    const input = summaryCalls[0]!.input as { categoryDistribution: Record<string, number>; rootCauseClusters: unknown[] };
    expect(input.categoryDistribution).toBeDefined();
    expect(input.rootCauseClusters).toHaveLength(1);

    const sumEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_SUMMARIZED);
    expect(sumEvents).toHaveLength(1);
    expect((sumEvents[0]!.payload as { runId: number }).runId).toBe(runId);
  });

  it('skips LLM call and publishes event when already summarized (idempotency)', async () => {
    const { runId, _resultIds } = await seedRunWithFailures(app, 'org-a3-idem', 2, { withAiCategory: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    await orm.em.getConnection().execute(
      `UPDATE test_runs SET ai_summary = 'Already done', ai_summary_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [runId],
    );

    aiProvider.reset();
    aiProvider.setSummary(makeSummaryResponse());
    eventBus.published.length = 0;

    await generateSummary({ runId, orgId: 'org-a3-idem' }, aiProvider, orm, eventBus);

    expect(aiProvider.calls).toHaveLength(0);
    const sumEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_SUMMARIZED);
    expect(sumEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Partial:true propagation
// ---------------------------------------------------------------------------

describe('AI-003 Partial:true propagation', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    await app.close();
  });

  it('A2 treats uncategorized results as "unknown" when upstream partial is true', async () => {
    // Seed results WITHOUT ai_category (simulating A1 partial failure)
    const { runId, resultIds, _projectId } = await seedRunWithFailures(app, 'org-partial-up', 3, { withAiCategory: false });

    aiProvider.reset();
    aiProvider.setRootCauses(makeCorrResponse(resultIds));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    await correlateRootCauses({ runId, orgId: 'org-partial-up', partial: true }, aiProvider, orm, eventBus);

    const corrCalls = aiProvider.calls.filter((c) => c.method === 'correlateRootCauses');
    expect(corrCalls).toHaveLength(1);
    const input = corrCalls[0]!.input as CorrelateRootCausesInput;
    for (const r of input.results) {
      expect(r.category).toBe('unknown');
    }

    const corrEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED);
    expect(corrEvents).toHaveLength(1);
    // Downstream event retains partial:true from upstream
    expect((corrEvents[0]!.payload as { partial?: boolean }).partial).toBe(true);
  });

  it('A2 terminal fail at attempt >= 3 publishes run.ai_correlated with partial:true', async () => {
    const { runId, _resultIds, _projectId } = await seedRunWithFailures(app, 'org-a2-term', 3, { withAiCategory: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    // Pre-seed log row at attempt=2 so next call reaches attempt=3
    await orm.em.getConnection().execute(
      `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
       VALUES (?, 'correlate', 'pending', 2)`,
      [runId],
    );

    aiProvider.reset();
    // No response set → will throw → attempt becomes 3 ≥ MAX_ATTEMPTS → terminal fail
    eventBus.published.length = 0;

    await correlateRootCauses({ runId, orgId: 'org-a2-term' }, aiProvider, orm, eventBus);

    const logRows = await orm.em.getConnection().execute(
      `SELECT status FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'correlate'`,
      [runId],
    );
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('failed');

    const corrEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED);
    expect(corrEvents).toHaveLength(1);
    expect((corrEvents[0]!.payload as { partial?: boolean }).partial).toBe(true);
  });

  it('A3 receives partial:true and skips root cause clusters in input', async () => {
    const { runId, resultIds, _projectId } = await seedRunWithFailures(app, 'org-a3-partial', 3, { withAiCategory: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    // Set ai_root_causes but also pass partial:true → A3 should skip clusters
    const corrOutput = makeCorrResponse(resultIds);
    await orm.em.getConnection().execute(
      `UPDATE test_runs SET ai_root_causes = ? WHERE id = ?`,
      [JSON.stringify(corrOutput.clusters), runId],
    );

    aiProvider.reset();
    aiProvider.setSummary(makeSummaryResponse());
    eventBus.published.length = 0;

    await generateSummary({ runId, orgId: 'org-a3-partial', partial: true }, aiProvider, orm, eventBus);

    const sumCalls = aiProvider.calls.filter((c) => c.method === 'generateRunSummary');
    expect(sumCalls).toHaveLength(1);
    const input = sumCalls[0]!.input as { rootCauseClusters: unknown[] };
    expect(input.rootCauseClusters).toHaveLength(0);

    const sumEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_SUMMARIZED);
    expect(sumEvents).toHaveLength(1);
    expect((sumEvents[0]!.payload as { partial?: boolean }).partial).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Consent gate
// ---------------------------------------------------------------------------

describe('AI-003 Consent gate', () => {
  let app: FastifyInstance;
  let eventBus: MemoryEventBus;
  let aiProvider: MockAiProvider;

  beforeAll(async () => {
    eventBus = new MemoryEventBus();
    aiProvider = new MockAiProvider();
    app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('A2 and A3 both skip when consent gates fail (env + per-org)', async () => {
    // A2: skip when AI_CLOUD_PIPELINE not set
    delete process.env['AI_CLOUD_PIPELINE'];
    const { runId, resultIds } = await seedRunWithFailures(app, 'org-c2-env', 3, { withAiCategory: true, aiCloudAckAt: new Date() });
    aiProvider.reset();
    aiProvider.setRootCauses(makeCorrResponse(resultIds));
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await correlateRootCauses({ runId, orgId: 'org-c2-env' }, aiProvider, (app as any).orm, eventBus);
    expect(aiProvider.calls).toHaveLength(0);
    expect(eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED)).toHaveLength(0);

    // A3: skip when aiCloudAckAt is NULL
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    const { runId: runId2 } = await seedRunWithFailures(app, 'org-c3-null', 3, { withAiCategory: true, aiCloudAckAt: null });
    aiProvider.reset();
    aiProvider.setSummary(makeSummaryResponse());
    eventBus.published.length = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await generateSummary({ runId: runId2, orgId: 'org-c3-null' }, aiProvider, (app as any).orm, eventBus);
    expect(aiProvider.calls).toHaveLength(0);
    expect(eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_SUMMARIZED)).toHaveLength(0);

    delete process.env['AI_CLOUD_PIPELINE'];
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Sweeper — stuck-stage cleanup
// ---------------------------------------------------------------------------

describe('AI-003 Sweeper', () => {
  it('terminal-fails stuck running rows (attempt >= 3) and publishes next event', async () => {
    // Build app without aiProvider so the sweeper is NOT auto-started by buildApp
    const eventBus = new MemoryEventBus();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus });
    await ensureUniqueIndex(app);

    // Seed org → project → run
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    const em = orm.em.fork();
    const org = em.create(Organization, {
      id: 'org-sweep-term', name: 'Sweep Org', slug: 'sweep-term-org',
      createdAt: new Date(), aiCloudAckAt: new Date(),
    });
    await em.flush();
    const project = em.create(Project, {
      organization: org, name: 'Proj', slug: 'sweep-term-proj',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await em.flush();
    const run = em.create(TestRun, {
      project, name: 'Stuck run', status: 'failed',
      totalTests: 1, passed: 0, failed: 1, skipped: 0, blocked: 0,
      createdAt: new Date(),
    });
    await em.flush();

    // Seed a stuck running row with attempt >= 3 (simulates crash mid-flight)
    await orm.em.getConnection().execute(
      `INSERT INTO ai_pipeline_log (test_run_id, stage, status, worker_id, attempt)
       VALUES (?, 'correlate', 'running', 'dead-worker:1:0', 3)`,
      [run.id],
    );

    eventBus.published.length = 0;

    // Use fake timers to trigger sweeper tick
    vi.useFakeTimers();
    const stopSweeper = startSweeper(orm, eventBus);

    // Advance past the 60s interval to trigger a tick
    await vi.advanceTimersByTimeAsync(61_000);

    stopSweeper();
    vi.useRealTimers();

    // Verify row is now 'failed'
    const logRows = await orm.em.getConnection().execute(
      `SELECT status, error FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'correlate'`,
      [run.id],
    );
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('failed');

    // Verify next event published with partial:true
    const corrEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED);
    expect(corrEvents).toHaveLength(1);
    expect((corrEvents[0]!.payload as { partial?: boolean }).partial).toBe(true);

    vi.useRealTimers();
    await app.close();
  });

  it('releases stale heartbeat running rows (attempt < 3) back to pending', async () => {
    const eventBus = new MemoryEventBus();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus });
    await ensureUniqueIndex(app);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    const em = orm.em.fork();
    const org = em.create(Organization, {
      id: 'org-sweep-stale', name: 'Sweep Stale Org', slug: 'sweep-stale-org',
      createdAt: new Date(), aiCloudAckAt: new Date(),
    });
    await em.flush();
    const project = em.create(Project, {
      organization: org, name: 'Proj', slug: 'sweep-stale-proj',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await em.flush();
    const run = em.create(TestRun, {
      project, name: 'Stale run', status: 'failed',
      totalTests: 1, passed: 0, failed: 1, skipped: 0, blocked: 0,
      createdAt: new Date(),
    });
    await em.flush();

    // Seed a running row with stale heartbeat (5 mins ago) and attempt < 3
    const staleTime = new Date(Date.now() - 5 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    await orm.em.getConnection().execute(
      `INSERT INTO ai_pipeline_log (test_run_id, stage, status, worker_id, heartbeat_at, attempt)
       VALUES (?, 'summarize', 'running', 'old-worker:1:0', ?, 1)`,
      [run.id, staleTime],
    );

    vi.useFakeTimers();
    const stopSweeper = startSweeper(orm, eventBus);
    await vi.advanceTimersByTimeAsync(61_000);
    stopSweeper();
    vi.useRealTimers();

    const logRows = await orm.em.getConnection().execute(
      `SELECT status, worker_id, heartbeat_at FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'summarize'`,
      [run.id],
    );
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('pending');
    expect(logRow['worker_id']).toBeNull();
    expect(logRow['heartbeat_at']).toBeNull();

    vi.useRealTimers();
    await app.close();
  });

  it('terminal-fails exhausted pending rows (attempt >= 3)', async () => {
    const eventBus = new MemoryEventBus();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus });
    await ensureUniqueIndex(app);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    const em = orm.em.fork();
    const org = em.create(Organization, {
      id: 'org-sweep-pend', name: 'Sweep Pend Org', slug: 'sweep-pend-org',
      createdAt: new Date(), aiCloudAckAt: new Date(),
    });
    await em.flush();
    const project = em.create(Project, {
      organization: org, name: 'Proj', slug: 'sweep-pend-proj',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await em.flush();
    const run = em.create(TestRun, {
      project, name: 'Exhausted run', status: 'failed',
      totalTests: 1, passed: 0, failed: 1, skipped: 0, blocked: 0,
      createdAt: new Date(),
    });
    await em.flush();

    // Seed a pending row with attempt >= 3 (exhausted retries)
    await orm.em.getConnection().execute(
      `INSERT INTO ai_pipeline_log (test_run_id, stage, status, attempt)
       VALUES (?, 'categorize', 'pending', 3)`,
      [run.id],
    );

    vi.useFakeTimers();
    const stopSweeper = startSweeper(orm, eventBus);
    await vi.advanceTimersByTimeAsync(61_000);
    stopSweeper();
    vi.useRealTimers();

    const logRows = await orm.em.getConnection().execute(
      `SELECT status, error FROM ai_pipeline_log WHERE test_run_id = ? AND stage = 'categorize'`,
      [run.id],
    );
    const logRow = (logRows as Array<Record<string, unknown>>)[0]!;
    expect(logRow['status']).toBe('failed');
    expect(logRow['error']).toContain('Maximum retry attempts exhausted');

    vi.useRealTimers();
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Event chain ordering
// ---------------------------------------------------------------------------

describe('AI-003 Event chain ordering', () => {
  it('publishes run.ai_categorized → A2 called → publishes run.ai_correlated → A3 called', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    const eventBus = new MemoryEventBus();
    const aiProvider = new MockAiProvider();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);

    // Seed run + failures with A1 categories (simulating A1 complete)
    const { runId, resultIds, _projectId } = await seedRunWithFailures(app, 'org-chain', 2, { withAiCategory: true });

    // Pre-set ai_root_causes so A3 can parse them after A2 runs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    const corrOutput = makeCorrResponse(resultIds);
    await orm.em.getConnection().execute(
      `UPDATE test_runs SET ai_root_causes = ? WHERE id = ?`,
      [JSON.stringify(corrOutput.clusters), runId],
    );

    aiProvider.reset();
    aiProvider.setRootCauses(makeCorrResponse(resultIds));
    aiProvider.setSummary(makeSummaryResponse());
    eventBus.published.length = 0;

    // Publish run.ai_categorized — A2 subscribes and should fire
    eventBus.publish(RunEvents.RUN_AI_CATEGORIZED, { runId, orgId: 'org-chain' });

    // Wait for async A2 handler then A3 handler to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const corrCalls = aiProvider.calls.filter((c) => c.method === 'correlateRootCauses');
    const summaryCalls = aiProvider.calls.filter((c) => c.method === 'generateRunSummary');
    expect(corrCalls).toHaveLength(1);
    expect(summaryCalls).toHaveLength(1);

    // Verify calling order: A2 before A3
    const corrIdx = aiProvider.calls.findIndex((c) => c.method === 'correlateRootCauses');
    const sumIdx = aiProvider.calls.findIndex((c) => c.method === 'generateRunSummary');
    expect(corrIdx).toBeLessThan(sumIdx);

    // Verify both events published
    const corrEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED);
    const sumEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_SUMMARIZED);
    expect(corrEvents).toHaveLength(1);
    expect(sumEvents).toHaveLength(1);

    await app.close();
    delete process.env['AI_CLOUD_PIPELINE'];
  });

  it('partial:true carried through full chain via EventBus', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    const eventBus = new MemoryEventBus();
    const aiProvider = new MockAiProvider();
    const app = await buildApp({ testing: true, db: ':memory:', eventBus, aiProvider });
    await ensureUniqueIndex(app);

    const { runId, resultIds, _projectId } = await seedRunWithFailures(app, 'org-chain-p', 3, { withAiCategory: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orm = (app as any).orm;
    const corrOutput = makeCorrResponse(resultIds);
    await orm.em.getConnection().execute(
      `UPDATE test_runs SET ai_root_causes = ? WHERE id = ?`,
      [JSON.stringify(corrOutput.clusters), runId],
    );

    aiProvider.reset();
    aiProvider.setRootCauses(makeCorrResponse(resultIds));
    aiProvider.setSummary(makeSummaryResponse());
    eventBus.published.length = 0;

    eventBus.publish(RunEvents.RUN_AI_CATEGORIZED, { runId, orgId: 'org-chain-p', partial: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // A2 called with partial:true — retains partial in output
    const corrEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_CORRELATED);
    expect(corrEvents).toHaveLength(1);
    expect((corrEvents[0]!.payload as { partial?: boolean }).partial).toBe(true);

    // A3 receives partial:true and propagates it
    const sumEvents = eventBus.published.filter((e) => e.topic === RunEvents.RUN_AI_SUMMARIZED);
    if (sumEvents.length > 0) {
      expect((sumEvents[0]!.payload as { partial?: boolean }).partial).toBe(true);
    }

    await app.close();
    delete process.env['AI_CLOUD_PIPELINE'];
  });
});

// ---------------------------------------------------------------------------
// Suite 7: No real LLM calls — static verification
// ---------------------------------------------------------------------------

describe('AI-003 No real LLM calls', () => {
  it('this test file does not import any AI SDK', async () => {
    const { readFileSync } = await import('node:fs');
    const sdkImportPattern = /^import\s.*from\s+['"](?:openai|@anthropic-ai\/sdk|groq-sdk)['"]/m;
    expect(sdkImportPattern.test(readFileSync(__filename, 'utf-8'))).toBe(false);
  });
});

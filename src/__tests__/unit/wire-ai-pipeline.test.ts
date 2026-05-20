/**
 * Unit tests — `wireAiPipeline()` composition-root wiring helper
 * (audit-composition-root-S2, finding #2).
 *
 * Layer 1 (pure-ish wiring function) — verifies the three contract
 * properties the brief calls out:
 *
 *   1. The three EventBus subscribers are registered on the correct
 *      topics in the `'ai'` consumer group:
 *        A1 `categorizeRun`      ← `RunEvents.RUN_INGESTED`        ('run.ingested')
 *        A2 `correlateRootCauses`← `RunEvents.RUN_AI_CATEGORIZED`  ('run.ai_categorized')
 *        A3 `generateSummary`    ← `RunEvents.RUN_AI_CORRELATED`   ('run.ai_correlated')
 *      (Event names confirmed from `src/services/event-bus.ts` —
 *       `RunEvents` constants are the single source of truth. The
 *       brief lists draft hyphenated names; the canonical
 *       underscored names are used here.)
 *
 *   2. The stuck-stage sweeper is started — `setInterval` is invoked
 *      during wiring — and the returned `stopSweeper()` handle
 *      cancels that timer (proving `startSweeper`'s cleanup closure
 *      is wired through to the composition root for shutdown).
 *
 *   3. `wireAiPipeline()` does not throw on the minimal stubbed
 *      inputs (a recording `EventBus` double, a `MockAiProvider`,
 *      and an `orm` whose connection returns empty rows so
 *      recovery is a no-op).
 *
 * No real DB, no Fastify boot, no real timers — the sweeper interval
 * is asserted by spying on `setInterval`, never allowed to tick.
 *
 * @see src/services/ai/pipeline/wire.ts
 * @see .argos/stories/audit-composition-root-S2/brief.md
 * @see skills/vitest-three-layer-testing.md §Layer 1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MikroORM } from '@mikro-orm/core';
import {
  wireAiPipeline,
  type WiredAiPipeline,
} from '../../services/ai/pipeline/wire.js';
import {
  RunEvents,
  type EventBus,
  type EventHandler,
} from '../../services/event-bus.js';
import { MockAiProvider } from '../doubles/MockAiProvider.js';

// ---------------------------------------------------------------------------
// Test doubles — minimal, honest implementations of the dep surface
// ---------------------------------------------------------------------------

/** Recorded `subscribe()` invocation — what topic, what group, what handler. */
interface RecordedSubscription {
  group: string;
  topic: string;
  handler: EventHandler;
}

/**
 * Recording EventBus — implements the full `EventBus` interface honestly.
 * `subscribe()` records the call; `publish()` and `close()` are no-ops we
 * never exercise because the unit test does not fire events.
 */
function createRecordingEventBus(): EventBus & { subscriptions: RecordedSubscription[] } {
  const subscriptions: RecordedSubscription[] = [];
  return {
    subscriptions,
    publish: () => { /* no-op — wiring does not publish during this unit test */ },
    subscribe: (group, topic, handler) => {
      subscriptions.push({ group, topic, handler });
    },
    close: async () => { /* no-op */ },
  };
}

/**
 * Stub `MikroORM` with a connection whose `execute()` returns an empty array.
 * Lets `recoverStalePipelineRows` and the sweeper's first SELECT run
 * cleanly — no rows to recover, no rows to sweep.
 */
function createStubOrm(): MikroORM {
  const connection = {
    execute: vi.fn(async () => []),
  };
  return {
    em: {
      getConnection: () => connection,
    },
  } as unknown as MikroORM;
}

/**
 * Stub Fastify instance exposing only `app.log` — the single surface
 * `wireAiPipeline()` uses. `error` is the only level the function
 * touches (recovery failure + handler failure); we make it a no-op
 * spy so an accidental log call is observable but harmless.
 */
function createStubApp(): FastifyInstance {
  return {
    log: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as FastifyInstance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wireAiPipeline (composition-root wiring)', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let clearIntervalSpy: ReturnType<typeof vi.spyOn>;
  let intervalHandle: unknown;

  beforeEach(() => {
    intervalHandle = undefined;
    // Capture the sweeper's timer creation without letting it tick.
    // The sweeper schedules a real 60s interval via `setInterval` —
    // we replace it with a no-op that still returns a sentinel
    // handle so `clearInterval` matching can be asserted.
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      _fn: () => void,
      _ms?: number,
    ) => {
      intervalHandle = { __sweeperHandle: true };
      return intervalHandle as unknown as NodeJS.Timeout;
    }) as typeof setInterval);
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {
      /* no-op */
    });
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('registers A1, A2, A3 subscribers on the canonical run events in the ai consumer group, starts the sweeper, and returns a stopSweeper handle wired to clearInterval', async () => {
    // Arrange
    const eventBus = createRecordingEventBus();
    const aiProvider = new MockAiProvider();
    const orm = createStubOrm();
    const app = createStubApp();

    // Act — must not throw / reject on minimal inputs
    let wired: WiredAiPipeline | undefined;
    let thrown: unknown = undefined;
    try {
      wired = await wireAiPipeline(app, { eventBus, aiProvider, orm });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeUndefined();

    // ── Assertion 1: three subscribers, on the canonical topics ────
    // Order is wire.ts's documented order: A1, then A2, then A3.
    expect(eventBus.subscriptions).toHaveLength(3);

    // A1 categorizeRun ← run.ingested
    expect(eventBus.subscriptions[0]).toMatchObject({
      group: 'ai',
      topic: RunEvents.RUN_INGESTED, // 'run.ingested'
    });
    expect(typeof eventBus.subscriptions[0]!.handler).toBe('function');

    // A2 correlateRootCauses ← run.ai_categorized
    expect(eventBus.subscriptions[1]).toMatchObject({
      group: 'ai',
      topic: RunEvents.RUN_AI_CATEGORIZED, // 'run.ai_categorized'
    });
    expect(typeof eventBus.subscriptions[1]!.handler).toBe('function');

    // A3 generateSummary ← run.ai_correlated
    expect(eventBus.subscriptions[2]).toMatchObject({
      group: 'ai',
      topic: RunEvents.RUN_AI_CORRELATED, // 'run.ai_correlated'
    });
    expect(typeof eventBus.subscriptions[2]!.handler).toBe('function');

    // ── Assertion 2: sweeper started + handle wired through ───────
    // `startSweeper` schedules a `setInterval`; the returned closure
    // calls `clearInterval(intervalId)`. If `stopSweeper()` is wired
    // correctly the same handle round-trips.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(intervalHandle).toBeDefined();

    expect(wired).toBeDefined();
    expect(typeof wired!.stopSweeper).toBe('function');

    wired!.stopSweeper();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);

    // ── Assertion 3 (implied): no errors logged on the happy path ─
    // Recovery is a no-op (empty ORM); no subscriber fired. The
    // sole error path through `app.log.error` should not have run.
    expect((app.log.error as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

/**
 * EventBus contract tests — INFRA-004
 *
 * Reusable contract: swap the factory to test RedisEventBus, NatsEventBus, etc.
 * Layer 1 (unit) — MemoryEventBus has zero I/O (synchronous dispatch).
 *
 * @see src/lib/event-bus.ts
 * @see skills/vitest-three-layer-testing.md §Interface-based test doubles
 */

import { MemoryEventBus } from '../doubles/MemoryEventBus.js';
import type { EventBus, DomainEvent } from '../../lib/event-bus.js';

function createEventBus(): EventBus {
  return new MemoryEventBus();
}

function makeEvent<T = unknown>(type: string, data: T): DomainEvent<T> {
  return { type, data, timestamp: new Date().toISOString() };
}

describe('EventBus contract', () => {
  let bus: EventBus;

  beforeEach(() => { bus = createEventBus(); });
  afterEach(async () => { await bus.close(); });

  it('delivers published events to subscribers', async () => {
    const received: DomainEvent[] = [];
    bus.subscribe('run.ingested', (e) => { received.push(e); });
    await bus.publish(makeEvent('run.ingested', { runId: 42 }));
    expect(received).toHaveLength(1);
    expect(received[0]!.data).toEqual({ runId: 42 });
  });

  it('routes events only to subscribers of matching type', async () => {
    const categorized: DomainEvent[] = [];
    const ingested: DomainEvent[] = [];
    bus.subscribe('run.ai_categorized', (e) => { categorized.push(e); });
    bus.subscribe('run.ingested', (e) => { ingested.push(e); });
    await bus.publish(makeEvent('run.ingested', { runId: 1 }));
    expect(ingested).toHaveLength(1);
    expect(categorized).toHaveLength(0);
  });

  it('delivers to multiple handlers for same event type', async () => {
    let h1 = false, h2 = false;
    bus.subscribe('run.ingested', () => { h1 = true; });
    bus.subscribe('run.ingested', () => { h2 = true; });
    await bus.publish(makeEvent('run.ingested', { runId: 1 }));
    expect(h1).toBe(true);
    expect(h2).toBe(true);
  });

  it('silently succeeds when publishing with no subscribers', async () => {
    await expect(bus.publish(makeEvent('unsubscribed.event', {}))).resolves.toBeUndefined();
  });

  it('unsubscribe() stops delivery to the removed handler', async () => {
    const received: DomainEvent[] = [];
    const handler = (e: DomainEvent) => { received.push(e); };
    bus.subscribe('run.ingested', handler);
    await bus.publish(makeEvent('run.ingested', { runId: 1 }));
    expect(received).toHaveLength(1);
    bus.unsubscribe('run.ingested', handler);
    await bus.publish(makeEvent('run.ingested', { runId: 2 }));
    expect(received).toHaveLength(1);
  });

  it('subscribe() returns a convenience unsubscribe function', async () => {
    const received: DomainEvent[] = [];
    const unsub = bus.subscribe('run.ingested', (e) => { received.push(e); });
    await bus.publish(makeEvent('run.ingested', { runId: 1 }));
    expect(received).toHaveLength(1);
    unsub();
    await bus.publish(makeEvent('run.ingested', { runId: 2 }));
    expect(received).toHaveLength(1);
  });

  it('close() clears all subscriptions', async () => {
    const received: DomainEvent[] = [];
    bus.subscribe('run.ingested', (e) => { received.push(e); });
    await bus.close();
    await bus.publish(makeEvent('run.ingested', { runId: 1 }));
    expect(received).toHaveLength(0);
  });
});

describe('MemoryEventBus assertion helpers', () => {
  let bus: MemoryEventBus;
  beforeEach(() => { bus = new MemoryEventBus(); });
  afterEach(async () => { await bus.close(); });

  it('publishedEvents tracks all published events in order', async () => {
    const e1 = makeEvent('a', { id: 1 });
    const e2 = makeEvent('b', { id: 2 });
    await bus.publish(e1);
    await bus.publish(e2);
    expect(bus.publishedEvents).toHaveLength(2);
    expect(bus.publishedEvents[0]).toBe(e1);
    expect(bus.publishedEvents[1]).toBe(e2);
  });

  it('publishedCount() returns total or filtered count', async () => {
    await bus.publish(makeEvent('a', {}));
    await bus.publish(makeEvent('b', {}));
    await bus.publish(makeEvent('a', {}));
    expect(bus.publishedCount()).toBe(3);
    expect(bus.publishedCount('a')).toBe(2);
    expect(bus.publishedCount('b')).toBe(1);
    expect(bus.publishedCount('c')).toBe(0);
  });

  it('eventsOfType() returns only events of given type', async () => {
    await bus.publish(makeEvent('a', { x: 1 }));
    await bus.publish(makeEvent('b', { y: 2 }));
    await bus.publish(makeEvent('a', { x: 3 }));
    const typeA = bus.eventsOfType('a');
    expect(typeA).toHaveLength(2);
    expect(typeA[0]!.data).toEqual({ x: 1 });
    expect(typeA[1]!.data).toEqual({ x: 3 });
  });

  it('clear() resets history and subscriptions', async () => {
    const received: DomainEvent[] = [];
    bus.subscribe('a', (e) => received.push(e));
    await bus.publish(makeEvent('a', {}));
    bus.clear();
    expect(bus.publishedEvents).toHaveLength(0);
    await bus.publish(makeEvent('a', {}));
    expect(received).toHaveLength(1); // Only the pre-clear event
  });
});

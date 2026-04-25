/**
 * MemoryEventBus — in-memory test double for the EventBus interface.
 *
 * Used in integration tests via `buildApp({ eventBus: new MemoryEventBus() })`.
 * Processes events **synchronously** so tests can assert on side effects
 * immediately after publishing — no timing issues.
 *
 * Provides additional assertion helpers:
 * - `.publishedEvents` — array of all events published in order
 * - `.publishedCount(type?)` — count of events, optionally filtered by type
 * - `.clear()` — reset published history
 *
 * This class implements the same contract that a production in-process
 * EventBus or Redis-backed EventBus would. The contract test file
 * (`event-bus.contract.test.ts`) can be reused for any implementation.
 *
 * @see src/lib/event-bus.ts — the interface this implements
 * @see skills/vitest-three-layer-testing.md §Interface-based test doubles
 */

import type { EventBus, DomainEvent, EventHandler } from '../../lib/event-bus.js';

/**
 * In-memory event bus for testing.
 *
 * Handlers run synchronously within `publish()` so tests can assert
 * on side effects immediately after the call returns.
 */
export class MemoryEventBus implements EventBus {
  /** Handlers keyed by event type. */
  private readonly handlers = new Map<string, Set<EventHandler>>();

  /** Ordered log of every event published — for test assertions. */
  readonly publishedEvents: DomainEvent[] = [];

  async publish<T = unknown>(event: DomainEvent<T>): Promise<void> {
    this.publishedEvents.push(event as DomainEvent);

    const typeHandlers = this.handlers.get(event.type);
    if (!typeHandlers) return;

    // Run handlers synchronously for deterministic test assertions
    for (const handler of typeHandlers) {
      await handler(event as DomainEvent);
    }
  }

  subscribe<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
    let typeHandlers = this.handlers.get(eventType);
    if (!typeHandlers) {
      typeHandlers = new Set();
      this.handlers.set(eventType, typeHandlers);
    }

    const castHandler = handler as EventHandler;
    typeHandlers.add(castHandler);

    // Return an unsubscribe function for convenience
    return () => {
      typeHandlers!.delete(castHandler);
    };
  }

  unsubscribe<T = unknown>(eventType: string, handler: EventHandler<T>): void {
    const typeHandlers = this.handlers.get(eventType);
    if (typeHandlers) {
      typeHandlers.delete(handler as EventHandler);
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }

  // ── Assertion helpers (test-only) ─────────────────────────────

  /**
   * Count of published events, optionally filtered by event type.
   */
  publishedCount(type?: string): number {
    if (type) {
      return this.publishedEvents.filter(e => e.type === type).length;
    }
    return this.publishedEvents.length;
  }

  /**
   * Get all published events of a specific type.
   */
  eventsOfType<T = unknown>(type: string): DomainEvent<T>[] {
    return this.publishedEvents.filter(e => e.type === type) as DomainEvent<T>[];
  }

  /**
   * Clear published event history and all subscriptions. Useful in beforeEach() cleanup.
   */
  clear(): void {
    this.publishedEvents.length = 0;
    this.handlers.clear();
  }
}

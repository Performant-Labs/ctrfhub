/**
 * EventBus — in-process pub/sub for domain events.
 *
 * Implementations:
 * - In-process `MemoryEventBus` (default, single-node)
 * - Redis-backed `RedisEventBus` (optional, multi-instance)
 * - `MemoryEventBus` test double (integration tests — synchronous dispatch)
 *
 * Domain events drive the AI pipeline (run.ingested → A1 categorize → A2
 * correlate → A3 summarize) and real-time SSE updates. The EventBus itself
 * is a thin routing layer — it does not own durability (that lives in
 * `ai_pipeline_log`).
 *
 * @see docs/planning/architecture.md §Event Bus
 * @see skills/ai-pipeline-event-bus.md
 */

/**
 * Payload shape for domain events.
 *
 * Each event carries a `type` discriminator and an arbitrary `data` payload.
 * Specific event types are defined as needed by consuming modules.
 */
export interface DomainEvent<T = unknown> {
  /** Event type discriminator (e.g. "run.ingested", "run.ai_categorized"). */
  type: string;

  /** Event payload — shape varies by event type. */
  data: T;

  /** ISO-8601 timestamp when the event was created. */
  timestamp: string;
}

/**
 * Handler function invoked when a matching event is published.
 */
export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

/**
 * Interface for the application event bus.
 *
 * Contract:
 * - `publish()` enqueues an event for all registered handlers of that type.
 * - `subscribe()` registers a handler for events of a given type.
 * - `unsubscribe()` removes a previously registered handler.
 * - `close()` tears down any connections or timers (e.g. Redis pub/sub).
 *
 * In production, handlers run asynchronously (fire-and-forget). In tests,
 * `MemoryEventBus` processes handlers synchronously for deterministic assertions.
 */
export interface EventBus {
  /**
   * Publish an event to all subscribers of the given event type.
   */
  publish<T = unknown>(event: DomainEvent<T>): Promise<void>;

  /**
   * Register a handler for events of the given type.
   *
   * @returns An unsubscribe function for convenience.
   */
  subscribe<T = unknown>(eventType: string, handler: EventHandler<T>): () => void;

  /**
   * Remove a previously registered handler.
   */
  unsubscribe<T = unknown>(eventType: string, handler: EventHandler<T>): void;

  /**
   * Gracefully shut down the event bus.
   *
   * For Redis-backed implementations, this closes the pub/sub connection.
   * For in-memory implementations, this clears all subscriptions.
   */
  close(): Promise<void>;
}

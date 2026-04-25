/**
 * EventBus — In-process pub/sub for inter-service communication.
 *
 * The AI pipeline (A1–A4 stages) subscribes to `run.ingested` via the
 * EventBus; SSE push notifications will subscribe to `run.created` (when
 * that distinction is reconciled — see CTRF-002 feature-handoff).
 *
 * MVP uses an in-process `MemoryEventBus`. The interface is designed so
 * a Redis- or NATS-backed implementation can drop in without changing
 * publisher or subscriber code.
 *
 * @see skills/ai-pipeline-event-bus.md — event chain and subscription groups
 * @see docs/planning/ai-features.md §86 — `run.ingested` trigger
 */

// ---------------------------------------------------------------------------
// Event name constants — single source of truth
// ---------------------------------------------------------------------------

/**
 * Canonical event names for the run lifecycle.
 *
 * Import `RunEvents.RUN_INGESTED` instead of using the raw string
 * `'run.ingested'` — a typo in a subscriber would silently miss events.
 *
 * @see skills/ctrf-ingest-validation.md §Post-ingest event
 */
export const RunEvents = {
  /** Fired after a CTRF report is persisted. AI pipeline A1 subscribes. */
  RUN_INGESTED: 'run.ingested',
  /** A1 categorization complete. AI pipeline A2 subscribes. */
  RUN_AI_CATEGORIZED: 'run.ai_categorized',
  /** A2 root-cause correlation complete. AI pipeline A3 subscribes. */
  RUN_AI_CORRELATED: 'run.ai_correlated',
  /** A3 summary generation complete. AI pipeline A4 subscribes (Phase 2). */
  RUN_AI_SUMMARIZED: 'run.ai_summarized',
} as const;

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

/**
 * Payload published with `RunEvents.RUN_INGESTED`.
 *
 * Downstream subscribers (AI A1 stage, SSE push) receive this shape.
 */
export interface RunIngestedPayload {
  /** Auto-increment PK of the newly created `test_runs` row. */
  runId: number;
  /** PK of the project the run belongs to. */
  projectId: number;
  /** Better Auth org ID (string PK on the `organization` table). */
  orgId: string;
}

// ---------------------------------------------------------------------------
// EventBus interface
// ---------------------------------------------------------------------------

/** Handler function invoked when an event is published on a subscribed topic. */
export type EventHandler<T = unknown> = (payload: T) => Promise<void>;

/**
 * EventBus abstraction for inter-service communication.
 *
 * - `publish()` is fire-and-forget from the publisher's perspective.
 * - `subscribe()` registers a handler in a named group. Groups allow
 *   future scale-out: when the bus moves to Redis, each group becomes
 *   a consumer group so only one worker per group processes each event.
 * - `close()` drains pending handlers and releases resources.
 */
export interface EventBus {
  /**
   * Publish an event to all subscribers of the given topic.
   *
   * Publishing is non-blocking — the caller does NOT await subscriber
   * completion. Errors in handlers are logged but never propagate to
   * the publisher.
   */
  publish(topic: string, payload: unknown): void;

  /**
   * Subscribe a handler to a topic within a named group.
   *
   * @param group - Logical consumer group (e.g. `'ai'`, `'sse'`).
   *   In MemoryEventBus every handler in every group receives the event.
   *   In a Redis-backed bus, only one handler per group would.
   * @param topic - Event topic string (use `RunEvents.*` constants).
   * @param handler - Async function invoked with the event payload.
   */
  subscribe(group: string, topic: string, handler: EventHandler): void;

  /** Drain pending work and release resources. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// MemoryEventBus — in-process implementation for MVP and tests
// ---------------------------------------------------------------------------

interface Subscription {
  group: string;
  handler: EventHandler;
}

/**
 * In-process EventBus backed by a plain `Map<topic, Subscription[]>`.
 *
 * Suitable for single-process MVP and integration tests. Handlers run
 * concurrently via `Promise.allSettled` — a failing handler never blocks
 * other subscribers or the publisher.
 *
 * Integration tests inject this via `buildApp({ eventBus: new MemoryEventBus() })`
 * and inspect `bus.published` to verify events were fired.
 */
export class MemoryEventBus implements EventBus {
  private subscriptions = new Map<string, Subscription[]>();

  /**
   * Record of all published events — available for test assertions.
   *
   * Each entry is `{ topic, payload }`. Tests can filter by topic:
   * ```ts
   * const ingested = bus.published.filter(e => e.topic === RunEvents.RUN_INGESTED);
   * expect(ingested).toHaveLength(1);
   * ```
   */
  public published: Array<{ topic: string; payload: unknown }> = [];

  publish(topic: string, payload: unknown): void {
    this.published.push({ topic, payload });

    const subs = this.subscriptions.get(topic);
    if (!subs || subs.length === 0) return;

    // Fire-and-forget: handlers run in the background.
    // Errors are caught and logged to prevent unhandled rejections.
    void Promise.allSettled(
      subs.map((sub) => sub.handler(payload)),
    ).catch(() => {
      // allSettled never rejects, but defensive catch for safety
    });
  }

  subscribe(group: string, topic: string, handler: EventHandler): void {
    const existing = this.subscriptions.get(topic) ?? [];
    existing.push({ group, handler });
    this.subscriptions.set(topic, existing);
  }

  async close(): Promise<void> {
    this.subscriptions.clear();
    // No pending async work to drain in the memory implementation
  }
}

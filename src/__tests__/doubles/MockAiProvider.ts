/**
 * MockAiProvider — SDK-free test double for the AiProvider interface.
 *
 * Used in integration tests via `buildApp({ aiProvider: new MockAiProvider() })`.
 * Records every invocation in a `calls[]` array for test assertions. Setter
 * methods seed deterministic responses — either a single value (returned on
 * every call) or a sequence (returned in order, throws when exhausted).
 *
 * **Behavior when no response is set:** Throws a descriptive error. This
 * catches test bugs early — a test forgetting to seed a response gets a
 * clear error rather than a silent `undefined`.
 *
 * **No SDK imports.** This file must never import `openai`, `@anthropic-ai/sdk`,
 * or `groq-sdk` — the mock is provider-agnostic by design.
 *
 * @see skills/ai-pipeline-event-bus.md §Test double
 * @see skills/vitest-three-layer-testing.md §Interface-based test doubles
 */

import type {
  AiProvider,
  CategorizeFailuresInput,
  CategorizeFailuresOutput,
  CorrelateRootCausesInput,
  CorrelateRootCausesOutput,
  GenerateRunSummaryInput,
  GenerateRunSummaryOutput,
} from '../../services/ai/types.js';

// ---------------------------------------------------------------------------
// Call recording types
// ---------------------------------------------------------------------------

/** A single recorded invocation of an AiProvider method. */
export interface MockAiProviderCall {
  /** Which AiProvider method was called. */
  method: 'categorizeFailures' | 'correlateRootCauses' | 'generateRunSummary';
  /** The input argument passed to the method (deep-cloned at recording time). */
  input: unknown;
}

// ---------------------------------------------------------------------------
// Response queue helper
// ---------------------------------------------------------------------------

/**
 * Internal response queue. Supports two modes:
 * 1. **Single response** — returned on every call (never exhausted).
 * 2. **Sequence** — returned in order; throws when exhausted.
 */
class ResponseQueue<T> {
  private single: T | undefined;
  private sequence: T[] | undefined;
  private sequenceIndex = 0;

  /** Seed a single response returned on every call. */
  setSingle(response: T): void {
    this.single = response;
    this.sequence = undefined;
    this.sequenceIndex = 0;
  }

  /** Seed a sequence of responses returned in order. */
  setSequence(responses: T[]): void {
    this.sequence = [...responses];
    this.sequenceIndex = 0;
    this.single = undefined;
  }

  /** Get the next response, or undefined if nothing is set. */
  next(methodName: string): T {
    // Single mode — always returns the same response
    if (this.single !== undefined) {
      return this.single;
    }

    // Sequence mode — returns next in order
    if (this.sequence !== undefined) {
      if (this.sequenceIndex < this.sequence.length) {
        const response = this.sequence[this.sequenceIndex]!;
        this.sequenceIndex++;
        return response;
      }
      throw new Error(
        `MockAiProvider.${methodName}(): response sequence exhausted ` +
        `(${this.sequence.length} responses seeded, call #${this.sequenceIndex + 1}). ` +
        `Seed more responses with the corresponding setter method.`,
      );
    }

    // Nothing set — throw
    throw new Error(
      `MockAiProvider.${methodName}() called but no response has been set. ` +
      `Call the corresponding setter method before invoking the AI provider. ` +
      `Available setters: setCategorization(), setRootCauses(), setSummary().`,
    );
  }

  /** Clear seeded responses. */
  clear(): void {
    this.single = undefined;
    this.sequence = undefined;
    this.sequenceIndex = 0;
  }

  /** Whether any response has been set. */
  get hasResponse(): boolean {
    return this.single !== undefined || this.sequence !== undefined;
  }
}

// ---------------------------------------------------------------------------
// MockAiProvider
// ---------------------------------------------------------------------------

/**
 * In-memory AI provider test double.
 *
 * @example
 * ```ts
 * const ai = new MockAiProvider();
 *
 * // Seed a single response (returned on every call)
 * ai.setCategorization({
 *   categories: [{ resultId: 1, category: 'app_defect', confidence: 0.95 }],
 *   model: 'mock',
 *   tokensUsed: 0,
 * });
 *
 * // Or seed a sequence (returned in order)
 * ai.setCategorization([response1, response2, response3]);
 *
 * const app = await buildApp({ testing: true, db: ':memory:', aiProvider: ai });
 *
 * // After the pipeline runs:
 * expect(ai.calls.filter(c => c.method === 'categorizeFailures')).toHaveLength(1);
 * ```
 */
export class MockAiProvider implements AiProvider {
  /**
   * Ordered log of every method invocation — for test assertions.
   *
   * Each entry records the method name and a deep clone of the input.
   */
  readonly calls: MockAiProviderCall[] = [];

  private readonly categorizationQueue = new ResponseQueue<CategorizeFailuresOutput>();
  private readonly rootCausesQueue = new ResponseQueue<CorrelateRootCausesOutput>();
  private readonly summaryQueue = new ResponseQueue<GenerateRunSummaryOutput>();

  // ── Setters — seed deterministic responses ────────────────────

  /**
   * Seed the response for `categorizeFailures()`.
   *
   * @param response - A single response (returned on every call) or an
   *   array of responses (returned in order; throws when exhausted).
   */
  setCategorization(response: CategorizeFailuresOutput | CategorizeFailuresOutput[]): void {
    if (Array.isArray(response)) {
      this.categorizationQueue.setSequence(response);
    } else {
      this.categorizationQueue.setSingle(response);
    }
  }

  /**
   * Seed the response for `correlateRootCauses()`.
   *
   * @param response - A single response or an array of responses.
   */
  setRootCauses(response: CorrelateRootCausesOutput | CorrelateRootCausesOutput[]): void {
    if (Array.isArray(response)) {
      this.rootCausesQueue.setSequence(response);
    } else {
      this.rootCausesQueue.setSingle(response);
    }
  }

  /**
   * Seed the response for `generateRunSummary()`.
   *
   * @param response - A single response or an array of responses.
   */
  setSummary(response: GenerateRunSummaryOutput | GenerateRunSummaryOutput[]): void {
    if (Array.isArray(response)) {
      this.summaryQueue.setSequence(response);
    } else {
      this.summaryQueue.setSingle(response);
    }
  }

  // ── AiProvider interface implementation ───────────────────────

  async categorizeFailures(input: CategorizeFailuresInput): Promise<CategorizeFailuresOutput> {
    this.calls.push({ method: 'categorizeFailures', input: structuredClone(input) });
    return this.categorizationQueue.next('categorizeFailures');
  }

  async correlateRootCauses(input: CorrelateRootCausesInput): Promise<CorrelateRootCausesOutput> {
    this.calls.push({ method: 'correlateRootCauses', input: structuredClone(input) });
    return this.rootCausesQueue.next('correlateRootCauses');
  }

  async generateRunSummary(input: GenerateRunSummaryInput): Promise<GenerateRunSummaryOutput> {
    this.calls.push({ method: 'generateRunSummary', input: structuredClone(input) });
    return this.summaryQueue.next('generateRunSummary');
  }

  async close(): Promise<void> {
    // No resources to release in the mock
  }

  // ── Test utilities ────────────────────────────────────────────

  /**
   * Clear all recorded calls and seeded responses.
   *
   * Useful in `beforeEach()` cleanup when reusing a single mock instance.
   */
  reset(): void {
    this.calls.length = 0;
    this.categorizationQueue.clear();
    this.rootCausesQueue.clear();
    this.summaryQueue.clear();
  }
}

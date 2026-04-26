/**
 * AiProvider — Interface and payload types for the AI pipeline.
 *
 * This is the **contract surface** for the entire AI pipeline (A1 categorization,
 * A2 root-cause correlation, A3 run narrative). Every downstream AI story
 * (AI-002, AI-003, AI-004) wires against these types.
 *
 * All types are SDK-agnostic — no OpenAI, Anthropic, or Groq SDK types leak
 * into these definitions. Real provider implementations convert between SDK
 * types and these types internally.
 *
 * @see docs/planning/ai-features.md §A1, §A2, §A3
 * @see skills/ai-pipeline-event-bus.md — event chain and pipeline stages
 */

// ---------------------------------------------------------------------------
// Failure category enum — shared across A1 and A2
// ---------------------------------------------------------------------------

/**
 * AI-assigned failure category for a single test result.
 *
 * Categories are defined in `ai-features.md §A1`:
 * - `app_defect`   — Code regression; the test caught a real bug
 * - `test_data`    — Bad seed data, missing fixtures, stale mocks
 * - `script_error` — Test itself is broken (wrong selector, bad assertion)
 * - `environment`  — Infrastructure failure (network, DB down, timeout)
 * - `unknown`      — Model cannot determine with confidence
 */
export type AiCategory =
  | 'app_defect'
  | 'test_data'
  | 'script_error'
  | 'environment'
  | 'unknown';

// ---------------------------------------------------------------------------
// A1 — Per-test failure categorization
// ---------------------------------------------------------------------------

/**
 * Input for `AiProvider.categorizeFailures()`.
 *
 * Callers batch results in groups of 20 and cap at 500 failed results
 * per run (see `ai-features.md §A1 batching`). Stack traces should be
 * truncated to 500 chars before calling.
 */
export interface CategorizeFailuresInput {
  /** PK of the test run being categorized. */
  runId: number;

  /** Batch of failed test results to categorize (max 20 per call). */
  results: Array<{
    /** PK of the test result row. */
    resultId: number;
    /** Test name (e.g. "checkout_flow > applies discount code"). */
    testName: string;
    /** Error message, or null if not captured. */
    errorMessage: string | null;
    /** First 500 chars of the stack trace, or null if not captured. */
    stackTrace: string | null;
  }>;
}

/**
 * Output from `AiProvider.categorizeFailures()`.
 *
 * One category per input result. The `model` field records which LLM
 * produced the categorization (written to `test_results.ai_category_model`).
 */
export interface CategorizeFailuresOutput {
  /** One category assignment per input result, matched by `resultId`. */
  categories: Array<{
    /** PK of the test result — must match an input `resultId`. */
    resultId: number;
    /** AI-assigned failure category. */
    category: AiCategory;
    /** Model's confidence in the assignment (0.0–1.0). */
    confidence: number;
  }>;

  /** Model identifier that produced this response (e.g. "gpt-4o-mini"). */
  model: string;

  /** Total tokens consumed by this API call. */
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// A2 — Root cause correlation
// ---------------------------------------------------------------------------

/**
 * Input for `AiProvider.correlateRootCauses()`.
 *
 * All failed results for a run, including their A1 categories. Sent as a
 * single LLM call (see `ai-features.md §A2`).
 */
export interface CorrelateRootCausesInput {
  /** PK of the test run being correlated. */
  runId: number;

  /** All failed results in the run, with their A1 categories. */
  results: Array<{
    /** PK of the test result row. */
    resultId: number;
    /** Test name. */
    testName: string;
    /** Error message, or null if not captured. */
    errorMessage: string | null;
    /** First 500 chars of the stack trace, or null if not captured. */
    stackTrace: string | null;
    /** A1-assigned category for this result. */
    category: AiCategory;
  }>;
}

/**
 * Output from `AiProvider.correlateRootCauses()`.
 *
 * Groups failures by apparent root cause into ≤ 10 clusters.
 * Written to `test_runs.ai_root_causes` as JSON.
 *
 * @see ai-features.md §A2 — cluster schema and limitations
 */
export interface CorrelateRootCausesOutput {
  /** Root cause clusters, max 10. */
  clusters: Array<{
    /** Human-readable label (e.g. "Database connection timeout"). */
    label: string;
    /** Dominant failure category for this cluster. */
    category: AiCategory;
    /** Model's confidence in the cluster grouping (0.0–1.0). */
    confidence: number;
    /** PKs of test results grouped into this cluster. */
    resultIds: number[];
    /** Plain English explanation of why these failures share a root cause. */
    explanation: string;
  }>;

  /** Model identifier that produced this response. */
  model: string;

  /** Total tokens consumed by this API call. */
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// A3 — Run narrative summary
// ---------------------------------------------------------------------------

/**
 * Input for `AiProvider.generateRunSummary()`.
 *
 * Aggregate metrics + A1/A2 output — no raw test names or error text
 * are sent for A3 (see `ai-features.md §Privacy — What is sent per stage`).
 */
export interface GenerateRunSummaryInput {
  /** PK of the test run. */
  runId: number;
  /** Total number of tests in the run. */
  totalTests: number;
  /** Number of tests that passed. */
  passed: number;
  /** Number of tests that failed. */
  failed: number;
  /** Number of tests that were skipped. */
  skipped: number;
  /** Environment name (e.g. "staging"), or null if not set. */
  environment: string | null;
  /** Git branch name, or null if not set. */
  branch: string | null;
  /** Git commit SHA, or null if not set. */
  commitSha: string | null;
  /** Count of failed tests per A1 category. */
  categoryDistribution: Record<AiCategory, number>;
  /** A2 root cause clusters (passed through from correlateRootCauses output). */
  rootCauseClusters: CorrelateRootCausesOutput['clusters'];
  /** Pass rate from the previous run for delta comparison, or null if first run. */
  previousPassRate: number | null;
}

/**
 * Output from `AiProvider.generateRunSummary()`.
 *
 * A 3–5 sentence plain English summary written to `test_runs.ai_summary`.
 */
export interface GenerateRunSummaryOutput {
  /** Plain English summary of the run (3–5 sentences). */
  summary: string;

  /** Model identifier that produced this response. */
  model: string;

  /** Total tokens consumed by this API call. */
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// AiProvider interface
// ---------------------------------------------------------------------------

/**
 * AI provider abstraction for the CTRFHub AI pipeline.
 *
 * Implementations: `OpenAiProvider`, `AnthropicProvider`, `GroqProvider`
 * (selected by `AI_PROVIDER` env var). Test double: `MockAiProvider`.
 *
 * The interface is SDK-agnostic — implementations convert between SDK
 * types and these types internally. This ensures:
 * 1. Tests never depend on a specific AI SDK
 * 2. Providers can be swapped without changing downstream code
 * 3. `MockAiProvider` stays SDK-free
 *
 * **Consent gate is NOT enforced at this level.** Each pipeline stage
 * (AI-002+) checks `AI_CLOUD_PIPELINE` and `organizations.ai_cloud_ack_at`
 * before calling these methods.
 *
 * @see skills/ai-pipeline-event-bus.md §Test double
 * @see docs/planning/ai-features.md §Provider Strategy
 */
export interface AiProvider {
  /**
   * Categorize a batch of failed test results.
   *
   * Called by the A1 pipeline stage. Callers batch in groups of 20.
   *
   * @param input - Batch of failed results with test name, error, stack trace
   * @returns Category assignment per result with confidence scores
   */
  categorizeFailures(input: CategorizeFailuresInput): Promise<CategorizeFailuresOutput>;

  /**
   * Correlate root causes across all failed results in a run.
   *
   * Called by the A2 pipeline stage. Single call with all failures.
   * Output capped at 10 clusters.
   *
   * @param input - All failed results in the run, with A1 categories
   * @returns Root cause clusters grouping failures by shared cause
   */
  correlateRootCauses(input: CorrelateRootCausesInput): Promise<CorrelateRootCausesOutput>;

  /**
   * Generate a plain English narrative summary of a test run.
   *
   * Called by the A3 pipeline stage. Input is aggregate metrics +
   * A1/A2 output — no raw test names or error text.
   *
   * @param input - Aggregate run metrics and AI analysis output
   * @returns 3–5 sentence summary for the run detail page
   */
  generateRunSummary(input: GenerateRunSummaryInput): Promise<GenerateRunSummaryOutput>;

  /**
   * Release any held resources (HTTP clients, etc.).
   *
   * Called during graceful shutdown. Implementations that hold no
   * resources can no-op.
   */
  close(): Promise<void>;
}

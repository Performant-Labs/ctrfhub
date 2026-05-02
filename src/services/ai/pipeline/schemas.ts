/**
 * Zod schemas for AI pipeline output validation.
 *
 * These schemas validate the shape of LLM responses to catch malformed
 * JSON from real providers. Parse failures in the categorizer become
 * recoverable errors — the recovery query retries them.
 *
 * Derived from `CategorizeFailuresOutput` type in `src/services/ai/types.ts`.
 *
 * @see docs/planning/ai-features.md §A1
 * @see skills/zod-schema-first.md — schemas as single source of truth
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// A1 — Categorization output validation
// ---------------------------------------------------------------------------

/**
 * Valid AI failure categories per `ai-features.md §A1`.
 */
export const AiCategoryEnum = z.enum([
  'app_defect',
  'test_data',
  'script_error',
  'environment',
  'unknown',
]);

/**
 * Schema for validating `AiProvider.categorizeFailures()` output.
 *
 * Used by the categorizer service to verify LLM responses before
 * committing results to the database. A parse failure here triggers
 * a recoverable error rather than writing bad data.
 */
export const CategorizeOutputSchema = z.object({
  categories: z.array(z.object({
    /** PK of the test result — must match an input resultId. */
    resultId: z.number(),
    /** AI-assigned failure category. */
    category: AiCategoryEnum,
    /** Model's confidence in the assignment (0.0–1.0). */
    confidence: z.number().min(0).max(1),
  })),
  /** Model identifier that produced this response (e.g. "gpt-4o-mini"). */
  model: z.string(),
  /** Total tokens consumed by this API call. */
  tokensUsed: z.number(),
});

export type ValidatedCategorizeOutput = z.infer<typeof CategorizeOutputSchema>;

// ---------------------------------------------------------------------------
// A2 — Root cause correlation output validation
// ---------------------------------------------------------------------------

/**
 * Schema for validating `AiProvider.correlateRootCauses()` output.
 *
 * Validates the shape of LLM correlation responses before writing to
 * `test_runs.ai_root_causes`. A parse failure triggers a recoverable error.
 *
 * @see docs/planning/ai-features.md §A2
 */
export const CorrelateOutputSchema = z.object({
  clusters: z.array(z.object({
    /** Human-readable label for the root cause cluster. */
    label: z.string(),
    /** Dominant failure category for this cluster. */
    category: AiCategoryEnum,
    /** Model's confidence in the cluster grouping (0.0–1.0). */
    confidence: z.number().min(0).max(1),
    /** PKs of test results grouped into this cluster. */
    resultIds: z.array(z.number()),
    /** Plain English explanation of shared root cause. */
    explanation: z.string(),
  })),
  /** Model identifier that produced this response. */
  model: z.string(),
  /** Total tokens consumed by this API call. */
  tokensUsed: z.number(),
});

export type ValidatedCorrelateOutput = z.infer<typeof CorrelateOutputSchema>;

// ---------------------------------------------------------------------------
// A3 — Run summary output validation
// ---------------------------------------------------------------------------

/**
 * Schema for validating `AiProvider.generateRunSummary()` output.
 *
 * Validates the shape of LLM summary responses before writing to
 * `test_runs.ai_summary`.
 *
 * @see docs/planning/ai-features.md §A3
 */
export const SummaryOutputSchema = z.object({
  /** Plain English summary of the run (3–5 sentences). */
  summary: z.string(),
  /** Model identifier that produced this response. */
  model: z.string(),
  /** Total tokens consumed by this API call. */
  tokensUsed: z.number(),
});

export type ValidatedSummaryOutput = z.infer<typeof SummaryOutputSchema>;

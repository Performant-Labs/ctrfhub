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

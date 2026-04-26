/**
 * AI Display Helpers — Pure functions for AI feature presentation logic.
 *
 * These functions operate on plain objects (not entity instances) so they
 * can be used in templates, API responses, and non-ORM contexts. The
 * `TestResult` entity has equivalent getters for convenience, but these
 * standalone functions are the canonical implementations.
 *
 * @see docs/planning/ai-features.md §A1 — category semantics
 * @see docs/planning/ai-features.md §A1 batching — splitIntoBatches default size
 */

// ---------------------------------------------------------------------------
// Display helpers for effective category resolution
// ---------------------------------------------------------------------------

/**
 * Shape accepted by category display helpers.
 *
 * Deliberately minimal — works with entity instances, plain query results,
 * or hand-constructed test data.
 */
export interface CategoryFields {
  /** AI-assigned category from the A1 pipeline stage, or null/undefined if not yet categorized. */
  aiCategory?: string | null;
  /** User-applied manual override category, or null/undefined if not overridden. */
  aiCategoryOverride?: string | null;
}

/**
 * Returns the effective failure category for display purposes.
 *
 * If the user has manually overridden the AI category, the override
 * takes precedence. Otherwise, the AI-assigned category is used.
 *
 * @param result - Object with optional `aiCategory` and `aiCategoryOverride` fields.
 * @returns The effective category string, or `null` if neither is set.
 *
 * @example
 * ```ts
 * getEffectiveCategory({ aiCategory: 'environment', aiCategoryOverride: 'app_defect' });
 * // => 'app_defect' (manual override wins)
 *
 * getEffectiveCategory({ aiCategory: 'test_data' });
 * // => 'test_data' (AI category used when no override)
 *
 * getEffectiveCategory({});
 * // => null (neither set)
 * ```
 */
export function getEffectiveCategory(result: CategoryFields): string | null {
  return result.aiCategoryOverride ?? result.aiCategory ?? null;
}

/**
 * Returns the source of the effective category.
 *
 * - `'manual'` — the user overrode the AI category
 * - `'ai'`     — the AI-assigned category is in effect
 * - `null`     — no category has been assigned yet
 *
 * @param result - Object with optional `aiCategory` and `aiCategoryOverride` fields.
 * @returns `'manual'`, `'ai'`, or `null`.
 *
 * @example
 * ```ts
 * getCategorySource({ aiCategory: 'environment', aiCategoryOverride: 'app_defect' });
 * // => 'manual'
 *
 * getCategorySource({ aiCategory: 'test_data' });
 * // => 'ai'
 *
 * getCategorySource({});
 * // => null
 * ```
 */
export function getCategorySource(result: CategoryFields): 'manual' | 'ai' | null {
  if (result.aiCategoryOverride != null) return 'manual';
  if (result.aiCategory != null) return 'ai';
  return null;
}

// ---------------------------------------------------------------------------
// Batch helper
// ---------------------------------------------------------------------------

/**
 * Split an array into batches of a given size.
 *
 * Used by the A1 categorization pipeline to batch failed results into
 * groups of 20 per API call (per `ai-features.md §A1 batching`).
 *
 * @param items - The array to split.
 * @param size - Maximum number of items per batch. Defaults to 20.
 * @returns Array of batches, each containing at most `size` items.
 *          Returns an empty array if `items` is empty.
 *
 * @example
 * ```ts
 * splitIntoBatches([1, 2, 3, 4, 5], 2);
 * // => [[1, 2], [3, 4], [5]]
 *
 * splitIntoBatches([], 20);
 * // => []
 * ```
 */
export function splitIntoBatches<T>(items: readonly T[], size: number = 20): T[][] {
  if (items.length === 0) return [];
  if (size <= 0) throw new Error(`Batch size must be positive, got ${size}`);

  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

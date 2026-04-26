/**
 * Unit tests for AI display helpers.
 *
 * Tests pure functions only — zero DB, zero HTTP, zero filesystem.
 * @see src/services/ai/helpers.ts
 * @see skills/vitest-three-layer-testing.md §Layer 1
 */

import { describe, it, expect } from 'vitest';
import {
  getEffectiveCategory,
  getCategorySource,
  splitIntoBatches,
} from '../../services/ai/helpers.js';

// ---------------------------------------------------------------------------
// getEffectiveCategory
// ---------------------------------------------------------------------------

describe('getEffectiveCategory', () => {
  it('returns override when both override and AI category are set', () => {
    expect(
      getEffectiveCategory({ aiCategory: 'environment', aiCategoryOverride: 'app_defect' }),
    ).toBe('app_defect');
  });

  it('returns AI category when no override is set', () => {
    expect(getEffectiveCategory({ aiCategory: 'test_data' })).toBe('test_data');
  });

  it('returns AI category when override is explicitly null', () => {
    expect(
      getEffectiveCategory({ aiCategory: 'script_error', aiCategoryOverride: null }),
    ).toBe('script_error');
  });

  it('returns AI category when override is explicitly undefined', () => {
    expect(
      getEffectiveCategory({ aiCategory: 'unknown', aiCategoryOverride: undefined }),
    ).toBe('unknown');
  });

  it('returns override even when AI category is null', () => {
    expect(
      getEffectiveCategory({ aiCategory: null, aiCategoryOverride: 'environment' }),
    ).toBe('environment');
  });

  it('returns null when neither field is set', () => {
    expect(getEffectiveCategory({})).toBeNull();
  });

  it('returns null when both fields are null', () => {
    expect(getEffectiveCategory({ aiCategory: null, aiCategoryOverride: null })).toBeNull();
  });

  it('returns null when both fields are undefined', () => {
    expect(
      getEffectiveCategory({ aiCategory: undefined, aiCategoryOverride: undefined }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCategorySource
// ---------------------------------------------------------------------------

describe('getCategorySource', () => {
  it('returns "manual" when override is set', () => {
    expect(
      getCategorySource({ aiCategory: 'environment', aiCategoryOverride: 'app_defect' }),
    ).toBe('manual');
  });

  it('returns "manual" even when AI category is null', () => {
    expect(getCategorySource({ aiCategory: null, aiCategoryOverride: 'test_data' })).toBe(
      'manual',
    );
  });

  it('returns "manual" even when AI category is absent', () => {
    expect(getCategorySource({ aiCategoryOverride: 'script_error' })).toBe('manual');
  });

  it('returns "ai" when AI category is set and override is not', () => {
    expect(getCategorySource({ aiCategory: 'test_data' })).toBe('ai');
  });

  it('returns "ai" when AI category is set and override is null', () => {
    expect(getCategorySource({ aiCategory: 'environment', aiCategoryOverride: null })).toBe(
      'ai',
    );
  });

  it('returns null when neither field is set', () => {
    expect(getCategorySource({})).toBeNull();
  });

  it('returns null when both fields are null', () => {
    expect(getCategorySource({ aiCategory: null, aiCategoryOverride: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// splitIntoBatches
// ---------------------------------------------------------------------------

describe('splitIntoBatches', () => {
  it('splits into equal batches when items divide evenly', () => {
    const result = splitIntoBatches([1, 2, 3, 4], 2);
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('handles remainder batch', () => {
    const result = splitIntoBatches([1, 2, 3, 4, 5], 2);
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns single batch when items fit within size', () => {
    const result = splitIntoBatches([1, 2, 3], 5);
    expect(result).toEqual([[1, 2, 3]]);
  });

  it('returns single-item batches when size is 1', () => {
    const result = splitIntoBatches(['a', 'b', 'c'], 1);
    expect(result).toEqual([['a'], ['b'], ['c']]);
  });

  it('returns empty array for empty input', () => {
    expect(splitIntoBatches([], 20)).toEqual([]);
  });

  it('uses default batch size of 20', () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    const result = splitIntoBatches(items);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(20);
    expect(result[1]).toHaveLength(20);
    expect(result[2]).toHaveLength(5);
  });

  it('handles single item', () => {
    expect(splitIntoBatches([42], 20)).toEqual([[42]]);
  });

  it('throws on zero batch size', () => {
    expect(() => splitIntoBatches([1, 2], 0)).toThrow('Batch size must be positive');
  });

  it('throws on negative batch size', () => {
    expect(() => splitIntoBatches([1, 2], -3)).toThrow('Batch size must be positive');
  });

  it('preserves item references (no deep clone)', () => {
    const obj = { id: 1 };
    const result = splitIntoBatches([obj], 10);
    expect(result[0]![0]).toBe(obj);
  });

  it('works with readonly arrays', () => {
    const items: readonly number[] = Object.freeze([1, 2, 3, 4, 5]);
    const result = splitIntoBatches(items, 2);
    expect(result).toHaveLength(3);
  });

  it('handles exactly batch-size items', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const result = splitIntoBatches(items, 20);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(20);
  });
});

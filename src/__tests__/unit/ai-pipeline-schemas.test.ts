/**
 * Unit tests — AI pipeline Zod schemas (AI-002)
 *
 * Layer 1 (pure function) — validates CategorizeOutputSchema and
 * AiCategoryEnum against valid and invalid inputs. No DB, no HTTP.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 1
 * @see src/services/ai/pipeline/schemas.ts
 */

import { describe, it, expect } from 'vitest';
import { CategorizeOutputSchema, AiCategoryEnum } from '../../services/ai/pipeline/schemas.js';

// ---------------------------------------------------------------------------
// AiCategoryEnum
// ---------------------------------------------------------------------------

describe('AiCategoryEnum', () => {
  it.each([
    'app_defect',
    'test_data',
    'script_error',
    'environment',
    'unknown',
  ])('accepts valid category "%s"', (category) => {
    const result = AiCategoryEnum.safeParse(category);
    expect(result.success).toBe(true);
  });

  it.each([
    'invalid',
    '',
    'APP_DEFECT',
    'defect',
    'app-defect',
  ])('rejects invalid category "%s"', (category) => {
    const result = AiCategoryEnum.safeParse(category);
    expect(result.success).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(AiCategoryEnum.safeParse(42).success).toBe(false);
    expect(AiCategoryEnum.safeParse(null).success).toBe(false);
    expect(AiCategoryEnum.safeParse(undefined).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CategorizeOutputSchema
// ---------------------------------------------------------------------------

describe('CategorizeOutputSchema', () => {
  const validOutput = {
    categories: [
      { resultId: 1, category: 'app_defect', confidence: 0.95 },
      { resultId: 2, category: 'environment', confidence: 0.7 },
    ],
    model: 'gpt-4o-mini',
    tokensUsed: 150,
  };

  it('accepts a valid categorization output', () => {
    const result = CategorizeOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categories).toHaveLength(2);
      expect(result.data.model).toBe('gpt-4o-mini');
      expect(result.data.tokensUsed).toBe(150);
    }
  });

  it('accepts empty categories array', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [],
      model: 'mock',
      tokensUsed: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts confidence at exact boundaries (0.0 and 1.0)', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [
        { resultId: 1, category: 'unknown', confidence: 0.0 },
        { resultId: 2, category: 'app_defect', confidence: 1.0 },
      ],
      model: 'mock',
      tokensUsed: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects confidence below 0', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [
        { resultId: 1, category: 'app_defect', confidence: -0.1 },
      ],
      model: 'mock',
      tokensUsed: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 1', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [
        { resultId: 1, category: 'app_defect', confidence: 1.1 },
      ],
      model: 'mock',
      tokensUsed: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing model field', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [
        { resultId: 1, category: 'app_defect', confidence: 0.9 },
      ],
      tokensUsed: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing tokensUsed field', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [
        { resultId: 1, category: 'app_defect', confidence: 0.9 },
      ],
      model: 'mock',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid category in categories array', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [
        { resultId: 1, category: 'not_a_category', confidence: 0.9 },
      ],
      model: 'mock',
      tokensUsed: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric resultId', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [
        { resultId: 'abc', category: 'app_defect', confidence: 0.9 },
      ],
      model: 'mock',
      tokensUsed: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing resultId in categories entry', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: [
        { category: 'app_defect', confidence: 0.9 },
      ],
      model: 'mock',
      tokensUsed: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when categories is not an array', () => {
    const result = CategorizeOutputSchema.safeParse({
      categories: 'not an array',
      model: 'mock',
      tokensUsed: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects entirely malformed input', () => {
    expect(CategorizeOutputSchema.safeParse('string').success).toBe(false);
    expect(CategorizeOutputSchema.safeParse(42).success).toBe(false);
    expect(CategorizeOutputSchema.safeParse(null).success).toBe(false);
  });
});

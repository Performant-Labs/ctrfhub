/**
 * TestResult entity — one row per individual test case within a run.
 *
 * Write-once: rows are never re-parented after ingest. Artifacts are
 * stored in `test_artifacts`; comments in `test_result_comments`.
 *
 * CTRFHub-owned: this table IS created by CTRFHub migrations.
 *
 * @see docs/planning/database-design.md §4.5
 * @see skills/mikroorm-dual-dialect.md — portable types only
 */

import { defineEntity, p } from '@mikro-orm/core';
import { TestRunSchema } from './TestRun.js';

const TestResultSchema = defineEntity({
  name: 'TestResult',
  tableName: 'test_results',
  properties: {
    id:                  p.integer().primary(),
    testRun:             () => p.manyToOne(TestRunSchema),
    testName:            p.string().length(500),
    testFile:            p.string().length(500).nullable(),
    status:              p.string().length(20),
    durationMs:          p.integer().nullable(),
    errorMessage:        p.text().nullable(),
    stackTrace:          p.text().nullable(),
    retryCount:          p.integer().default(0),
    aiCategory:          p.string().length(50).nullable(),
    aiCategoryOverride:  p.string().length(50).nullable(),
    aiCategoryModel:     p.string().length(100).nullable(),
    aiCategoryAt:        p.datetime().nullable(),
    flakyScore:          p.float().nullable(),
    errorHash:           p.string().length(64).nullable(),
    createdAt:           p.datetime().defaultRaw('CURRENT_TIMESTAMP'),
  },
});

/**
 * TestResult entity class.
 *
 * Domain methods can be added here as needed by downstream stories.
 */
export class TestResult extends TestResultSchema.class {
  /**
   * Returns the effective failure category for display purposes.
   *
   * If the user has manually overridden the AI category, the override
   * takes precedence. Otherwise, the AI-assigned category is used.
   *
   * @returns The effective category string, or `null` if neither is set.
   */
  get effectiveCategory(): string | null {
    return this.aiCategoryOverride ?? this.aiCategory ?? null;
  }

  /**
   * Returns the source of the effective category.
   *
   * @returns 'manual' if overridden, 'ai' if AI-assigned, or null if neither.
   */
  get categorySource(): 'manual' | 'ai' | null {
    if (this.aiCategoryOverride != null) return 'manual';
    if (this.aiCategory != null) return 'ai';
    return null;
  }
}
TestResultSchema.setClass(TestResult);

export { TestResultSchema };

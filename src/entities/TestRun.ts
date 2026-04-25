/**
 * TestRun entity — a single execution of a test suite.
 *
 * Holds cached aggregate counters (passed, failed, skipped, blocked, total)
 * so dashboard queries are single-row lookups rather than full aggregations.
 *
 * CTRFHub-owned: this table IS created by CTRFHub migrations.
 *
 * @see docs/planning/database-design.md §4.4
 * @see skills/mikroorm-dual-dialect.md §Good example
 */

import { defineEntity, p } from '@mikro-orm/core';
import { ProjectSchema } from './Project.js';

const TestRunSchema = defineEntity({
  name: 'TestRun',
  tableName: 'test_runs',
  properties: {
    id:             p.integer().primary(),
    project:        () => p.manyToOne(ProjectSchema),
    name:           p.string().length(255).nullable(),
    status:         p.string().length(20).default('pending'),
    trigger:        p.string().length(50).nullable(),
    reporter:       p.string().length(100).nullable(),
    environment:    p.string().length(100).nullable(),
    branch:         p.string().length(255).nullable(),
    commitSha:      p.string().length(40).nullable(),
    startedAt:      p.datetime().nullable(),
    completedAt:    p.datetime().nullable(),
    durationMs:     p.integer().nullable(),
    totalTests:     p.integer().default(0),
    passed:         p.integer().default(0),
    failed:         p.integer().default(0),
    skipped:        p.integer().default(0),
    blocked:        p.integer().default(0),
    aiRootCauses:   p.json().nullable(),
    aiRootCausesAt: p.datetime().nullable(),
    aiSummary:      p.text().nullable(),
    aiSummaryAt:    p.datetime().nullable(),
    createdAt:      p.datetime().defaultRaw('CURRENT_TIMESTAMP'),
  },
});

/**
 * TestRun entity class with computed domain helpers.
 */
export class TestRun extends TestRunSchema.class {
  /**
   * Pass rate as a fraction (0.0–1.0).
   *
   * Returns 0 if no tests have been recorded yet.
   */
  get passRate(): number {
    return this.totalTests > 0 ? this.passed / this.totalTests : 0;
  }

  /**
   * Failure rate as a fraction (0.0–1.0).
   */
  get failureRate(): number {
    return this.totalTests > 0 ? this.failed / this.totalTests : 0;
  }

  /**
   * Count of tests in a "pending" state (neither passed, failed, skipped, nor blocked).
   *
   * @see docs/planning/database-design.md §7 — aggregate counter maintenance
   */
  get pendingCount(): number {
    return this.totalTests - (this.passed + this.failed + this.skipped + this.blocked);
  }
}
TestRunSchema.setClass(TestRun);

export { TestRunSchema };

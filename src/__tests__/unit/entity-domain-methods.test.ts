/**
 * Entity domain method tests — INFRA-004
 *
 * Tests the computed getter properties on TestRun, TestResult, and TestArtifact.
 * These are Layer 1 (unit) tests — zero I/O, pure assertions on class instances.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 1
 * @see docs/planning/database-design.md §4.4, §4.5, §4.6
 */

import { TestRun } from '../../entities/TestRun.js';
import { TestResult } from '../../entities/TestResult.js';
import { TestArtifact } from '../../entities/TestArtifact.js';

// ─────────────────────────────────────────────────────────────────────────────
// TestRun domain methods
// ─────────────────────────────────────────────────────────────────────────────

describe('TestRun.passRate', () => {
  it('returns 0 when totalTests is 0', () => {
    const run = new TestRun();
    Object.assign(run, { totalTests: 0, passed: 0 });
    expect(run.passRate).toBe(0);
  });

  it('returns 1.0 when all tests pass', () => {
    const run = new TestRun();
    Object.assign(run, { totalTests: 100, passed: 100 });
    expect(run.passRate).toBe(1);
  });

  it('returns correct fraction for mixed results', () => {
    const run = new TestRun();
    Object.assign(run, { totalTests: 200, passed: 150 });
    expect(run.passRate).toBe(0.75);
  });

  it('returns 0 when no tests passed but total > 0', () => {
    const run = new TestRun();
    Object.assign(run, { totalTests: 50, passed: 0 });
    expect(run.passRate).toBe(0);
  });
});

describe('TestRun.failureRate', () => {
  it('returns 0 when totalTests is 0', () => {
    const run = new TestRun();
    Object.assign(run, { totalTests: 0, failed: 0 });
    expect(run.failureRate).toBe(0);
  });

  it('returns 1.0 when all tests fail', () => {
    const run = new TestRun();
    Object.assign(run, { totalTests: 80, failed: 80 });
    expect(run.failureRate).toBe(1);
  });

  it('returns correct fraction for mixed results', () => {
    const run = new TestRun();
    Object.assign(run, { totalTests: 200, failed: 50 });
    expect(run.failureRate).toBe(0.25);
  });
});

describe('TestRun.pendingCount', () => {
  it('returns 0 when all tests are accounted for', () => {
    const run = new TestRun();
    Object.assign(run, {
      totalTests: 100,
      passed: 60,
      failed: 20,
      skipped: 15,
      blocked: 5,
    });
    expect(run.pendingCount).toBe(0);
  });

  it('returns positive count when some tests are unaccounted', () => {
    const run = new TestRun();
    Object.assign(run, {
      totalTests: 100,
      passed: 50,
      failed: 10,
      skipped: 5,
      blocked: 0,
    });
    // 100 - (50 + 10 + 5 + 0) = 35
    expect(run.pendingCount).toBe(35);
  });

  it('returns totalTests when all counters are 0', () => {
    const run = new TestRun();
    Object.assign(run, {
      totalTests: 42,
      passed: 0,
      failed: 0,
      skipped: 0,
      blocked: 0,
    });
    expect(run.pendingCount).toBe(42);
  });

  it('returns 0 when totalTests is 0 and counters are 0', () => {
    const run = new TestRun();
    Object.assign(run, {
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      blocked: 0,
    });
    expect(run.pendingCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TestResult domain methods
// ─────────────────────────────────────────────────────────────────────────────

describe('TestResult.effectiveCategory', () => {
  it('returns null when neither aiCategory nor override is set', () => {
    const result = new TestResult();
    Object.assign(result, { aiCategory: null, aiCategoryOverride: null });
    expect(result.effectiveCategory).toBeNull();
  });

  it('returns aiCategory when set and no override', () => {
    const result = new TestResult();
    Object.assign(result, { aiCategory: 'flaky', aiCategoryOverride: null });
    expect(result.effectiveCategory).toBe('flaky');
  });

  it('returns override when both are set (override wins)', () => {
    const result = new TestResult();
    Object.assign(result, { aiCategory: 'flaky', aiCategoryOverride: 'infrastructure' });
    expect(result.effectiveCategory).toBe('infrastructure');
  });

  it('returns override when only override is set', () => {
    const result = new TestResult();
    Object.assign(result, { aiCategory: null, aiCategoryOverride: 'test-bug' });
    expect(result.effectiveCategory).toBe('test-bug');
  });
});

describe('TestResult.categorySource', () => {
  it('returns null when neither category is set', () => {
    const result = new TestResult();
    Object.assign(result, { aiCategory: null, aiCategoryOverride: null });
    expect(result.categorySource).toBeNull();
  });

  it('returns "ai" when only aiCategory is set', () => {
    const result = new TestResult();
    Object.assign(result, { aiCategory: 'flaky', aiCategoryOverride: null });
    expect(result.categorySource).toBe('ai');
  });

  it('returns "manual" when override is set (regardless of aiCategory)', () => {
    const result = new TestResult();
    Object.assign(result, { aiCategory: 'flaky', aiCategoryOverride: 'infrastructure' });
    expect(result.categorySource).toBe('manual');
  });

  it('returns "manual" when only override is set', () => {
    const result = new TestResult();
    Object.assign(result, { aiCategory: null, aiCategoryOverride: 'test-bug' });
    expect(result.categorySource).toBe('manual');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TestArtifact domain methods
// ─────────────────────────────────────────────────────────────────────────────

describe('TestArtifact.isExternalUrl', () => {
  it('returns true when storageType is "url"', () => {
    const artifact = new TestArtifact();
    Object.assign(artifact, { storageType: 'url' });
    expect(artifact.isExternalUrl).toBe(true);
  });

  it('returns false when storageType is "local"', () => {
    const artifact = new TestArtifact();
    Object.assign(artifact, { storageType: 'local' });
    expect(artifact.isExternalUrl).toBe(false);
  });

  it('returns false when storageType is "s3"', () => {
    const artifact = new TestArtifact();
    Object.assign(artifact, { storageType: 's3' });
    expect(artifact.isExternalUrl).toBe(false);
  });
});

describe('TestArtifact.isVerified', () => {
  it('returns true when contentTypeVerified is true', () => {
    const artifact = new TestArtifact();
    Object.assign(artifact, { contentTypeVerified: true });
    expect(artifact.isVerified).toBe(true);
  });

  it('returns false when contentTypeVerified is false', () => {
    const artifact = new TestArtifact();
    Object.assign(artifact, { contentTypeVerified: false });
    expect(artifact.isVerified).toBe(false);
  });
});

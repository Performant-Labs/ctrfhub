/**
 * Unit tests for shared AI prompt templates and prompt builders.
 *
 * Tests pure functions only — no LLM calls, no SDK imports.
 * @see src/services/ai/prompts.ts
 * @see skills/vitest-three-layer-testing.md §Layer 1
 */

import { describe, it, expect } from 'vitest';
import {
  CATEGORIZATION_SYSTEM_PROMPT,
  CORRELATION_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildCategorizationPrompt,
  buildCorrelationPrompt,
  buildSummaryPrompt,
} from '../../services/ai/prompts.js';
import type {
  CategorizeFailuresInput,
  CorrelateRootCausesInput,
  GenerateRunSummaryInput,
} from '../../services/ai/types.js';

// ---------------------------------------------------------------------------
// System prompts — structural checks
// ---------------------------------------------------------------------------

describe('system prompts', () => {
  it('CATEGORIZATION_SYSTEM_PROMPT lists all five categories', () => {
    expect(CATEGORIZATION_SYSTEM_PROMPT).toContain('app_defect');
    expect(CATEGORIZATION_SYSTEM_PROMPT).toContain('test_data');
    expect(CATEGORIZATION_SYSTEM_PROMPT).toContain('script_error');
    expect(CATEGORIZATION_SYSTEM_PROMPT).toContain('environment');
    expect(CATEGORIZATION_SYSTEM_PROMPT).toContain('unknown');
  });

  it('CATEGORIZATION_SYSTEM_PROMPT requests JSON response', () => {
    expect(CATEGORIZATION_SYSTEM_PROMPT).toContain('JSON');
  });

  it('CORRELATION_SYSTEM_PROMPT mentions max 10 clusters', () => {
    expect(CORRELATION_SYSTEM_PROMPT).toContain('10 clusters');
  });

  it('CORRELATION_SYSTEM_PROMPT requests JSON response', () => {
    expect(CORRELATION_SYSTEM_PROMPT).toContain('JSON');
  });

  it('SUMMARY_SYSTEM_PROMPT mentions 3-5 sentences', () => {
    expect(SUMMARY_SYSTEM_PROMPT).toContain('3-5 sentence');
  });
});

// ---------------------------------------------------------------------------
// buildCategorizationPrompt
// ---------------------------------------------------------------------------

describe('buildCategorizationPrompt', () => {
  const input: CategorizeFailuresInput = {
    runId: 42,
    results: [
      { resultId: 1, testName: 'login test', errorMessage: 'timeout', stackTrace: 'at login.ts:5' },
      { resultId: 2, testName: 'checkout test', errorMessage: null, stackTrace: null },
    ],
  };

  it('includes run ID', () => {
    const prompt = buildCategorizationPrompt(input);
    expect(prompt).toContain('run #42');
  });

  it('includes result count', () => {
    const prompt = buildCategorizationPrompt(input);
    expect(prompt).toContain('2 failed test results');
  });

  it('includes test names in JSON', () => {
    const prompt = buildCategorizationPrompt(input);
    expect(prompt).toContain('login test');
    expect(prompt).toContain('checkout test');
  });

  it('includes result IDs in JSON', () => {
    const prompt = buildCategorizationPrompt(input);
    const parsed = JSON.parse(prompt.substring(prompt.indexOf('[')));
    expect(parsed[0].resultId).toBe(1);
    expect(parsed[1].resultId).toBe(2);
  });

  it('replaces null errorMessage with "(none)"', () => {
    const prompt = buildCategorizationPrompt(input);
    const parsed = JSON.parse(prompt.substring(prompt.indexOf('[')));
    expect(parsed[1].errorMessage).toBe('(none)');
  });

  it('replaces null stackTrace with "(none)"', () => {
    const prompt = buildCategorizationPrompt(input);
    const parsed = JSON.parse(prompt.substring(prompt.indexOf('[')));
    expect(parsed[1].stackTrace).toBe('(none)');
  });

  it('preserves non-null error and stack', () => {
    const prompt = buildCategorizationPrompt(input);
    const parsed = JSON.parse(prompt.substring(prompt.indexOf('[')));
    expect(parsed[0].errorMessage).toBe('timeout');
    expect(parsed[0].stackTrace).toBe('at login.ts:5');
  });
});

// ---------------------------------------------------------------------------
// buildCorrelationPrompt
// ---------------------------------------------------------------------------

describe('buildCorrelationPrompt', () => {
  const input: CorrelateRootCausesInput = {
    runId: 99,
    results: [
      {
        resultId: 10,
        testName: 'db connection test',
        errorMessage: 'ECONNREFUSED',
        stackTrace: null,
        category: 'environment',
      },
    ],
  };

  it('includes run ID', () => {
    const prompt = buildCorrelationPrompt(input);
    expect(prompt).toContain('run #99');
  });

  it('includes result count', () => {
    const prompt = buildCorrelationPrompt(input);
    expect(prompt).toContain('1 failed test results');
  });

  it('includes category in JSON output', () => {
    const prompt = buildCorrelationPrompt(input);
    const parsed = JSON.parse(prompt.substring(prompt.indexOf('[')));
    expect(parsed[0].category).toBe('environment');
  });

  it('mentions grouping by root cause', () => {
    const prompt = buildCorrelationPrompt(input);
    expect(prompt).toContain('root cause');
  });
});

// ---------------------------------------------------------------------------
// buildSummaryPrompt
// ---------------------------------------------------------------------------

describe('buildSummaryPrompt', () => {
  const baseInput: GenerateRunSummaryInput = {
    runId: 7,
    totalTests: 100,
    passed: 90,
    failed: 8,
    skipped: 2,
    environment: null,
    branch: null,
    commitSha: null,
    categoryDistribution: {
      app_defect: 3,
      test_data: 2,
      script_error: 1,
      environment: 2,
      unknown: 0,
    },
    rootCauseClusters: [],
    previousPassRate: null,
  };

  it('includes run ID', () => {
    const prompt = buildSummaryPrompt(baseInput);
    expect(prompt).toContain('#7');
  });

  it('includes total, passed, failed, skipped counts', () => {
    const prompt = buildSummaryPrompt(baseInput);
    expect(prompt).toContain('Total: 100');
    expect(prompt).toContain('Passed: 90');
    expect(prompt).toContain('Failed: 8');
    expect(prompt).toContain('Skipped: 2');
  });

  it('includes computed pass rate', () => {
    const prompt = buildSummaryPrompt(baseInput);
    expect(prompt).toContain('90.0%');
  });

  it('includes environment when present', () => {
    const prompt = buildSummaryPrompt({ ...baseInput, environment: 'staging' });
    expect(prompt).toContain('Environment: staging');
  });

  it('omits environment when null', () => {
    const prompt = buildSummaryPrompt(baseInput);
    expect(prompt).not.toContain('Environment:');
  });

  it('includes branch when present', () => {
    const prompt = buildSummaryPrompt({ ...baseInput, branch: 'feature/login' });
    expect(prompt).toContain('Branch: feature/login');
  });

  it('includes commit SHA when present', () => {
    const prompt = buildSummaryPrompt({ ...baseInput, commitSha: 'abc123' });
    expect(prompt).toContain('Commit: abc123');
  });

  it('includes pass rate delta when previousPassRate is set', () => {
    const prompt = buildSummaryPrompt({ ...baseInput, previousPassRate: 0.95 });
    expect(prompt).toContain('Pass rate delta');
    // 90/100 = 0.9, previous = 0.95, delta = -5.0%
    expect(prompt).toContain('-5.0%');
  });

  it('includes positive pass rate delta with + sign', () => {
    const prompt = buildSummaryPrompt({ ...baseInput, previousPassRate: 0.8 });
    // 90/100 = 0.9, previous = 0.8, delta = +10.0%
    expect(prompt).toContain('+10.0%');
  });

  it('omits delta when previousPassRate is null', () => {
    const prompt = buildSummaryPrompt(baseInput);
    expect(prompt).not.toContain('delta');
  });

  it('includes non-zero category distribution', () => {
    const prompt = buildSummaryPrompt(baseInput);
    expect(prompt).toContain('app_defect: 3');
    expect(prompt).toContain('test_data: 2');
    expect(prompt).toContain('script_error: 1');
    expect(prompt).toContain('environment: 2');
    // unknown: 0 should be filtered out
    expect(prompt).not.toContain('unknown: 0');
  });

  it('includes root cause clusters when present', () => {
    const prompt = buildSummaryPrompt({
      ...baseInput,
      rootCauseClusters: [
        {
          label: 'DB timeout',
          category: 'environment',
          confidence: 0.9,
          resultIds: [1, 2, 3],
          explanation: 'Database pool exhausted',
        },
      ],
    });
    expect(prompt).toContain('Root cause clusters');
    expect(prompt).toContain('DB timeout');
    expect(prompt).toContain('3 tests');
    expect(prompt).toContain('Database pool exhausted');
  });

  it('handles zero total tests without divide-by-zero', () => {
    const prompt = buildSummaryPrompt({ ...baseInput, totalTests: 0, passed: 0, failed: 0 });
    expect(prompt).toContain('0.0%');
  });
});

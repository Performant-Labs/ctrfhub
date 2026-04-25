/**
 * Unit tests — CTRF Report Zod schema validation.
 *
 * Layer 1: pure Zod parsing, zero I/O.
 * @see skills/vitest-three-layer-testing.md §Layer 1
 * @see src/modules/ingest/schemas.ts
 */

import { CtrfReportSchema, CtrfStatusSchema } from '../../modules/ingest/schemas.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * A minimal valid CTRF report exercising only required fields.
 * Changing required fields in CtrfReportSchema? Update this fixture.
 */
function buildMinimalReport(overrides?: Record<string, unknown>) {
  return {
    reportFormat: 'CTRF',
    specVersion: '1.0.0',
    results: {
      tool: { name: 'vitest' },
      summary: {
        tests: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 1706828654274,
        stop: 1706828655782,
      },
      tests: [
        {
          name: 'should pass',
          status: 'passed',
          duration: 100,
        },
      ],
    },
    ...overrides,
  };
}

/**
 * A full-shape CTRF report exercising every optional field per the
 * upstream CTRF JSON Schema v1.0.0.
 */
function buildFullReport() {
  return {
    reportFormat: 'CTRF',
    specVersion: '1.0.0',
    reportId: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: '2026-04-25T12:00:00Z',
    generatedBy: 'ctrf-vitest-reporter',
    extra: { custom: 'metadata' },
    results: {
      tool: {
        name: 'playwright',
        version: '1.45.0',
        extra: { runner: 'ci' },
      },
      summary: {
        tests: 5,
        passed: 3,
        failed: 1,
        skipped: 1,
        pending: 0,
        other: 0,
        flaky: 1,
        suites: 2,
        start: 1706828654274,
        stop: 1706828655782,
        duration: 1508,
        extra: { parallel: true },
      },
      tests: [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          name: 'login flow',
          status: 'passed',
          duration: 801,
          start: 1706828654274,
          stop: 1706828655075,
          suite: ['auth', 'login'],
          message: 'All assertions passed',
          trace: '',
          snippet: 'expect(page).toHaveTitle("Dashboard")',
          ai: 'Test passed successfully',
          line: 42,
          rawStatus: 'passed',
          tags: ['smoke', 'critical'],
          labels: { priority: 'high', severity: 1, automated: true },
          type: 'e2e',
          filePath: 'tests/auth/login.spec.ts',
          retries: 0,
          retryAttempts: [],
          flaky: false,
          stdout: ['navigating to /login'],
          stderr: [],
          threadId: 'worker-1',
          browser: 'chromium',
          device: 'Desktop Chrome',
          screenshot: 'iVBORw0KGgo=',
          attachments: [
            {
              name: 'screenshot.png',
              contentType: 'image/png',
              path: '/artifacts/screenshot.png',
            },
          ],
          parameters: { env: 'staging' },
          steps: [
            { name: 'navigate', status: 'passed' },
            { name: 'fill credentials', status: 'passed' },
          ],
          insights: {
            passRate: { current: 0.95, baseline: 0.90, change: 0.05 },
            failRate: { current: 0.05, baseline: 0.10, change: -0.05 },
            flakyRate: { current: 0.02 },
            averageTestDuration: { current: 800 },
            p95TestDuration: { current: 1200 },
            executedInRuns: 42,
          },
          extra: { custom: 'test-data' },
        },
        {
          name: 'failed test',
          status: 'failed',
          duration: 200,
          message: 'Expected 200 but got 500',
          trace: 'Error: at test.spec.ts:15\n  at runTest',
        },
        {
          name: 'skipped test',
          status: 'skipped',
          duration: 0,
        },
        {
          name: 'pending test',
          status: 'pending',
          duration: 0,
        },
        {
          name: 'other status test',
          status: 'other',
          duration: 50,
        },
      ],
      environment: {
        reportName: 'Nightly E2E',
        appName: 'CTRFHub',
        appVersion: '0.1.0',
        buildId: 'build-123',
        buildName: 'nightly',
        buildNumber: 42,
        buildUrl: 'https://ci.example.com/build/42',
        repositoryName: 'ctrfhub',
        repositoryUrl: 'https://github.com/org/ctrfhub',
        commit: 'abc1234',
        branchName: 'main',
        osPlatform: 'darwin',
        osRelease: '25.4.0',
        osVersion: 'macOS 16.4',
        testEnvironment: 'staging',
        healthy: true,
        extra: { ci: 'github-actions' },
      },
      extra: { pipeline: 'nightly' },
    },
    insights: {
      passRate: { current: 0.85, baseline: 0.80, change: 0.05 },
      failRate: { current: 0.15 },
      flakyRate: { current: 0.03 },
      averageRunDuration: { current: 120000 },
      p95RunDuration: { current: 180000 },
      averageTestDuration: { current: 500 },
      runsAnalyzed: 100,
      extra: { window: '30d' },
    },
    baseline: {
      reportId: '550e8400-e29b-41d4-a716-446655440099',
      timestamp: '2026-04-24T12:00:00Z',
      source: 'main-branch',
      buildNumber: 41,
      buildName: 'nightly',
      buildUrl: 'https://ci.example.com/build/41',
      commit: 'def5678',
      extra: { tag: 'v0.0.9' },
    },
  };
}

// ---------------------------------------------------------------------------
// CtrfStatusSchema
// ---------------------------------------------------------------------------

describe('CtrfStatusSchema', () => {
  it.each(['passed', 'failed', 'skipped', 'pending', 'other'] as const)(
    'accepts valid status "%s"',
    (status) => {
      const result = CtrfStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(status);
      }
    },
  );

  it('rejects an invalid status string', () => {
    const result = CtrfStatusSchema.safeParse('completed');
    expect(result.success).toBe(false);
  });

  it('rejects a non-string value', () => {
    const result = CtrfStatusSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CtrfReportSchema — happy path
// ---------------------------------------------------------------------------

describe('CtrfReportSchema — happy path', () => {
  it('accepts a minimal valid CTRF report', () => {
    const result = CtrfReportSchema.safeParse(buildMinimalReport());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reportFormat).toBe('CTRF');
      expect(result.data.specVersion).toBe('1.0.0');
      expect(result.data.results.tool.name).toBe('vitest');
      expect(result.data.results.tests).toHaveLength(1);
    }
  });

  it('accepts a full-shape CTRF report with every optional field', () => {
    const report = buildFullReport();
    const result = CtrfReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results.tests).toHaveLength(5);
      expect(result.data.results.environment?.appName).toBe('CTRFHub');
      expect(result.data.insights?.runsAnalyzed).toBe(100);
      expect(result.data.baseline?.reportId).toBe(
        '550e8400-e29b-41d4-a716-446655440099',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// CtrfReportSchema — status: 'other' regression guard (G-P2-004)
// ---------------------------------------------------------------------------

describe('CtrfReportSchema — status: "other" (G-P2-004)', () => {
  it('accepts a test with status "other"', () => {
    const report = buildMinimalReport({
      results: {
        tool: { name: 'vitest' },
        summary: {
          tests: 1,
          passed: 0,
          failed: 0,
          skipped: 0,
          pending: 0,
          other: 1,
          start: 1706828654274,
          stop: 1706828655782,
        },
        tests: [{ name: 'an other test', status: 'other', duration: 10 }],
      },
    });
    const result = CtrfReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results.tests[0].status).toBe('other');
    }
  });

  it('accepts "other" in retry attempt status', () => {
    const report = buildMinimalReport({
      results: {
        tool: { name: 'vitest' },
        summary: {
          tests: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          pending: 0,
          other: 0,
          start: 1706828654274,
          stop: 1706828655782,
        },
        tests: [
          {
            name: 'retry test',
            status: 'passed',
            duration: 100,
            retryAttempts: [
              { attempt: 1, status: 'other' },
              { attempt: 2, status: 'passed' },
            ],
          },
        ],
      },
    });
    const result = CtrfReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });

  it('accepts "other" in step status', () => {
    const report = buildMinimalReport({
      results: {
        tool: { name: 'vitest' },
        summary: {
          tests: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          pending: 0,
          other: 0,
          start: 1706828654274,
          stop: 1706828655782,
        },
        tests: [
          {
            name: 'step test',
            status: 'passed',
            duration: 100,
            steps: [{ name: 'setup', status: 'other' }],
          },
        ],
      },
    });
    const result = CtrfReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CtrfReportSchema — missing required fields
// ---------------------------------------------------------------------------

describe('CtrfReportSchema — missing required fields', () => {
  it('rejects missing reportFormat', () => {
    const { reportFormat: _, ...report } = buildMinimalReport();
    const result = CtrfReportSchema.safeParse(report);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects missing specVersion', () => {
    const { specVersion: _, ...report } = buildMinimalReport();
    const result = CtrfReportSchema.safeParse(report);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects missing results', () => {
    const { results: _, ...report } = buildMinimalReport();
    const result = CtrfReportSchema.safeParse(report);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects missing results.tool', () => {
    const report = buildMinimalReport();
    const { tool: _, ...results } = report.results;
    const result = CtrfReportSchema.safeParse({
      ...report,
      results,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing results.tool.name', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tool: {},
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty results.tool.name', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tool: { name: '' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing results.summary', () => {
    const report = buildMinimalReport();
    const { summary: _, ...results } = report.results;
    const result = CtrfReportSchema.safeParse({
      ...report,
      results,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing results.tests', () => {
    const report = buildMinimalReport();
    const { tests: _, ...results } = report.results;
    const result = CtrfReportSchema.safeParse({
      ...report,
      results,
    });
    expect(result.success).toBe(false);
  });

  // Test each required summary field individually
  const requiredSummaryFields = [
    'tests',
    'passed',
    'failed',
    'skipped',
    'pending',
    'other',
    'start',
    'stop',
  ] as const;

  it.each(requiredSummaryFields)(
    'rejects missing summary.%s',
    (field) => {
      const report = buildMinimalReport();
      const summary = { ...report.results.summary };
      delete (summary as Record<string, unknown>)[field];
      const result = CtrfReportSchema.safeParse({
        ...report,
        results: { ...report.results, summary },
      });
      expect(result.success).toBe(false);
    },
  );

  // Test each required test field individually
  const requiredTestFields = ['name', 'status', 'duration'] as const;

  it.each(requiredTestFields)(
    'rejects test missing required field "%s"',
    (field) => {
      const report = buildMinimalReport();
      const test = { ...report.results.tests[0] };
      delete (test as Record<string, unknown>)[field];
      const result = CtrfReportSchema.safeParse({
        ...report,
        results: { ...report.results, tests: [test] },
      });
      expect(result.success).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// CtrfReportSchema — wrong types
// ---------------------------------------------------------------------------

describe('CtrfReportSchema — wrong types', () => {
  it('rejects reportFormat that is not "CTRF"', () => {
    const result = CtrfReportSchema.safeParse(
      buildMinimalReport({ reportFormat: 'JUnit' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects specVersion that is not semver', () => {
    const result = CtrfReportSchema.safeParse(
      buildMinimalReport({ specVersion: 'v1' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-integer summary.passed (string)', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        summary: { ...report.results.summary, passed: 'five' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer summary.tests (float)', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        summary: { ...report.results.summary, tests: 1.5 },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer test duration (string)', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [{ name: 'test', status: 'passed', duration: 'fast' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer test duration (float)', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [{ name: 'test', status: 'passed', duration: 100.5 }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid test status', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [{ name: 'test', status: 'completed', duration: 100 }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean flaky on test', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [
          { name: 'test', status: 'passed', duration: 100, flaky: 'yes' },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID reportId', () => {
    const result = CtrfReportSchema.safeParse(
      buildMinimalReport({ reportId: 'not-a-uuid' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-datetime timestamp', () => {
    const result = CtrfReportSchema.safeParse(
      buildMinimalReport({ timestamp: 'yesterday' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-integer buildNumber in environment', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        environment: { buildNumber: '42' },
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CtrfReportSchema — strict mode (unknown properties rejected)
// ---------------------------------------------------------------------------

describe('CtrfReportSchema — strict mode', () => {
  it('rejects unknown top-level properties', () => {
    const result = CtrfReportSchema.safeParse(
      buildMinimalReport({ unknownField: 'bad' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties in results', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: { ...report.results, badProp: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties in tool', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tool: { name: 'vitest', badProp: true },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties in summary', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        summary: { ...report.results.summary, badProp: true },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties in test', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [
          { name: 'test', status: 'passed', duration: 100, badProp: true },
        ],
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CtrfReportSchema — edge cases
// ---------------------------------------------------------------------------

describe('CtrfReportSchema — edge cases', () => {
  it('accepts an empty tests array', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts test name with minimum length (1 char)', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [{ name: 'x', status: 'passed', duration: 0 }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects test with empty name', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [{ name: '', status: 'passed', duration: 0 }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts suite with minimum 1 element', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [
          { name: 'test', status: 'passed', duration: 100, suite: ['auth'] },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects suite with 0 elements (minItems: 1)', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [
          { name: 'test', status: 'passed', duration: 100, suite: [] },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts retryAttempt with minimum attempt = 1', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [
          {
            name: 'test',
            status: 'passed',
            duration: 100,
            retryAttempts: [{ attempt: 1, status: 'passed' }],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects retryAttempt with attempt = 0', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        tests: [
          {
            name: 'test',
            status: 'passed',
            duration: 100,
            retryAttempts: [{ attempt: 0, status: 'passed' }],
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts all five statuses in the same report', () => {
    const report = buildMinimalReport({
      results: {
        tool: { name: 'vitest' },
        summary: {
          tests: 5,
          passed: 1,
          failed: 1,
          skipped: 1,
          pending: 1,
          other: 1,
          start: 1706828654274,
          stop: 1706828655782,
        },
        tests: [
          { name: 'passed test', status: 'passed', duration: 100 },
          { name: 'failed test', status: 'failed', duration: 200 },
          { name: 'skipped test', status: 'skipped', duration: 0 },
          { name: 'pending test', status: 'pending', duration: 0 },
          { name: 'other test', status: 'other', duration: 50 },
        ],
      },
    });
    const result = CtrfReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });

  it('accepts specVersion with multi-digit segments', () => {
    const result = CtrfReportSchema.safeParse(
      buildMinimalReport({ specVersion: '10.20.300' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects specVersion with leading "v"', () => {
    const result = CtrfReportSchema.safeParse(
      buildMinimalReport({ specVersion: 'v1.0.0' }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Zod error shape verification
// ---------------------------------------------------------------------------

describe('CtrfReportSchema — Zod error shape', () => {
  it('produces ZodError with issues array on validation failure', () => {
    const result = CtrfReportSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error.issues).toBeInstanceOf(Array);
      expect(result.error.issues.length).toBeGreaterThan(0);
      // Each issue has code, message, and path
      for (const issue of result.error.issues) {
        expect(issue).toHaveProperty('code');
        expect(issue).toHaveProperty('message');
        expect(issue).toHaveProperty('path');
      }
    }
  });

  it('includes field path in validation error for nested missing field', () => {
    const report = buildMinimalReport();
    const result = CtrfReportSchema.safeParse({
      ...report,
      results: {
        ...report.results,
        summary: { ...report.results.summary, passed: 'five' },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // The error should reference the path to the invalid field
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.includes('passed'))).toBe(true);
    }
  });
});

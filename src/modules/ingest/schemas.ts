/**
 * CTRF Report Zod Schema — single source of truth for runtime validation
 * and TypeScript types for the CTRF ingest pipeline.
 *
 * Targeted upstream spec version: CTRF JSON Schema v1.0.0
 * Source: https://github.com/ctrf-io/ctrf/blob/main/schema/ctrf.schema.json
 *
 * This schema mirrors the upstream CTRF JSON Schema exactly. All field names,
 * types, required/optional distinctions, and enum values match the canonical
 * spec. TypeScript types are derived via `z.infer<>` — no hand-written
 * interfaces duplicate this shape.
 *
 * @see skills/zod-schema-first.md
 * @see skills/ctrf-ingest-validation.md
 * @see docs/planning/gaps.md §G-P2-004 — `status: 'other'` is included
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

/**
 * Test status enum — the five canonical CTRF statuses.
 * Includes `'other'` per upstream spec and gap G-P2-004.
 */
export const CtrfStatusSchema = z.enum([
  'passed',
  'failed',
  'skipped',
  'pending',
  'other',
]);
export type CtrfStatus = z.infer<typeof CtrfStatusSchema>;

/**
 * Metric with baseline comparison — used in `insights` objects.
 * Maps to `#/definitions/metricDelta` in the upstream JSON Schema.
 */
const MetricDeltaSchema = z.object({
  current: z.number().optional(),
  baseline: z.number().optional(),
  change: z.number().optional(),
}).strict();

/**
 * Attachment / artifact reference.
 * Used in both test-level and retry-attempt-level `attachments` arrays.
 */
const AttachmentSchema = z.object({
  name: z.string(),
  contentType: z.string(),
  path: z.string(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Retry attempt sub-schema
// ---------------------------------------------------------------------------

/**
 * A single retry attempt for a test case.
 */
const RetryAttemptSchema = z.object({
  attempt: z.number().int().min(1),
  status: CtrfStatusSchema,
  duration: z.number().int().optional(),
  message: z.string().optional(),
  trace: z.string().optional(),
  line: z.number().int().optional(),
  snippet: z.string().optional(),
  stdout: z.array(z.string()).optional(),
  stderr: z.array(z.string()).optional(),
  start: z.number().int().optional(),
  stop: z.number().int().optional(),
  attachments: z.array(AttachmentSchema).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Test step sub-schema
// ---------------------------------------------------------------------------

/**
 * A single step within a test case.
 */
const TestStepSchema = z.object({
  name: z.string(),
  status: CtrfStatusSchema,
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Test-level insights sub-schema
// ---------------------------------------------------------------------------

/**
 * Derived metrics for a test case across runs.
 */
const TestInsightsSchema = z.object({
  passRate: MetricDeltaSchema.optional(),
  failRate: MetricDeltaSchema.optional(),
  flakyRate: MetricDeltaSchema.optional(),
  averageTestDuration: MetricDeltaSchema.optional(),
  p95TestDuration: MetricDeltaSchema.optional(),
  executedInRuns: z.number().int().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Test case schema
// ---------------------------------------------------------------------------

/**
 * Individual test case result.
 * Required fields: `name`, `status`, `duration` (per upstream spec).
 */
const CtrfTestSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  status: CtrfStatusSchema,
  duration: z.number().int(),
  start: z.number().int().optional(),
  stop: z.number().int().optional(),
  suite: z.array(z.string()).min(1).optional(),
  message: z.string().optional(),
  trace: z.string().optional(),
  snippet: z.string().optional(),
  ai: z.string().optional(),
  line: z.number().int().optional(),
  rawStatus: z.string().optional(),
  tags: z.array(z.string()).optional(),
  labels: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  type: z.string().optional(),
  filePath: z.string().optional(),
  retries: z.number().int().optional(),
  retryAttempts: z.array(RetryAttemptSchema).optional(),
  flaky: z.boolean().optional(),
  stdout: z.array(z.string()).optional(),
  stderr: z.array(z.string()).optional(),
  threadId: z.string().optional(),
  browser: z.string().optional(),
  device: z.string().optional(),
  screenshot: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(TestStepSchema).optional(),
  insights: TestInsightsSchema.optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type CtrfTest = z.infer<typeof CtrfTestSchema>;

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

/**
 * Tool / framework that produced the test results.
 * Required: `name` (non-empty string).
 */
const CtrfToolSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Summary schema
// ---------------------------------------------------------------------------

/**
 * Aggregated statistics and timing for the test run.
 * All counter fields and `start`/`stop` are required per the upstream spec.
 */
const CtrfSummarySchema = z.object({
  tests: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  pending: z.number().int(),
  other: z.number().int(),
  flaky: z.number().int().optional(),
  suites: z.number().int().optional(),
  start: z.number().int(),
  stop: z.number().int(),
  duration: z.number().int().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Environment schema
// ---------------------------------------------------------------------------

/**
 * Execution environment, system configuration, and build context.
 * All fields are optional per the upstream spec.
 */
const CtrfEnvironmentSchema = z.object({
  reportName: z.string().optional(),
  appName: z.string().optional(),
  appVersion: z.string().optional(),
  buildId: z.string().optional(),
  buildName: z.string().optional(),
  buildNumber: z.number().int().optional(),
  buildUrl: z.string().optional(),
  repositoryName: z.string().optional(),
  repositoryUrl: z.string().optional(),
  commit: z.string().optional(),
  branchName: z.string().optional(),
  osPlatform: z.string().optional(),
  osRelease: z.string().optional(),
  osVersion: z.string().optional(),
  testEnvironment: z.string().optional(),
  healthy: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Results schema
// ---------------------------------------------------------------------------

/**
 * The `results` object — core of every CTRF report.
 * Required: `tool`, `summary`, `tests`.
 */
const CtrfResultsSchema = z.object({
  tool: CtrfToolSchema,
  summary: CtrfSummarySchema,
  tests: z.array(CtrfTestSchema),
  environment: CtrfEnvironmentSchema.optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Report-level insights schema
// ---------------------------------------------------------------------------

/**
 * Aggregated metrics computed across multiple test runs.
 */
const ReportInsightsSchema = z.object({
  passRate: MetricDeltaSchema.optional(),
  failRate: MetricDeltaSchema.optional(),
  flakyRate: MetricDeltaSchema.optional(),
  averageRunDuration: MetricDeltaSchema.optional(),
  p95RunDuration: MetricDeltaSchema.optional(),
  averageTestDuration: MetricDeltaSchema.optional(),
  runsAnalyzed: z.number().int().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Baseline schema
// ---------------------------------------------------------------------------

/**
 * Reference to a previous report used for comparison.
 * Required: `reportId`.
 */
const BaselineSchema = z.object({
  reportId: z.string().uuid(),
  timestamp: z.string().datetime().optional(),
  source: z.string().optional(),
  buildNumber: z.number().int().optional(),
  buildName: z.string().optional(),
  buildUrl: z.string().url().optional(),
  commit: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Top-level CTRF Report schema
// ---------------------------------------------------------------------------

/**
 * The full CTRF report schema — top-level document.
 *
 * Required fields: `reportFormat` (literal "CTRF"), `specVersion` (semver
 * string), and `results`.
 *
 * This schema is the **single source of truth** for validating incoming
 * CTRF JSON reports in the ingest pipeline. The derived TypeScript type
 * `CtrfReport` is the canonical type used throughout the application.
 *
 * @see skills/zod-schema-first.md — no parallel interfaces
 * @see skills/ctrf-ingest-validation.md — ingest endpoint contract
 */
export const CtrfReportSchema = z.object({
  reportFormat: z.literal('CTRF'),
  specVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  reportId: z.string().uuid().optional(),
  timestamp: z.string().datetime().optional(),
  generatedBy: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  results: CtrfResultsSchema,
  insights: ReportInsightsSchema.optional(),
  baseline: BaselineSchema.optional(),
}).strict();

/**
 * The canonical TypeScript type for a CTRF report.
 * Derived from `CtrfReportSchema` — never define a parallel interface.
 */
export type CtrfReport = z.infer<typeof CtrfReportSchema>;

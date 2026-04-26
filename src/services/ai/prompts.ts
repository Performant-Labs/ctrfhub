/**
 * Shared prompt templates for AI providers.
 *
 * All three providers (OpenAI, Anthropic, Groq) use identical prompt
 * content — only the SDK wrapper differs. This module prevents prompt
 * drift across providers.
 *
 * Prompts here are a minimal, functional starting point. AI-002/AI-003
 * will refine them as the pipeline is wired end-to-end.
 *
 * @see docs/planning/ai-features.md §A1, §A2, §A3
 */

import type {
  CategorizeFailuresInput,
  CorrelateRootCausesInput,
  GenerateRunSummaryInput,
} from './types.js';

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

export const CATEGORIZATION_SYSTEM_PROMPT = `You are a test failure categorization expert. Analyze each failed test and assign exactly one category.

Categories:
- app_defect: Code regression — the test caught a real bug
- test_data: Bad seed data, missing fixtures, stale mocks
- script_error: Test itself is broken (wrong selector, bad assertion)
- environment: Infrastructure failure (network, DB down, timeout)
- unknown: Cannot determine with confidence

Respond with JSON only: { "categories": [{ "resultId": number, "category": string, "confidence": number }] }`;

export const CORRELATION_SYSTEM_PROMPT = `You are a root cause correlation expert. Given a set of failed test results with their categories, group them by apparent root cause.

Output at most 10 clusters. Each cluster should have a human-readable label, dominant category, confidence score, list of result IDs, and explanation.

Respond with JSON only: { "clusters": [{ "label": string, "category": string, "confidence": number, "resultIds": number[], "explanation": string }] }`;

export const SUMMARY_SYSTEM_PROMPT = `You are a QA reporting assistant. Generate a concise 3-5 sentence plain English summary of a test run. Focus on actionable insights: what broke, why, and what to do about it. Be specific about numbers and root causes.`;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/** Build the user prompt for A1 categorization. */
export function buildCategorizationPrompt(input: CategorizeFailuresInput): string {
  const results = input.results.map((r) => ({
    resultId: r.resultId,
    testName: r.testName,
    errorMessage: r.errorMessage ?? '(none)',
    stackTrace: r.stackTrace ?? '(none)',
  }));
  return `Categorize these ${results.length} failed test results from run #${input.runId}:\n\n${JSON.stringify(results, null, 2)}`;
}

/** Build the user prompt for A2 root cause correlation. */
export function buildCorrelationPrompt(input: CorrelateRootCausesInput): string {
  const results = input.results.map((r) => ({
    resultId: r.resultId,
    testName: r.testName,
    errorMessage: r.errorMessage ?? '(none)',
    stackTrace: r.stackTrace ?? '(none)',
    category: r.category,
  }));
  return `Group these ${results.length} failed test results from run #${input.runId} by root cause:\n\n${JSON.stringify(results, null, 2)}`;
}

/** Build the user prompt for A3 run narrative summary. */
export function buildSummaryPrompt(input: GenerateRunSummaryInput): string {
  const passRate = input.totalTests > 0
    ? ((input.passed / input.totalTests) * 100).toFixed(1)
    : '0.0';

  let prompt = `Summarize this test run (#${input.runId}):\n`;
  prompt += `- Total: ${input.totalTests}, Passed: ${input.passed}, Failed: ${input.failed}, Skipped: ${input.skipped}\n`;
  prompt += `- Pass rate: ${passRate}%\n`;

  if (input.environment) prompt += `- Environment: ${input.environment}\n`;
  if (input.branch) prompt += `- Branch: ${input.branch}\n`;
  if (input.commitSha) prompt += `- Commit: ${input.commitSha}\n`;

  if (input.previousPassRate !== null) {
    const delta = ((input.passed / Math.max(input.totalTests, 1)) - input.previousPassRate) * 100;
    prompt += `- Pass rate delta from previous run: ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%\n`;
  }

  const categories = Object.entries(input.categoryDistribution)
    .filter(([, count]) => count > 0)
    .map(([cat, count]) => `${cat}: ${count}`);
  if (categories.length > 0) {
    prompt += `- Failure categories: ${categories.join(', ')}\n`;
  }

  if (input.rootCauseClusters.length > 0) {
    prompt += `\nRoot cause clusters:\n`;
    for (const cluster of input.rootCauseClusters) {
      prompt += `- "${cluster.label}" (${cluster.category}): ${cluster.resultIds.length} tests — ${cluster.explanation}\n`;
    }
  }

  return prompt;
}

/**
 * Unit tests for MockAiProvider — setter/getter contract.
 *
 * Verifies: single response, sequence response, throw on unset, calls[]
 * recording, deep clone on record, reset(), and close(). No SDK imports,
 * no DB, no HTTP — pure in-memory.
 *
 * @see src/__tests__/doubles/MockAiProvider.ts
 * @see skills/vitest-three-layer-testing.md §Layer 1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockAiProvider } from '../doubles/MockAiProvider.js';
import type {
  CategorizeFailuresInput,
  CategorizeFailuresOutput,
  CorrelateRootCausesInput,
  CorrelateRootCausesOutput,
  GenerateRunSummaryInput,
  GenerateRunSummaryOutput,
} from '../../services/ai/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const catInput: CategorizeFailuresInput = {
  runId: 1,
  results: [
    { resultId: 10, testName: 'login test', errorMessage: 'timeout', stackTrace: null },
  ],
};

const catOutput: CategorizeFailuresOutput = {
  categories: [{ resultId: 10, category: 'environment', confidence: 0.9 }],
  model: 'mock',
  tokensUsed: 0,
};

const catOutput2: CategorizeFailuresOutput = {
  categories: [{ resultId: 10, category: 'app_defect', confidence: 0.8 }],
  model: 'mock',
  tokensUsed: 10,
};

const rootInput: CorrelateRootCausesInput = {
  runId: 1,
  results: [
    {
      resultId: 10,
      testName: 'login test',
      errorMessage: 'timeout',
      stackTrace: null,
      category: 'environment',
    },
  ],
};

const rootOutput: CorrelateRootCausesOutput = {
  clusters: [
    {
      label: 'DB timeout',
      category: 'environment',
      confidence: 0.85,
      resultIds: [10],
      explanation: 'Database connection timed out',
    },
  ],
  model: 'mock',
  tokensUsed: 0,
};

const summaryInput: GenerateRunSummaryInput = {
  runId: 1,
  totalTests: 100,
  passed: 90,
  failed: 8,
  skipped: 2,
  environment: 'staging',
  branch: 'main',
  commitSha: 'abc123',
  categoryDistribution: {
    app_defect: 3,
    test_data: 2,
    script_error: 1,
    environment: 2,
    unknown: 0,
  },
  rootCauseClusters: [],
  previousPassRate: 0.95,
};

const summaryOutput: GenerateRunSummaryOutput = {
  summary: 'The test run showed a 90% pass rate.',
  model: 'mock',
  tokensUsed: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MockAiProvider', () => {
  let ai: MockAiProvider;

  beforeEach(() => {
    ai = new MockAiProvider();
  });

  // ── Throw on unset ─────────────────────────────────────────────

  describe('throw on unset response', () => {
    it('categorizeFailures throws when no response is set', async () => {
      await expect(ai.categorizeFailures(catInput)).rejects.toThrow(
        /no response has been set/,
      );
    });

    it('correlateRootCauses throws when no response is set', async () => {
      await expect(ai.correlateRootCauses(rootInput)).rejects.toThrow(
        /no response has been set/,
      );
    });

    it('generateRunSummary throws when no response is set', async () => {
      await expect(ai.generateRunSummary(summaryInput)).rejects.toThrow(
        /no response has been set/,
      );
    });

    it('error message mentions available setters', async () => {
      await expect(ai.categorizeFailures(catInput)).rejects.toThrow(/setCategorization/);
    });
  });

  // ── Single response mode ───────────────────────────────────────

  describe('single response mode', () => {
    it('categorizeFailures returns the same response on every call', async () => {
      ai.setCategorization(catOutput);
      const r1 = await ai.categorizeFailures(catInput);
      const r2 = await ai.categorizeFailures(catInput);
      expect(r1).toEqual(catOutput);
      expect(r2).toEqual(catOutput);
    });

    it('correlateRootCauses returns the same response on every call', async () => {
      ai.setRootCauses(rootOutput);
      const r1 = await ai.correlateRootCauses(rootInput);
      const r2 = await ai.correlateRootCauses(rootInput);
      expect(r1).toEqual(rootOutput);
      expect(r2).toEqual(rootOutput);
    });

    it('generateRunSummary returns the same response on every call', async () => {
      ai.setSummary(summaryOutput);
      const r1 = await ai.generateRunSummary(summaryInput);
      const r2 = await ai.generateRunSummary(summaryInput);
      expect(r1).toEqual(summaryOutput);
      expect(r2).toEqual(summaryOutput);
    });
  });

  // ── Sequence response mode ─────────────────────────────────────

  describe('sequence response mode', () => {
    it('returns responses in order for categorizeFailures', async () => {
      ai.setCategorization([catOutput, catOutput2]);
      const r1 = await ai.categorizeFailures(catInput);
      const r2 = await ai.categorizeFailures(catInput);
      expect(r1).toEqual(catOutput);
      expect(r2).toEqual(catOutput2);
    });

    it('throws when sequence is exhausted', async () => {
      ai.setCategorization([catOutput]);
      await ai.categorizeFailures(catInput); // consume the one response
      await expect(ai.categorizeFailures(catInput)).rejects.toThrow(
        /response sequence exhausted/,
      );
    });

    it('exhaustion error message includes counts', async () => {
      ai.setCategorization([catOutput]);
      await ai.categorizeFailures(catInput);
      await expect(ai.categorizeFailures(catInput)).rejects.toThrow(
        /1 responses seeded, call #2/,
      );
    });

    it('returns responses in order for correlateRootCauses', async () => {
      const rootOutput2: CorrelateRootCausesOutput = {
        ...rootOutput,
        clusters: [{ ...rootOutput.clusters[0]!, label: 'Network issue' }],
      };
      ai.setRootCauses([rootOutput, rootOutput2]);
      const r1 = await ai.correlateRootCauses(rootInput);
      const r2 = await ai.correlateRootCauses(rootInput);
      expect(r1.clusters[0]!.label).toBe('DB timeout');
      expect(r2.clusters[0]!.label).toBe('Network issue');
    });

    it('returns responses in order for generateRunSummary', async () => {
      const summaryOutput2: GenerateRunSummaryOutput = {
        ...summaryOutput,
        summary: 'Second summary.',
      };
      ai.setSummary([summaryOutput, summaryOutput2]);
      const r1 = await ai.generateRunSummary(summaryInput);
      const r2 = await ai.generateRunSummary(summaryInput);
      expect(r1.summary).toBe('The test run showed a 90% pass rate.');
      expect(r2.summary).toBe('Second summary.');
    });
  });

  // ── calls[] recording ──────────────────────────────────────────

  describe('calls[] recording', () => {
    it('records categorizeFailures calls', async () => {
      ai.setCategorization(catOutput);
      await ai.categorizeFailures(catInput);
      expect(ai.calls).toHaveLength(1);
      expect(ai.calls[0]!.method).toBe('categorizeFailures');
      expect(ai.calls[0]!.input).toEqual(catInput);
    });

    it('records correlateRootCauses calls', async () => {
      ai.setRootCauses(rootOutput);
      await ai.correlateRootCauses(rootInput);
      expect(ai.calls).toHaveLength(1);
      expect(ai.calls[0]!.method).toBe('correlateRootCauses');
    });

    it('records generateRunSummary calls', async () => {
      ai.setSummary(summaryOutput);
      await ai.generateRunSummary(summaryInput);
      expect(ai.calls).toHaveLength(1);
      expect(ai.calls[0]!.method).toBe('generateRunSummary');
    });

    it('preserves call order across methods', async () => {
      ai.setCategorization(catOutput);
      ai.setRootCauses(rootOutput);
      ai.setSummary(summaryOutput);

      await ai.categorizeFailures(catInput);
      await ai.correlateRootCauses(rootInput);
      await ai.generateRunSummary(summaryInput);

      expect(ai.calls).toHaveLength(3);
      expect(ai.calls.map((c) => c.method)).toEqual([
        'categorizeFailures',
        'correlateRootCauses',
        'generateRunSummary',
      ]);
    });

    it('deep-clones input to prevent mutation', async () => {
      ai.setCategorization(catOutput);
      const mutableInput: CategorizeFailuresInput = {
        runId: 1,
        results: [{ resultId: 99, testName: 'mutable', errorMessage: null, stackTrace: null }],
      };
      await ai.categorizeFailures(mutableInput);

      // Mutate the original input after recording
      mutableInput.results[0]!.testName = 'MUTATED';

      // The recorded call should have the original value
      const recorded = ai.calls[0]!.input as CategorizeFailuresInput;
      expect(recorded.results[0]!.testName).toBe('mutable');
    });

    it('still records calls even when response throws (unset)', async () => {
      try {
        await ai.categorizeFailures(catInput);
      } catch {
        // expected
      }
      // The call was recorded before the throw
      expect(ai.calls).toHaveLength(1);
      expect(ai.calls[0]!.method).toBe('categorizeFailures');
    });
  });

  // ── reset() ────────────────────────────────────────────────────

  describe('reset()', () => {
    it('clears calls', async () => {
      ai.setCategorization(catOutput);
      await ai.categorizeFailures(catInput);
      expect(ai.calls).toHaveLength(1);

      ai.reset();
      expect(ai.calls).toHaveLength(0);
    });

    it('clears seeded responses — throw after reset', async () => {
      ai.setCategorization(catOutput);
      ai.setRootCauses(rootOutput);
      ai.setSummary(summaryOutput);

      ai.reset();

      await expect(ai.categorizeFailures(catInput)).rejects.toThrow(/no response has been set/);
      await expect(ai.correlateRootCauses(rootInput)).rejects.toThrow(/no response has been set/);
      await expect(ai.generateRunSummary(summaryInput)).rejects.toThrow(
        /no response has been set/,
      );
    });

    it('allows re-seeding after reset', async () => {
      ai.setCategorization(catOutput);
      await ai.categorizeFailures(catInput);

      ai.reset();
      ai.setCategorization(catOutput2);
      const result = await ai.categorizeFailures(catInput);

      expect(result).toEqual(catOutput2);
      expect(ai.calls).toHaveLength(1); // only the post-reset call
    });
  });

  // ── close() ────────────────────────────────────────────────────

  describe('close()', () => {
    it('resolves without error', async () => {
      await expect(ai.close()).resolves.toBeUndefined();
    });

    it('can be called multiple times', async () => {
      await ai.close();
      await expect(ai.close()).resolves.toBeUndefined();
    });
  });

  // ── Setter mode switching ──────────────────────────────────────

  describe('setter mode switching', () => {
    it('switching from single to sequence works', async () => {
      ai.setCategorization(catOutput);
      const r1 = await ai.categorizeFailures(catInput);
      expect(r1).toEqual(catOutput);

      // Switch to sequence
      ai.setCategorization([catOutput2]);
      const r2 = await ai.categorizeFailures(catInput);
      expect(r2).toEqual(catOutput2);
    });

    it('switching from sequence to single works', async () => {
      ai.setCategorization([catOutput]);
      await ai.categorizeFailures(catInput);

      // Switch to single — resets the sequence
      ai.setCategorization(catOutput2);
      const r = await ai.categorizeFailures(catInput);
      expect(r).toEqual(catOutput2);
    });
  });
});

/**
 * AI Provider Factory — creates the correct AiProvider based on env vars.
 *
 * This is the single entry point for constructing an AI provider at runtime.
 * The provider is selected by `process.env.AI_PROVIDER` and configured with
 * `process.env.AI_API_KEY` and optional `process.env.AI_MODEL`.
 *
 * Re-exports all types and helpers so downstream code can import from
 * `src/services/ai/index.js` as a single module.
 *
 * @see docs/planning/architecture.md §Environment variables
 * @see docs/planning/ai-features.md §Provider Strategy
 */

import type { AiProvider } from './types.js';
import { OpenAiProvider } from './providers/openai.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GroqProvider } from './providers/groq.js';

// Re-export everything downstream consumers need
export type {
  AiProvider,
  AiCategory,
  CategorizeFailuresInput,
  CategorizeFailuresOutput,
  CorrelateRootCausesInput,
  CorrelateRootCausesOutput,
  GenerateRunSummaryInput,
  GenerateRunSummaryOutput,
} from './types.js';

export {
  getEffectiveCategory,
  getCategorySource,
  splitIntoBatches,
} from './helpers.js';

export type { CategoryFields } from './helpers.js';

export { OpenAiProvider } from './providers/openai.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { GroqProvider } from './providers/groq.js';

/**
 * Create an AiProvider instance based on environment variables.
 *
 * Reads:
 * - `AI_PROVIDER` — `'openai'`, `'anthropic'`, or `'groq'` (required)
 * - `AI_API_KEY` — API key for the selected provider (required)
 * - `AI_MODEL` — Optional model override (falls back to provider default)
 *
 * @throws If `AI_PROVIDER` is not set or is an unknown value.
 * @throws If `AI_API_KEY` is not set when a provider is selected.
 *
 * @returns A configured AiProvider instance.
 */
export function createAiProvider(): AiProvider {
  const provider = process.env['AI_PROVIDER'];
  const apiKey = process.env['AI_API_KEY'];
  const model = process.env['AI_MODEL'];

  if (!provider) {
    throw new Error(
      'AI_PROVIDER environment variable is not set. ' +
      'Expected one of: openai, anthropic, groq.',
    );
  }

  if (!apiKey) {
    throw new Error(
      `AI_API_KEY environment variable is not set but AI_PROVIDER="${provider}". ` +
      'An API key is required to use AI features.',
    );
  }

  switch (provider) {
    case 'openai':
      return new OpenAiProvider({ apiKey, model });
    case 'anthropic':
      return new AnthropicProvider({ apiKey, model });
    case 'groq':
      return new GroqProvider({ apiKey, model });
    default:
      throw new Error(
        `Unknown AI_PROVIDER: "${provider}". ` +
        'Expected one of: openai, anthropic, groq.',
      );
  }
}

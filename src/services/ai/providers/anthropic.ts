/**
 * AnthropicProvider — AiProvider implementation using the Anthropic SDK.
 *
 * Default model: `claude-haiku-4-5-20251001` (from `ai-features.md §Default models`).
 *
 * @see docs/planning/ai-features.md §Provider Strategy
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
  CategorizeFailuresInput,
  CategorizeFailuresOutput,
  CorrelateRootCausesInput,
  CorrelateRootCausesOutput,
  GenerateRunSummaryInput,
  GenerateRunSummaryOutput,
} from '../types.js';
import {
  CATEGORIZATION_SYSTEM_PROMPT,
  CORRELATION_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildCategorizationPrompt,
  buildCorrelationPrompt,
  buildSummaryPrompt,
} from '../prompts.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
}

export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async categorizeFailures(input: CategorizeFailuresInput): Promise<CategorizeFailuresOutput> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: CATEGORIZATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildCategorizationPrompt(input) }],
    });
    const parsed = JSON.parse(extractText(response)) as CategorizeFailuresOutput;
    return {
      categories: parsed.categories ?? [],
      model: this.model,
      tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    };
  }

  async correlateRootCauses(input: CorrelateRootCausesInput): Promise<CorrelateRootCausesOutput> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: CORRELATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildCorrelationPrompt(input) }],
    });
    const parsed = JSON.parse(extractText(response)) as CorrelateRootCausesOutput;
    return {
      clusters: parsed.clusters ?? [],
      model: this.model,
      tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    };
  }

  async generateRunSummary(input: GenerateRunSummaryInput): Promise<GenerateRunSummaryOutput> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildSummaryPrompt(input) }],
    });
    return {
      summary: extractText(response).trim(),
      model: this.model,
      tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    };
  }

  async close(): Promise<void> {}
}

/** Extract text content from an Anthropic Message response. */
function extractText(response: Anthropic.Message): string {
  for (const block of response.content) {
    if (block.type === 'text') return block.text;
  }
  return '{}';
}

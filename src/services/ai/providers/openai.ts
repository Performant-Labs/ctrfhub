/**
 * OpenAiProvider — AiProvider implementation using the OpenAI SDK.
 *
 * Default model: `gpt-4o-mini` (from `ai-features.md §Default models`).
 *
 * @see docs/planning/ai-features.md §Provider Strategy
 */

import OpenAI from 'openai';
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

const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAiProviderOptions {
  apiKey: string;
  model?: string;
}

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async categorizeFailures(input: CategorizeFailuresInput): Promise<CategorizeFailuresOutput> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: CATEGORIZATION_SYSTEM_PROMPT },
        { role: 'user', content: buildCategorizationPrompt(input) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });
    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as CategorizeFailuresOutput;
    return {
      categories: parsed.categories ?? [],
      model: this.model,
      tokensUsed: response.usage?.total_tokens ?? 0,
    };
  }

  async correlateRootCauses(input: CorrelateRootCausesInput): Promise<CorrelateRootCausesOutput> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: CORRELATION_SYSTEM_PROMPT },
        { role: 'user', content: buildCorrelationPrompt(input) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });
    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as CorrelateRootCausesOutput;
    return {
      clusters: parsed.clusters ?? [],
      model: this.model,
      tokensUsed: response.usage?.total_tokens ?? 0,
    };
  }

  async generateRunSummary(input: GenerateRunSummaryInput): Promise<GenerateRunSummaryOutput> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: buildSummaryPrompt(input) },
      ],
      temperature: 0.3,
    });
    const content = response.choices[0]?.message?.content ?? '';
    return {
      summary: content.trim(),
      model: this.model,
      tokensUsed: response.usage?.total_tokens ?? 0,
    };
  }

  async close(): Promise<void> {}
}

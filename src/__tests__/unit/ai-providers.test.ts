/**
 * Type-level and factory tests for AI providers.
 *
 * Verifies:
 * - OpenAiProvider, AnthropicProvider, GroqProvider, MockAiProvider all
 *   satisfy the AiProvider interface (compile-time check).
 * - createAiProvider() factory reads env vars correctly and throws on
 *   missing/unknown values.
 *
 * **No real API calls.** The provider constructors are instantiated with
 * dummy API keys but no methods are called — this is a contract check, not
 * a functional test. The factory tests manipulate process.env and validate
 * error paths.
 *
 * @see src/services/ai/types.ts — AiProvider interface
 * @see src/services/ai/index.ts — createAiProvider factory
 * @see skills/vitest-three-layer-testing.md §Layer 1
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { AiProvider } from '../../services/ai/types.js';
import { OpenAiProvider } from '../../services/ai/providers/openai.js';
import { AnthropicProvider } from '../../services/ai/providers/anthropic.js';
import { GroqProvider } from '../../services/ai/providers/groq.js';
import { MockAiProvider } from '../doubles/MockAiProvider.js';
import { createAiProvider } from '../../services/ai/index.js';

// ---------------------------------------------------------------------------
// Type-level assertions — compile-time checks
// ---------------------------------------------------------------------------

describe('AiProvider interface satisfaction (type-level)', () => {
  it('OpenAiProvider satisfies AiProvider', () => {
    // This is a compile-time assertion: if OpenAiProvider doesn't implement
    // all AiProvider methods, TypeScript will error on this assignment.
    const _provider: AiProvider = new OpenAiProvider({ apiKey: 'test-key' });
    expect(_provider).toBeDefined();
  });

  it('AnthropicProvider satisfies AiProvider', () => {
    const _provider: AiProvider = new AnthropicProvider({ apiKey: 'test-key' });
    expect(_provider).toBeDefined();
  });

  it('GroqProvider satisfies AiProvider', () => {
    const _provider: AiProvider = new GroqProvider({ apiKey: 'test-key' });
    expect(_provider).toBeDefined();
  });

  it('MockAiProvider satisfies AiProvider', () => {
    const _provider: AiProvider = new MockAiProvider();
    expect(_provider).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Provider interface shape
// ---------------------------------------------------------------------------

describe('AiProvider method presence', () => {
  it('OpenAiProvider has all required methods', () => {
    const p = new OpenAiProvider({ apiKey: 'test-key' });
    expect(typeof p.categorizeFailures).toBe('function');
    expect(typeof p.correlateRootCauses).toBe('function');
    expect(typeof p.generateRunSummary).toBe('function');
    expect(typeof p.close).toBe('function');
  });

  it('AnthropicProvider has all required methods', () => {
    const p = new AnthropicProvider({ apiKey: 'test-key' });
    expect(typeof p.categorizeFailures).toBe('function');
    expect(typeof p.correlateRootCauses).toBe('function');
    expect(typeof p.generateRunSummary).toBe('function');
    expect(typeof p.close).toBe('function');
  });

  it('GroqProvider has all required methods', () => {
    const p = new GroqProvider({ apiKey: 'test-key' });
    expect(typeof p.categorizeFailures).toBe('function');
    expect(typeof p.correlateRootCauses).toBe('function');
    expect(typeof p.generateRunSummary).toBe('function');
    expect(typeof p.close).toBe('function');
  });

  it('MockAiProvider has all required methods plus test utilities', () => {
    const p = new MockAiProvider();
    // AiProvider methods
    expect(typeof p.categorizeFailures).toBe('function');
    expect(typeof p.correlateRootCauses).toBe('function');
    expect(typeof p.generateRunSummary).toBe('function');
    expect(typeof p.close).toBe('function');
    // Test utilities
    expect(typeof p.setCategorization).toBe('function');
    expect(typeof p.setRootCauses).toBe('function');
    expect(typeof p.setSummary).toBe('function');
    expect(typeof p.reset).toBe('function');
    expect(Array.isArray(p.calls)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createAiProvider factory
// ---------------------------------------------------------------------------

describe('createAiProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars after each test
    delete process.env['AI_PROVIDER'];
    delete process.env['AI_API_KEY'];
    delete process.env['AI_MODEL'];
    Object.assign(process.env, originalEnv);
  });

  it('throws when AI_PROVIDER is not set', () => {
    delete process.env['AI_PROVIDER'];
    expect(() => createAiProvider()).toThrow(/AI_PROVIDER environment variable is not set/);
  });

  it('throws when AI_API_KEY is not set', () => {
    process.env['AI_PROVIDER'] = 'openai';
    delete process.env['AI_API_KEY'];
    expect(() => createAiProvider()).toThrow(/AI_API_KEY environment variable is not set/);
  });

  it('throws on unknown provider', () => {
    process.env['AI_PROVIDER'] = 'deepseek';
    process.env['AI_API_KEY'] = 'test-key';
    expect(() => createAiProvider()).toThrow(/Unknown AI_PROVIDER: "deepseek"/);
  });

  it('creates OpenAiProvider for AI_PROVIDER=openai', () => {
    process.env['AI_PROVIDER'] = 'openai';
    process.env['AI_API_KEY'] = 'test-key';
    const provider = createAiProvider();
    expect(provider).toBeInstanceOf(OpenAiProvider);
  });

  it('creates AnthropicProvider for AI_PROVIDER=anthropic', () => {
    process.env['AI_PROVIDER'] = 'anthropic';
    process.env['AI_API_KEY'] = 'test-key';
    const provider = createAiProvider();
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('creates GroqProvider for AI_PROVIDER=groq', () => {
    process.env['AI_PROVIDER'] = 'groq';
    process.env['AI_API_KEY'] = 'test-key';
    const provider = createAiProvider();
    expect(provider).toBeInstanceOf(GroqProvider);
  });

  it('error message includes provider value when API key is missing', () => {
    process.env['AI_PROVIDER'] = 'anthropic';
    delete process.env['AI_API_KEY'];
    expect(() => createAiProvider()).toThrow(/AI_PROVIDER="anthropic"/);
  });

  it('error message lists valid providers when AI_PROVIDER is unset', () => {
    delete process.env['AI_PROVIDER'];
    expect(() => createAiProvider()).toThrow(/openai, anthropic, groq/);
  });
});

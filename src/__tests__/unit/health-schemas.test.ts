/**
 * Unit tests — Health endpoint Zod schemas.
 *
 * Layer 1: pure Zod parsing, zero I/O.
 * @see skills/vitest-three-layer-testing.md §Layer 1
 * @see src/modules/health/schemas.ts
 */

import { BootStateSchema, HealthResponseSchema } from '../../modules/health/schemas.js';

// ---------------------------------------------------------------------------
// BootStateSchema
// ---------------------------------------------------------------------------

describe('BootStateSchema', () => {
  it.each(['booting', 'migrating', 'ready'] as const)(
    'accepts valid boot state "%s"',
    (state) => {
      const result = BootStateSchema.safeParse(state);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(state);
      }
    },
  );

  it('rejects an invalid boot state', () => {
    const result = BootStateSchema.safeParse('failed');
    expect(result.success).toBe(false);
  });

  it('rejects a non-string value', () => {
    const result = BootStateSchema.safeParse(42);
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = BootStateSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HealthResponseSchema
// ---------------------------------------------------------------------------

describe('HealthResponseSchema', () => {
  it('accepts a valid "ready + ok" response', () => {
    const payload = { status: 'ok', bootState: 'ready', dbReady: true };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(payload);
    }
  });

  it('accepts a valid "booting" response', () => {
    const payload = { status: 'booting', bootState: 'booting', dbReady: false };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('accepts a valid "migrating" response', () => {
    const payload = { status: 'migrating', bootState: 'migrating', dbReady: false };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('accepts an "error" status with ready boot state', () => {
    const payload = { status: 'error', bootState: 'ready', dbReady: false };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects response with missing "status" field', () => {
    const payload = { bootState: 'ready', dbReady: true };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects response with missing "bootState" field', () => {
    const payload = { status: 'ok', dbReady: true };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects response with missing "dbReady" field', () => {
    const payload = { status: 'ok', bootState: 'ready' };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects response with invalid status value', () => {
    const payload = { status: 'down', bootState: 'ready', dbReady: true };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects response with non-boolean dbReady', () => {
    const payload = { status: 'ok', bootState: 'ready', dbReady: 'yes' };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('strips unknown properties', () => {
    const payload = { status: 'ok', bootState: 'ready', dbReady: true, extra: 'field' };
    const result = HealthResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('extra');
    }
  });
});

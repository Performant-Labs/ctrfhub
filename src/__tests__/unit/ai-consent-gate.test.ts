/**
 * Unit tests — AI pipeline consent gate (AI-002)
 *
 * Layer 1 (pure-ish function) — validates the two-gate consent model:
 * 1. Deployment gate: `AI_CLOUD_PIPELINE` env var must be 'on'
 * 2. Per-org gate: `organizations.ai_cloud_ack_at IS NOT NULL`
 *
 * The function itself does a DB lookup, so we test the env-var gate
 * in pure isolation and the full function via a minimal EntityManager
 * stub. No real DB, no HTTP, no filesystem.
 *
 * @see skills/vitest-three-layer-testing.md §Layer 1
 * @see src/services/ai/pipeline/consent.ts
 * @see docs/planning/ai-features.md §Privacy and consent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAiCloudPipelineConsented } from '../../services/ai/pipeline/consent.js';

// ---------------------------------------------------------------------------
// Env-var helpers
// ---------------------------------------------------------------------------

let savedEnv: string | undefined;

function saveEnv(): void {
  savedEnv = process.env['AI_CLOUD_PIPELINE'];
}

function restoreEnv(): void {
  if (savedEnv !== undefined) {
    process.env['AI_CLOUD_PIPELINE'] = savedEnv;
  } else {
    delete process.env['AI_CLOUD_PIPELINE'];
  }
}

// ---------------------------------------------------------------------------
// Minimal EM stub — only implements findOne for Organization
// ---------------------------------------------------------------------------

/**
 * Build a minimal EntityManager stub that resolves `findOne(Organization, orgId)`
 * with the given org object. This avoids a full ORM bootstrap for pure gate tests.
 */
function buildEmStub(org: { aiCloudAckAt: Date | null } | null): unknown {
  return {
    findOne: async (_Entity: unknown, _id: string) => org,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isAiCloudPipelineConsented — deployment gate (env var)', () => {
  beforeEach(saveEnv);
  afterEach(restoreEnv);

  it('returns false when AI_CLOUD_PIPELINE is not set', async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date() }) as any, 'org-1');
    expect(result).toBe(false);
  });

  it('returns false when AI_CLOUD_PIPELINE is empty string', async () => {
    process.env['AI_CLOUD_PIPELINE'] = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date() }) as any, 'org-1');
    expect(result).toBe(false);
  });

  it('returns false when AI_CLOUD_PIPELINE is "off"', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'off';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date() }) as any, 'org-1');
    expect(result).toBe(false);
  });

  it('returns false when AI_CLOUD_PIPELINE is "true" (not "on")', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'true';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date() }) as any, 'org-1');
    expect(result).toBe(false);
  });

  it('returns true when AI_CLOUD_PIPELINE is "on" (case-insensitive)', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'ON';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date() }) as any, 'org-1');
    expect(result).toBe(true);
  });

  it('returns true when AI_CLOUD_PIPELINE is "on" (lowercase)', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date() }) as any, 'org-1');
    expect(result).toBe(true);
  });
});

describe('isAiCloudPipelineConsented — per-org gate (aiCloudAckAt)', () => {
  beforeEach(() => {
    saveEnv();
    process.env['AI_CLOUD_PIPELINE'] = 'on';
  });
  afterEach(restoreEnv);

  it('returns false when org does not exist (findOne returns null)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub(null) as any, 'nonexistent');
    expect(result).toBe(false);
  });

  it('returns false when aiCloudAckAt is null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: null }) as any, 'org-1');
    expect(result).toBe(false);
  });

  it('returns true when aiCloudAckAt is a valid Date', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date('2024-01-15') }) as any, 'org-1');
    expect(result).toBe(true);
  });
});

describe('isAiCloudPipelineConsented — both gates combined', () => {
  beforeEach(saveEnv);
  afterEach(restoreEnv);

  it('returns false when env is "on" but org has null ack', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: null }) as any, 'org-1');
    expect(result).toBe(false);
  });

  it('returns false when org has ack but env is not set', async () => {
    delete process.env['AI_CLOUD_PIPELINE'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date() }) as any, 'org-1');
    expect(result).toBe(false);
  });

  it('returns true only when both gates pass', async () => {
    process.env['AI_CLOUD_PIPELINE'] = 'on';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isAiCloudPipelineConsented(buildEmStub({ aiCloudAckAt: new Date() }) as any, 'org-1');
    expect(result).toBe(true);
  });
});

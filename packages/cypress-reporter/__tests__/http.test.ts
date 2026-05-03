import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { postRunToCtrfHub } from '../src/http.js';

function makeCtrfPayload(summary: Record<string, unknown> = { tests: 5, passed: 5 }) {
  return { results: { summary } };
}

describe('postRunToCtrfHub', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env['CTRFHUB_INGEST_URL'];
    delete process.env['CTRFHUB_API_TOKEN'];
    delete process.env['CTRFHUB_PROJECT_SLUG'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('logs and returns without calling fetch when env vars are missing', async () => {
    await postRunToCtrfHub(makeCtrfPayload());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing required configuration'),
    );
  });

  it('logs runId on 201 success', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ runId: 'abc-123' }),
    });

    await postRunToCtrfHub(makeCtrfPayload(), {
      ingestUrl: 'https://example.com',
      apiToken: 'tok',
      projectSlug: 'proj',
    });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('runId=abc-123'),
    );
  });

  it('logs status and body on non-2xx response (422)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => 'Unprocessable Entity',
    });

    await postRunToCtrfHub(makeCtrfPayload(), {
      ingestUrl: 'https://example.com',
      apiToken: 'tok',
      projectSlug: 'proj',
    });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 422'),
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unprocessable Entity'),
    );
  });

  it('logs error without throwing on network failure', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      postRunToCtrfHub(makeCtrfPayload(), {
        ingestUrl: 'https://example.com',
        apiToken: 'tok',
        projectSlug: 'proj',
      }),
    ).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
    );
  });

  it('produces identical idempotency key for same summary and different key for different summary', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });

    const summaryA = { tests: 5, passed: 5 };
    const summaryB = { tests: 5, passed: 4, failed: 1 };

    await postRunToCtrfHub(makeCtrfPayload(summaryA), {
      ingestUrl: 'https://example.com',
      apiToken: 'tok',
      projectSlug: 'proj',
    });
    await postRunToCtrfHub(makeCtrfPayload(summaryA), {
      ingestUrl: 'https://example.com',
      apiToken: 'tok',
      projectSlug: 'proj',
    });
    await postRunToCtrfHub(makeCtrfPayload(summaryB), {
      ingestUrl: 'https://example.com',
      apiToken: 'tok',
      projectSlug: 'proj',
    });

    const calls = fetchSpy.mock.calls as [string, RequestInit][];
    const keyA1 = (calls[0]![1].headers as Record<string, string>)['Idempotency-Key'];
    const keyA2 = (calls[1]![1].headers as Record<string, string>)['Idempotency-Key'];
    const keyB = (calls[2]![1].headers as Record<string, string>)['Idempotency-Key'];

    const expectedA = createHash('sha256').update(JSON.stringify(summaryA)).digest('hex');
    expect(keyA1).toBe(expectedA);
    expect(keyA2).toBe(expectedA);
    expect(keyB).not.toBe(expectedA);
  });

  it('strips trailing slashes from ingestUrl', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) });

    await postRunToCtrfHub(makeCtrfPayload(), {
      ingestUrl: 'https://example.com//',
      apiToken: 'tok',
      projectSlug: 's',
    });

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toBe('https://example.com/api/v1/projects/s/runs');
  });

  it('opts argument overrides env vars', async () => {
    process.env['CTRFHUB_INGEST_URL'] = 'https://env.example.com';
    process.env['CTRFHUB_API_TOKEN'] = 'env-token';
    process.env['CTRFHUB_PROJECT_SLUG'] = 'env-slug';

    fetchSpy.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) });

    await postRunToCtrfHub(makeCtrfPayload(), {
      ingestUrl: 'https://opts.example.com',
      apiToken: 'opts-token',
      projectSlug: 'opts-slug',
    });

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    const headers = fetchSpy.mock.calls[0]![1].headers as Record<string, string>;

    expect(calledUrl).toBe('https://opts.example.com/api/v1/projects/opts-slug/runs');
    expect(headers['x-api-token']).toBe('opts-token');
  });
});

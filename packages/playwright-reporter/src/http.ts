import { createHash } from 'node:crypto';

export interface CtrfHubOpts {
  ingestUrl?: string;
  apiToken?: string;
  projectSlug?: string;
}

export async function postRunToCtrfHub(
  ctrf: unknown,
  opts?: CtrfHubOpts,
): Promise<void> {
  const ingestUrl = opts?.ingestUrl ?? process.env['CTRFHUB_INGEST_URL'];
  const apiToken = opts?.apiToken ?? process.env['CTRFHUB_API_TOKEN'];
  const projectSlug = opts?.projectSlug ?? process.env['CTRFHUB_PROJECT_SLUG'];

  if (!ingestUrl || !apiToken || !projectSlug) {
    console.error(
      '[CTRFHub] Missing required configuration. Set CTRFHUB_INGEST_URL, CTRFHUB_API_TOKEN, and CTRFHUB_PROJECT_SLUG.',
    );
    return;
  }

  const baseUrl = ingestUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/api/v1/projects/${projectSlug}/runs`;

  const report = ctrf as Record<string, unknown>;
  const results = report['results'] as Record<string, unknown> | undefined;
  const summary = results?.['summary'];
  const idempotencyKey = createHash('sha256')
    .update(JSON.stringify(summary))
    .digest('hex');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': apiToken,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(ctrf),
    });

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      console.error(
        `[CTRFHub] Run posted successfully — runId=${String(body['runId'] ?? 'unknown')} status=${response.status}`,
      );
    } else {
      const text = await response.text().catch(() => '');
      console.error(
        `[CTRFHub] Failed to post run: HTTP ${response.status} — ${text}`,
      );
    }
  } catch (err) {
    console.error(`[CTRFHub] Failed to post run: ${String(err)}`);
  }
}

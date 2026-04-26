/**
 * AI Pipeline Consent Gate — two-gate check before any AI cloud call.
 *
 * The AI pipeline must NOT send any data to a managed LLM provider until
 * both gates are satisfied:
 *
 * 1. **Deployment gate:** `AI_CLOUD_PIPELINE` env var equals `'on'`.
 *    Self-hosters in regulated environments set this at the infra layer
 *    and no org admin can override it.
 * 2. **Per-org gate:** `organizations.ai_cloud_ack_at IS NOT NULL` for
 *    the run's org — the org admin has acknowledged data sharing.
 *
 * If either gate fails, the pipeline skips silently — no error, no log entry.
 *
 * @see docs/planning/ai-features.md §Privacy and consent
 * @see skills/ai-pipeline-event-bus.md §Consent gate
 */

import type { EntityManager } from '@mikro-orm/core';
import { Organization } from '../../../entities/Organization.js';

/**
 * Check whether the AI cloud pipeline is consented for the given org.
 *
 * @param em - A forked EntityManager for the current operation.
 * @param orgId - Better Auth org ID (string PK on the `organization` table).
 * @returns `true` if both gates pass; `false` otherwise (skip silently).
 */
export async function isAiCloudPipelineConsented(
  em: EntityManager,
  orgId: string,
): Promise<boolean> {
  // Gate 1: deployment-level env var must be explicitly 'on'
  const envGate = process.env['AI_CLOUD_PIPELINE'];
  if (!envGate || envGate.toLowerCase() !== 'on') {
    return false;
  }

  // Gate 2: org admin must have acknowledged AI data sharing
  const org = await em.findOne(Organization, orgId);
  if (!org || org.aiCloudAckAt == null) {
    return false;
  }

  return true;
}

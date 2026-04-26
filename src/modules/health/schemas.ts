/**
 * Health endpoint Zod schemas — `/GET /health`.
 *
 * Zod-first: the response shape is defined here as a Zod schema and
 * TypeScript types are derived via `z.infer<>`. No hand-written
 * interfaces duplicate this shape.
 *
 * @see skills/zod-schema-first.md
 * @see docs/planning/architecture.md §Health endpoint
 */

import { z } from 'zod';

/**
 * The three-phase boot lifecycle of the API process.
 *
 * Transitions: `booting → migrating → ready`.
 * The `migrating` state is retained for backward compatibility but now
 * represents the schema-generator sync phase (`orm.schema.update()`)
 * rather than running migration files (INFRA-005 pivot).
 * If schema sync fails, the process exits non-zero (no `failed` state
 * is exposed via the health endpoint — the process simply isn't running).
 *
 * @see docs/planning/architecture.md §Health endpoint — status codes table
 */
export const BootStateSchema = z.enum(['booting', 'migrating', 'ready']);
export type BootState = z.infer<typeof BootStateSchema>;

/**
 * Response shape for `GET /health`.
 *
 * Kept minimal per the INFRA-002 brief: `{ status, bootState, dbReady }`.
 * Additional fields (`version`, `uptime`) deferred until a consumer needs them.
 */
export const HealthResponseSchema = z.object({
  /** Human-readable status: 'ok', 'booting', 'migrating', or 'error'. */
  status: z.enum(['ok', 'booting', 'migrating', 'error']),

  /** Current boot lifecycle phase. */
  bootState: BootStateSchema,

  /** True when the DB responds to `SELECT 1` (only checked in `ready` state). */
  dbReady: z.boolean(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Setup wizard Zod schemas — `GET /setup`, `POST /setup/step/{1..4}`.
 *
 * Zod-first: every step's request body is defined here as a Zod schema,
 * and TypeScript types are derived via `z.infer<>`. No hand-written
 * interfaces duplicate this shape.
 *
 * @see skills/zod-schema-first.md
 * @see skills/better-auth-session-and-api-tokens.md §Setup wizard
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Step 1 — Admin Account
// ---------------------------------------------------------------------------

export const SetupStep1Schema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  displayName: z.string().min(1).max(255),
});

export type SetupStep1 = z.infer<typeof SetupStep1Schema>;

// ---------------------------------------------------------------------------
// Step 2 — Organization
// ---------------------------------------------------------------------------

export const SetupStep2Schema = z.object({
  orgName: z.string().min(1).max(255),
  orgSlug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, digits, and hyphens only'),
});

export type SetupStep2 = z.infer<typeof SetupStep2Schema>;

// ---------------------------------------------------------------------------
// Step 3 — First Project
// ---------------------------------------------------------------------------

export const SetupStep3Schema = z.object({
  projectName: z.string().min(1).max(255),
  projectSlug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must use lowercase letters, digits, and hyphens only'),
  description: z.string().max(2000).default(''),
});

export type SetupStep3 = z.infer<typeof SetupStep3Schema>;

// ---------------------------------------------------------------------------
// Step 4 — CI/CD Setup (no body needed; completion is a simple POST)
// ---------------------------------------------------------------------------

export const SetupStep4Schema = z.object({});

// ---------------------------------------------------------------------------
// Env-var seed
// ---------------------------------------------------------------------------

export const EnvSeedSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  orgName: z.string().min(1).max(255),
  projectName: z.string().min(1).max(255).optional(),
  projectSlug: z.string().min(1).max(100).optional(),
});

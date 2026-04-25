/**
 * Auth module — schemas.
 *
 * The `/api/auth/*` catch-all route delegates its entire request/response
 * contract to Better Auth's HTTP handler. There are no CTRFHub-defined
 * request or response shapes for this module.
 *
 * This file exists to satisfy the module layout convention from
 * `fastify-route-convention.md §File layout per module` which requires a
 * `schemas.ts` alongside every `routes.ts`. If future auth-adjacent routes
 * (e.g. API-key management UI endpoints) are added, their Zod schemas go here.
 *
 * @see skills/zod-schema-first.md
 * @see skills/fastify-route-convention.md §File layout per module
 */

// No schemas defined for the auth catch-all route — Better Auth owns its
// request/response contract. Future auth-related endpoints add schemas here.

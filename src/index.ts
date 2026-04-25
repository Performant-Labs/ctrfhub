/**
 * CTRFHub — Application entry point.
 *
 * Bootstraps the Fastify server by calling the `buildApp()` factory,
 * then listens on `PORT` (env var, default 3000).
 *
 * Process signal handlers (SIGTERM/SIGINT) are registered inside
 * `buildApp()` for graceful shutdown — see `src/app.ts §11`.
 *
 * @see src/app.ts — buildApp() factory
 * @see docs/planning/architecture.md §Graceful Shutdown
 */

import { buildApp } from './app.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`CTRFHub listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error during startup:', err);
  process.exit(1);
});

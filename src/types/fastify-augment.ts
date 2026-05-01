/**
 * FastifyInstance module augmentation — declares the custom decorations
 * added by {@link buildApp} at app-creation time.
 *
 * These decorations are real at runtime but invisible to the base
 * {@link FastifyInstance} type from the {@link fastify} package. This
 * augmentation file makes them visible to TypeScript and ESLint so that
 * test code (and any downstream consumer) can access them without
 * {@code as any} casts.
 *
 * Import this file from any test or module that needs the augmented type:
 * {@code import '../../types/fastify-augment.js';}
 *
 * @see src/app.ts — where the decorations are attached via app.decorate()
 * @see skills/fastify-route-convention.md
 */

import type { MikroORM } from '@mikro-orm/core';
import type { BootState } from '../modules/health/schemas.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Returns the current boot lifecycle phase.
     * Transitions: {@code booting} → {@code migrating} → {@code ready}.
     */
    getBootState(): BootState;

    /**
     * Sets the current boot lifecycle phase.
     * Only used in test code to simulate readiness states.
     */
    setBootState(state: BootState): void;

    /**
     * The MikroORM instance created during app bootstrap.
     * Exposed for shutdown (close) and for direct ORM access in tests.
     * @see skills/mikroorm-dual-dialect.md
     */
    orm: MikroORM;
  }
}

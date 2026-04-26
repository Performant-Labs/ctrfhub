/**
 * CTRFHub — Core DI Seam Interfaces and App Options.
 *
 * These interfaces define the dependency-injection boundaries used by
 * `buildApp()` in `src/app.ts`. Each interface is intentionally minimal —
 * INFRA-004 ships concrete implementations and test doubles. The only
 * contract enforced here is `close()` for graceful shutdown.
 *
 * @see skills/vitest-three-layer-testing.md §Integration Test Bootstrap
 * @see docs/planning/architecture.md §Graceful Shutdown
 */

/**
 * Artifact storage abstraction (local FS or S3/MinIO).
 *
 * The real implementations (`LocalArtifactStorage`, `S3ArtifactStorage`)
 * and the test double (`MemoryArtifactStorage`) ship in INFRA-004 / CTRF-003.
 */
export interface ArtifactStorage {
  /** Release any held resources (file handles, S3 client connections). */
  close(): Promise<void>;
}

/**
 * Event bus abstraction for inter-service communication.
 *
 * The canonical interface and `MemoryEventBus` implementation live in
 * `src/services/event-bus.ts`. Imported and re-exported here so existing
 * imports from `./types.js` continue to work.
 *
 * @see src/services/event-bus.ts
 */
import type { EventBus } from './services/event-bus.js';
export type { EventBus };

/**
 * AI provider abstraction for failure categorization and summarization.
 *
 * The canonical interface and payload types live in `src/services/ai/types.ts`.
 * Re-exported here so downstream code has one canonical import path.
 *
 * @see src/services/ai/types.ts
 */
import type { AiProvider } from './services/ai/types.js';
export type { AiProvider };

/**
 * Options for the `buildApp()` factory.
 *
 * The four optional fields (`db`, `artifactStorage`, `eventBus`, `aiProvider`)
 * are the DI seams that allow integration tests to inject test doubles without
 * mocking — per `vitest-three-layer-testing.md §Integration Test Bootstrap`.
 *
 * @example
 * ```typescript
 * // Integration test bootstrap — in-memory SQLite, no external services
 * const app = await buildApp({ testing: true, db: ':memory:' });
 * ```
 */
export interface AppOptions {
  /**
   * When true, suppresses startup logging and disables process-level
   * signal handlers (tests manage their own lifecycle).
   */
  testing?: boolean;

  /**
   * Database connection override.
   * - `':memory:'` — in-memory SQLite for integration tests
   * - `/path/to/file.db` — file-based SQLite
   * - `undefined` — resolve from `DATABASE_URL` / `SQLITE_PATH` env vars
   */
  db?: string;

  /** Injected artifact storage implementation. Falls back to local FS if unset. */
  artifactStorage?: ArtifactStorage;

  /** Injected event bus implementation. Falls back to in-process bus if unset. */
  eventBus?: EventBus;

  /** Injected AI provider implementation. Falls back to no-op if unset. */
  aiProvider?: AiProvider;
}

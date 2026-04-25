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
 * Used by the AI pipeline (A1–A3 stages subscribe to `run.ingested`,
 * `run.ai_categorized`, `run.ai_correlated`) and SSE push notifications.
 * The real implementation and `MemoryEventBus` double ship in INFRA-004.
 */
export interface EventBus {
  /** Drain pending events and release connections. */
  close(): Promise<void>;
}

/**
 * AI provider abstraction for failure categorization and summarization.
 *
 * Implementations: `OpenAiProvider`, `AnthropicProvider`, `GroqProvider`
 * (selected by `AI_PROVIDER` env). Test double: `MockAiProvider`.
 * All ship in AI-001.
 */
export interface AiProvider {
  /** Release any held resources (HTTP clients, etc.). */
  close(): Promise<void>;
}

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

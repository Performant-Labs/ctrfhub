import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/migrations/**', 'src/entities/**', 'src/services/ai/providers/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
    // Integration tests can be slower — give them room
    testTimeout: 15_000,
    // Run unit tests first (they're faster)
    sequence: { shuffle: false },
  },
});

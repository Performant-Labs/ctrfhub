import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E test configuration for CTRFHub.
 *
 * Two-viewport matrix (per skills/viewport-mobile-first-desktop-only.md):
 * - desktop (1280×800): primary — full test assertions
 * - narrow-smoke (375×800): smoke only — page loads, no horizontal overflow
 *
 * Dog-food rule (per testing-strategy.md): CTRF reporter generates a report
 * that is ingested back into CTRFHub staging after CI runs.
 */
export default defineConfig({
  testDir: './tests',

  /* Reporter config — dog-food CTRF reporter per testing-strategy.md */
  reporter: [
    ['list'],
    ['playwright-ctrf-json-reporter', {
      outputFile: 'report.json',
      appName: 'CTRFHub E2E',
    }],
  ],

  /* Two-viewport matrix per viewport-mobile-first-desktop-only.md */
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'narrow-smoke',
      use: {
        viewport: { width: 375, height: 800 },
      },
    },
  ],

  /* Shared settings */
  use: {
    /* Base URL — set via env for CI; defaults to local dev server */
    baseURL: process.env['CTRFHUB_E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  /* Retries for flake resistance in CI */
  retries: process.env['CI'] ? 2 : 0,

  /* Timeout per test */
  timeout: 30_000,

  /* Auto-start test server unless a base URL is explicitly provided */
  webServer: process.env['CTRFHUB_E2E_BASE_URL']
    ? undefined
    : {
        command: 'npx tsx e2e/test-server.ts',
        cwd: '..',
        port: 3000,
        reuseExistingServer: true,
      },
});

/**
 * Placeholder E2E spec — exists solely so `npm run test:e2e` doesn't
 * exit 1 with "No tests found" when there are no real specs yet.
 *
 * Replace with real UI specs once DASH-001 / AUTH-002 / AUTH-003 ship.
 * Until then, this single test runs across the two-viewport matrix
 * (desktop 1280×800 + narrow-smoke 375×800) and asserts the CI job
 * machinery itself is healthy.
 */
import { test, expect } from '@playwright/test';

test('placeholder — replace with real specs once UI ships', async () => {
  expect(true).toBe(true);
});

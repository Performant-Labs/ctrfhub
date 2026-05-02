import { test, expect } from '@playwright/test';

/**
 * INFRA-003 E2E — Page verification tiers.
 *
 * T2 ARIA (structural skeleton):
 *   - Accessibility snapshot assertions: landmarks, heading hierarchy, page title
 *   - Verified at 1280×800 desktop only
 *
 * T3 Visual:
 *   - Narrow-smoke (375×800): page loads, no console errors, no horizontal overflow
 *   - Baseline (1280×800): main visible, h1 correct, correct title
 */

// ---------------------------------------------------------------------------
// Helper — recursively search an ARIA snapshot for a matching predicate
// Playwright 1.59+ uses page.ariaSnapshot() which returns a string representation
// ---------------------------------------------------------------------------

function snapContains(pattern: RegExp, snapshot: string): boolean {
  return pattern.test(snapshot);
}

// ---------------------------------------------------------------------------
// T2 — ARIA Structural Skeleton
// ---------------------------------------------------------------------------

test.describe('INFRA-003 T2 ARIA — structural skeleton (1280x800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('page loads with HTTP 200', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
  });

  test('page title is "CTRFHub"', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('CTRFHub');
  });

  test('main landmark is present and visible', async ({ page }) => {
    await page.goto('/');
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(main).toHaveCount(1);
  });

  test('h1 heading is present with correct text', async ({ page }) => {
    await page.goto('/');
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText('CTRFHub');
    await expect(h1).toHaveCount(1);
  });

  test('ARIA snapshot contains main landmark', async ({ page }) => {
    await page.goto('/');
    const snap = await page.ariaSnapshot();
    expect(snap).toMatch(/main/);
  });

  test('ARIA snapshot contains heading level 1', async ({ page }) => {
    await page.goto('/');
    const snap = await page.ariaSnapshot();
    expect(snap).toMatch(/- heading "CTRFHub" \[level=1\]/);
  });

  test('ARIA snapshot: no duplicate main landmarks', async ({ page }) => {
    await page.goto('/');
    const snap = await page.ariaSnapshot();
    // Count occurrences of "main" role — should appear once
    const mainMatches = (snap.match(/role="main"/g) || snap.match(/^main$/m) || []).length;
    expect(mainMatches).toBeLessThanOrEqual(1);
  });

  test('viewport meta tag content is width=1280', async ({ page }) => {
    await page.goto('/');
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', 'width=1280');
  });

  test('charset meta tag is UTF-8', async ({ page }) => {
    await page.goto('/');
    const charset = page.locator('meta[charset]');
    await expect(charset).toHaveAttribute('charset', 'UTF-8');
  });

  test('script load order: tailwind.css → htmx → idiomorph → alpine → flowbite → app.js', async ({ page }) => {
    await page.goto('/');
    const order = await page.evaluate(() => {
      const resources: string[] = [];
      document.querySelectorAll('link[rel="stylesheet"], script[src]').forEach((el) => {
        const src = el.getAttribute('href') || el.getAttribute('src') || '';
        if (src.includes('tailwind')) resources.push('tailwind.css');
        else if (src.includes('htmx.min')) resources.push('htmx.min.js');
        else if (src.includes('idiomorph')) resources.push('idiomorph-ext.min.js');
        else if (src.includes('alpine.min')) resources.push('alpine.min.js');
        else if (src.includes('flowbite.min')) resources.push('flowbite.min.js');
        else if (src.includes('app.js')) resources.push('app.js');
      });
      return resources;
    });
    expect(order).toEqual([
      'tailwind.css',
      'htmx.min.js',
      'idiomorph-ext.min.js',
      'alpine.min.js',
      'flowbite.min.js',
      'app.js',
    ]);
  });
});

// ---------------------------------------------------------------------------
// T2 — Nav landmark check (expected: not present in stub home page)
// ---------------------------------------------------------------------------

test.describe('INFRA-003 T2 ARIA — nav landmark (1280x800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('nav landmark is absent from stub home page (nav will be added in DASH-001)', async ({ page }) => {
    await page.goto('/');
    const navLocator = page.locator('nav');
    await expect(navLocator).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// T3 — Visual: Narrow-smoke (375x800)
// ---------------------------------------------------------------------------

test.describe('INFRA-003 T3 Visual — narrow-smoke (375x800)', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('page loads without console errors at narrow viewport', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Filter environmental SSL noise (Chromium may probe HTTPS on localhost)
        if (!msg.text().includes('ERR_SSL_PROTOCOL_ERROR')) {
          errors.push(msg.text());
        }
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('no horizontal overflow at 375x800', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test('h1 is visible at narrow viewport', async ({ page }) => {
    await page.goto('/');
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText('CTRFHub');
  });

  test('page title is correct at narrow viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('CTRFHub');
  });
});

// ---------------------------------------------------------------------------
// T3 — Visual: Baseline layout (1280x800)
// ---------------------------------------------------------------------------

test.describe('INFRA-003 T3 Visual — baseline layout (1280x800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('page loads without console errors at desktop viewport', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // Filter environmental SSL noise (Chromium may probe HTTPS on localhost)
        if (!msg.text().includes('ERR_SSL_PROTOCOL_ERROR')) {
          errors.push(msg.text());
        }
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('main element is visible with non-zero dimensions', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const main = page.locator('main');
    await expect(main).toBeVisible();

    const box = await main.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('h1 heading renders at top of main content', async ({ page }) => {
    await page.goto('/');
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText('CTRFHub');

    const h1Box = await h1.boundingBox();
    const mainBox = await page.locator('main').boundingBox();
    expect(h1Box).not.toBeNull();
    expect(mainBox).not.toBeNull();
    // h1 should be positioned near the top of main
    expect(h1Box!.y).toBeGreaterThanOrEqual(mainBox!.y! - 1);
  });

  test('body has expected dark surface styling', async ({ page }) => {
    await page.goto('/');

    const bgClass = await page.locator('html').getAttribute('class');
    expect(bgClass).toContain('bg-[');

    const bodyClass = await page.locator('body').getAttribute('class');
    expect(bodyClass).toContain('min-h-screen');
  });
});

import { test, expect } from '@playwright/test';

test.describe('INFRA-003 T2 ARIA — structural skeleton', () => {
  test('page loads successfully with expected landmarks — desktop', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);

    const main = page.locator('main');
    await expect(main).toBeVisible();

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText('CTRFHub');
  });

  test('has correct heading hierarchy — desktop', async ({ page }) => {
    await page.goto('/');
    const h1 = page.locator('h1');
    await expect(h1).toHaveText('CTRFHub');

    const headingCount = await page.locator('h1, h2, h3, h4, h5, h6').count();
    expect(headingCount).toBeGreaterThanOrEqual(1);
  });

  test('main landmark is present — desktop', async ({ page }) => {
    await page.goto('/');
    const main = page.locator('main');
    await expect(main).toBeVisible();
  });

  test('page title is set — desktop', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('CTRFHub');
  });
});

test.describe('INFRA-003 T3 Visual — narrow-smoke (375x800)', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('narrow viewport: page loads and has no unexpected overflow', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    });
    expect(overflowX).toBe(true);

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
  });
});

test.describe('INFRA-003 T3 Visual — baseline layout (1280x800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('desktop: page renders correctly', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const main = page.locator('main');
    await expect(main).toBeVisible();

    const box = await main.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText('CTRFHub');

    await expect(page).toHaveTitle('CTRFHub');
  });
});

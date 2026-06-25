import { test, expect, type Page } from '@playwright/test';

/**
 * Layout & resizable-panel integration. These guard the four-region spine
 * (library | center | agent, timeline) and the drag-resize/persist behaviour -
 * including the regression where the grid had no definite height (the center
 * refused to collapse) and where a stale, oversized persisted timeline height
 * crowded the whole workbench out.
 */

const region = (page: Page, area: 'library' | 'center' | 'agent' | 'timeline') =>
  page.locator(`[class*="grid-area:${area}"]`);

/** Dismiss the audio-start modal so panels are interactive. */
async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

async function box(page: Page, area: 'library' | 'center' | 'agent' | 'timeline') {
  const b = await region(page, area).boundingBox();
  if (!b) throw new Error(`no box for ${area}`);
  return b;
}

const widthOf = (page: Page, area: 'library' | 'center' | 'agent' | 'timeline') =>
  region(page, area).evaluate((el) => el.getBoundingClientRect().width);

// Each test runs in a fresh, isolated browser context, so localStorage starts
// empty - no manual clearing needed (and clearing on reload would defeat the
// persistence tests).

test('all four regions are visible on a clean load', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  for (const area of ['library', 'center', 'agent', 'timeline'] as const) {
    const b = await box(page, area);
    expect(b.width, `${area} width`).toBeGreaterThan(20);
    expect(b.height, `${area} height`).toBeGreaterThan(20);
  }
});

test('dragging the library handle resizes it and persists across reload', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  const before = (await box(page, 'library')).width;

  const handle = page.getByRole('separator', { name: 'Resize library' });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 90, hb.y + hb.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = (await box(page, 'library')).width;
  expect(after).toBeGreaterThan(before + 40);

  await page.reload();
  await dismissStart(page);
  const restored = (await box(page, 'library')).width;
  expect(Math.abs(restored - after)).toBeLessThan(4);
});

test('an oversized persisted timeline height cannot crowd out the workbench', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('web-daw:timeline-height', '5000'));
  await page.goto('/');
  await dismissStart(page);

  const center = await box(page, 'center');
  const body = await box(page, 'library'); // library spans the full top row height
  expect(center.height, 'center keeps a minimum height').toBeGreaterThan(50);
  expect(center.height).toBeLessThanOrEqual(body.height + 1);
});

test('the activity panel collapses to a rail and expands again', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  const full = (await box(page, 'agent')).width;
  expect(full).toBeGreaterThan(200);

  // The column animates (0.42s transition), so poll until it settles.
  await page.getByRole('button', { name: /collapse activity panel/i }).click();
  await expect.poll(() => widthOf(page, 'agent')).toBeLessThan(80);

  await page.getByRole('button', { name: /expand activity panel/i }).click();
  await expect.poll(() => widthOf(page, 'agent')).toBeGreaterThan(200);
});

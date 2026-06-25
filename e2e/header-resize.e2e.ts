import { test, expect, type Page } from '@playwright/test';

/**
 * The arrangement's left header column (track/group headers) is drag-resizable via
 * the divider between the headers and the lanes, and the width persists.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

const handle = (page: Page) => page.getByTitle('Drag to resize the header column');

test('the header column can be dragged wider and persists', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const before = (await handle(page).boundingBox())!;
  const y = before.y + 60;
  await page.mouse.move(before.x + before.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 90, y, { steps: 8 });
  await page.mouse.up();

  const after = (await handle(page).boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 50); // header got wider

  await page.reload();
  await dismissStart(page);
  const reloaded = (await handle(page).boundingBox())!;
  expect(Math.abs(reloaded.x - after.x)).toBeLessThan(10); // width persisted
});

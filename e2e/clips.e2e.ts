import { test, expect, type Page } from '@playwright/test';

/**
 * Clip pool rail: the default project seeds one instrument track (selected), so its
 * clip rail is visible on load. Guards adding a clip ("+ Clip"), that it appears as
 * a chip, and that the pool persists across reload (it lives in the project snapshot).
 */

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

/** The clip rail = the container holding the "+ Clip" button. */
const rail = (page: Page) => page.getByRole('button', { name: '+ Clip' }).locator('..');

test('adding a clip adds a chip and persists across reload', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const addClip = page.getByRole('button', { name: '+ Clip' });
  await expect(addClip).toBeVisible();
  await expect(rail(page).getByText('A', { exact: true })).toBeVisible();

  await addClip.click();
  await expect(rail(page).getByText('B', { exact: true })).toBeVisible();

  await page.waitForTimeout(400); // let the debounced project autosave flush
  await page.reload();
  await dismissStart(page);
  await expect(rail(page).getByText('B', { exact: true })).toBeVisible();
});

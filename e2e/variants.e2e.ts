import { test, expect, type Page } from '@playwright/test';

/**
 * Clip-variant workbench strip: the default project seeds one instrument track
 * (selected), so its variant strip is visible on load. Guards forking ("Try"),
 * switching, and that the stack persists across reload (it lives in the project
 * snapshot, same as everything else).
 */

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) await start.click();
}

/** The variant strip = the container holding the "+ Try" button. */
const strip = (page: Page) => page.getByRole('button', { name: '+ Try' }).locator('..');

test('forking a variant adds a chip, switches to it, and persists across reload', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const tryBtn = page.getByRole('button', { name: '+ Try' });
  await expect(tryBtn).toBeVisible();
  await expect(strip(page).getByText('A', { exact: true })).toBeVisible();

  await tryBtn.click();
  await expect(strip(page).getByText('B', { exact: true })).toBeVisible();

  await page.waitForTimeout(400); // let the debounced project autosave flush
  await page.reload();
  await dismissStart(page);
  await expect(strip(page).getByText('B', { exact: true })).toBeVisible();
});

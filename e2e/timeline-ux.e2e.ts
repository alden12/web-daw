import { test, expect, type Page } from '@playwright/test';

/**
 * Small UX affordances: Space toggles the transport from anywhere (outside text
 * fields), and the effect chain's "+" button opens a catalog menu to add an
 * effect. Both ride the same model/dispatch as the rest of the app.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) await start.click();
}

test('space toggles play/stop', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const play = page.getByRole('button', { name: /Play/ });
  await expect(play).toBeEnabled(); // audio started -> transport is usable
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Stop/ })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Play/ })).toBeVisible();
});

test('add an effect from the "+" catalog menu', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  // The seed track starts with no effects.
  await expect(page.getByTitle('Remove effect')).toHaveCount(0);

  await page.getByTitle('Add an effect').click();
  await page.getByRole('menuitem').first().click();

  await expect(page.getByTitle('Remove effect')).toHaveCount(1); // one effect added
});

import { test, expect, type Page } from '@playwright/test';

/**
 * Kebab (⋮) context menus: the arrangement toolbar's add menu creates an empty
 * track or a group, and each track/group row's ⋮ deletes it. These replace the
 * old "+ Group" and × buttons.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) await start.click();
}

test('add an empty track and delete a track via the kebab menus', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const trackMenus = page.getByRole('button', { name: 'Track actions' });
  const before = await trackMenus.count();

  // Toolbar add menu -> Add empty track.
  await page.getByRole('button', { name: 'Add a track or group' }).click();
  await page.getByRole('menuitem', { name: 'Add empty track' }).click();
  await expect(trackMenus).toHaveCount(before + 1);

  // A track row's ⋮ -> Delete track.
  await trackMenus.first().click();
  await page.getByRole('menuitem', { name: 'Delete track' }).click();
  await expect(trackMenus).toHaveCount(before);
});

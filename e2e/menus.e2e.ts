import { test, expect, type Page } from '@playwright/test';

/**
 * Kebab (⋮) context menus: the arrangement toolbar's add menu creates a group or a
 * track in a chosen group, the group row's ⋮ adds a track into that group, and each
 * track/group row's ⋮ deletes it. These replace the old "+ Group" and × buttons.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) await start.click();
}

test('add a track via the toolbar group picker and delete it via the row menu', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const trackMenus = page.getByRole('button', { name: 'Track actions' });
  const before = await trackMenus.count();

  // Toolbar add menu -> New track in a new group (always available, no existing group needed).
  await page.getByRole('button', { name: 'Add a track or group' }).click();
  await page.getByRole('menuitem', { name: 'New track in a new group' }).click();
  await expect(trackMenus).toHaveCount(before + 1);

  // A track row's ⋮ -> Delete track.
  await trackMenus.first().click();
  await page.getByRole('menuitem', { name: 'Delete track' }).click();
  await expect(trackMenus).toHaveCount(before);
});

test('a group row menu adds an empty track into that group', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const trackMenus = page.getByRole('button', { name: 'Track actions' });
  const before = await trackMenus.count();

  await page.getByRole('button', { name: 'Group actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Add empty track' }).click();
  await expect(trackMenus).toHaveCount(before + 1);
});

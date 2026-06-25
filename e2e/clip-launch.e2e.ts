import { test, expect, type Page } from '@playwright/test';

/**
 * Clip launching (mode-less Session): launching a clip from the rail makes it loop
 * over the transport, overriding the track's timeline. A "Clip mode / Back to
 * timeline" indicator appears in the arrangement header, the lane greys with a
 * badge, and the launched state is saved (part of the composition) so it survives
 * a reload. "Back to timeline" stops every launched clip.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

const launchBtn = (page: Page) => page.getByTitle(/Launch clip/).first();
const backToTimeline = (page: Page) => page.getByRole('button', { name: /Back to timeline/ });

test('launch a clip from the rail; clip-mode indicator; back to timeline', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  // No clip launched yet -> no clip-mode indicator.
  await expect(backToTimeline(page)).toHaveCount(0);

  await launchBtn(page).click();
  await expect(backToTimeline(page)).toBeVisible(); // entered clip mode
  await expect(page.getByText('Launched clip')).toBeVisible(); // feed entry
  await expect(page.getByTestId('lane').first().getByText('▶ A')).toBeVisible(); // lane badge

  await backToTimeline(page).click();
  await expect(backToTimeline(page)).toHaveCount(0); // back to the arrangement
});

test('a launched clip is saved and survives a reload', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  await launchBtn(page).click();
  await expect(backToTimeline(page)).toBeVisible();

  await page.waitForTimeout(400); // let the debounced autosave flush
  await page.reload();
  await dismissStart(page);

  await expect(backToTimeline(page)).toBeVisible(); // launched state restored
});

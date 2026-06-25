import { test, expect, type Page } from '@playwright/test';

/**
 * Recording controls wiring (UI only - does NOT click Record, so no microphone is
 * touched): the transport shows a Record button, and the count-in (in the toolbar's
 * Timeline options menu) persists across a reload. The live capture path
 * (getUserMedia + worklet + WAV + addAudioTrack) is verified manually.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function startAudio(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

async function openCountIn(page: Page) {
  await page.getByRole('button', { name: 'Timeline options' }).click();
  await page.getByRole('menuitem', { name: 'Count-in' }).hover();
}

test('the transport exposes a Record button and persists the count-in choice', async ({ page }) => {
  await page.goto('/');
  await startAudio(page);

  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();

  // Default is 1 bar; switch to 2 bars via the settings menu's Count-in submenu.
  await openCountIn(page);
  await expect(page.getByRole('menuitemradio', { name: '1 bar' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: '2 bars' }).click();

  await page.reload();
  await startAudio(page);
  await openCountIn(page);
  await expect(page.getByRole('menuitemradio', { name: '2 bars' })).toHaveAttribute('aria-checked', 'true');
});

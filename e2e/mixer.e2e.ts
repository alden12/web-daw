import { test, expect, type Page } from '@playwright/test';

/**
 * Mixer header controls: an adjoined Mute/Solo button group on tracks and groups,
 * and a low-profile fader. Here we exercise the mute/solo toggles on a track.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

test('mute and solo toggle on a track', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const scroll = page.getByTestId('arr-scroll');

  // Solo the track, then un-solo it.
  await scroll.getByTitle('Solo', { exact: true }).first().click();
  await expect(scroll.getByTitle('Unsolo').first()).toBeVisible();
  await scroll.getByTitle('Unsolo').first().click();

  // Mute the track.
  await scroll.getByTitle('Mute', { exact: true }).first().click();
  await expect(scroll.getByTitle('Unmute').first()).toBeVisible();

  // The fader is present as a slider.
  await expect(scroll.getByRole('slider', { name: 'Volume' }).first()).toBeVisible();
});

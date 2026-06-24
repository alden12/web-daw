import { test, expect, type Page } from '@playwright/test';

/**
 * Recording controls wiring (UI only - does NOT click Record, so no microphone is
 * touched): the transport shows a Record button and a count-in selector, and the
 * count-in preference persists across a reload. The live capture path (getUserMedia
 * + worklet + WAV + addAudioTrack) is verified manually.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function startAudio(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) await start.click();
}

test('the transport exposes recording controls and persists the count-in', async ({ page }) => {
  await page.goto('/');
  await startAudio(page);

  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();

  const countIn = page.locator('select[title="Count-in before recording"]');
  await expect(countIn).toHaveValue('1'); // default: 1 bar
  await countIn.selectOption('2');

  await page.reload();
  await startAudio(page);
  await expect(page.locator('select[title="Count-in before recording"]')).toHaveValue('2');
});

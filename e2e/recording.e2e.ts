import { test, expect, type Page } from "@playwright/test";
import { openTimingSettings } from "./support/app";

/**
 * Recording controls wiring (UI only - does NOT click Record, so no microphone is
 * touched): the transport shows a Record button, and the count-in (on the settings panel's
 * Timing page) persists across a reload. The live capture path
 * (getUserMedia + worklet + WAV + addAudioTrack) is verified manually.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function startAudio(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

test("the transport exposes a Record button and persists the count-in choice", async ({ page }) => {
  await page.goto("/");
  await startAudio(page);

  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();

  // Default is 1 bar; switch to 2 bars on the Timing page.
  await openTimingSettings(page);
  await expect(page.getByRole("radio", { name: "1 bar" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "2 bars" }).click();

  await page.reload();
  await startAudio(page);
  await openTimingSettings(page);
  await expect(page.getByRole("radio", { name: "2 bars" })).toHaveAttribute("aria-checked", "true");
});

import { test, expect, type Page } from "@playwright/test";

/**
 * Clip copy/paste in the clip rail (like the timeline's placement copy/paste):
 * focus the rail, Cmd/Ctrl-C the active clip, Cmd/Ctrl-V to add a copy to the
 * track's pool. Routing is by DOM focus, so the timeline's copy/paste does not
 * interfere when the rail has focus.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

const chips = (page: Page) => page.getByTitle(/drag onto the lane/);

test("copy and paste a clip in the rail adds a clip to the pool", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await expect(chips(page)).toHaveCount(1); // the seed clip A
  await chips(page).first().click(); // select + focus the rail
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");

  await expect(chips(page)).toHaveCount(2);
  await expect(page.getByText(/Pasted clip/)).toBeVisible(); // two-voice feed entry
});

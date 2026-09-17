import { test, expect, type Page } from "@playwright/test";

/**
 * MIDI recording into an instrument track. Unlike audio recording (which needs the
 * microphone and is verified manually), capturing live MIDI touches no media
 * devices, so the whole take can run in CI: arm the selected instrument track,
 * record with no count-in, play notes on the computer keyboard, stop, and confirm a
 * recorded clip lands on the track. The default seed track is a subtractive synth.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function startAudio(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

async function setNoCountIn(page: Page) {
  await page.getByRole("button", { name: "Timeline options" }).click();
  await page.getByRole("menuitem", { name: "Count-in" }).hover();
  await page.getByRole("menuitemradio", { name: "No count-in" }).click();
  await page.keyboard.press("Escape"); // close the menu
}

test("records live MIDI into the selected instrument track", async ({ page }) => {
  await page.goto("/");
  await startAudio(page);
  await setNoCountIn(page);
  await page.getByRole("button", { name: "Activity", exact: true }).click(); // feed shows the recorded take

  const record = page.getByRole("button", { name: "Record", exact: true });
  await record.click();
  await expect(record).toHaveAttribute("aria-pressed", "true"); // capture has begun

  // Play a couple of notes on the computer keyboard (a = C4, s = D4). While a note
  // is held, a live ghost note appears in the roll; on release it stays as captured.
  await page.keyboard.down("a");
  await expect(page.getByTestId("ghost-note").first()).toBeVisible();
  await page.waitForTimeout(120);
  await page.keyboard.up("a");
  await page.keyboard.down("s");
  await page.waitForTimeout(120);
  await page.keyboard.up("s");
  await expect(page.getByTestId("ghost-note")).toHaveCount(2); // both notes captured

  await record.click(); // stop -> finalize the take
  await expect(record).toHaveAttribute("aria-pressed", "false");

  // The take becomes a recorded clip: the activity feed reports it with its note
  // count, and the clip lands on the track's arrangement lane.
  await expect(page.getByText('Recorded "Take 1" (2 notes)')).toBeVisible();
  await expect(page.getByTestId("lane").getByText("Take 1")).toBeVisible();
});

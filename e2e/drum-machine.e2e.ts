import { test, expect, type Page } from "@playwright/test";

/**
 * The drum machine: a Drum Kit track can be edited either as a pad x step grid ("Pads")
 * or as the drum-labelled piano roll ("Keys", the default). Both write into the same
 * note-clip model, so patterns are just notes. Rows are the kit's loaded pads (the
 * built-in CC0 kit by default).
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

test("a Drum Kit track shows the step grid; toggling a cell writes a note", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Instruments is the default view; applying Drum Kit to the (selected) seed track
  // loads the built-in pads. Switch the editor to Pads to get the step grid.
  await page.getByRole("button", { name: "Drum Kit", exact: true }).click();
  await expect(page.getByRole("tablist").getByText("drumkit", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pads", exact: true }).click();

  // A pad row for the built-in Kick, with its step cells.
  const kickStep1 = page.getByRole("button", { name: "Kick step 1", exact: true });
  await expect(kickStep1).toBeVisible();
  await expect(kickStep1).toHaveAttribute("aria-pressed", "false");

  // Toggling the cell places a hit (a note); toggling again clears it.
  await kickStep1.click();
  await expect(kickStep1).toHaveAttribute("aria-pressed", "true");
  await kickStep1.click();
  await expect(kickStep1).toHaveAttribute("aria-pressed", "false");
});

test("a Drum Kit track can switch to the piano roll (Keys), editing the same clip", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await page.getByRole("button", { name: "Drum Kit", exact: true }).click();

  // Place a kick hit in the step grid (writes a note into the clip).
  await page.getByRole("button", { name: "Pads", exact: true }).click();
  await page.getByRole("button", { name: "Kick step 1", exact: true }).click();

  // Switch the editor to Keys: the step grid is replaced by the piano roll, and the
  // hit we placed shows up as a note there (same clip, different surface).
  await page.getByRole("button", { name: "Keys", exact: true }).click();
  const grid = page.getByTestId("piano-grid");
  await expect(grid).toBeVisible();
  await expect(page.getByTestId("note")).toHaveCount(1);
  // The reserved left gutter (a column beside the notes, not over them) labels the row
  // with its assigned note + drum name ("C2 Kick" - the GM kick note 36), so you can see
  // and play the mapping.
  await expect(page.getByText("C2 Kick", { exact: true })).toBeVisible();

  // Back to Pads: the step grid returns with the hit still lit.
  await page.getByRole("button", { name: "Pads", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kick step 1", exact: true })).toHaveAttribute("aria-pressed", "true");
});

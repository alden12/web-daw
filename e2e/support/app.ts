/**
 * Shared e2e helpers for getting the app into a usable state.
 *
 * One copy, deliberately. `dismissStart` lived in all 27 spec files, which is why the race below
 * survived six separate sightings: each one looked like a different test being flaky rather than
 * one helper being wrong (ARCH-5).
 */
import { expect, type Page } from "@playwright/test";

/**
 * Clear the "Start the audio engine" overlay, which every spec has to do before it can touch
 * anything.
 *
 * **Waits for the dialog rather than sampling for it**, and that is the whole point. This used to
 * read `if (await start.count()) { ... }`, and `count()` is a point-in-time sample: `AppShell`
 * renders `{!started && <StartDialog/>}` from mount until it is clicked, so a count of zero means
 * the page has not mounted yet far more often than it means the engine is already running. Under
 * parallel load the guard saw zero, skipped the click, and the overlay then appeared over a test
 * that believed it had gone - intercepting every click until the test timed out 30 seconds later.
 *
 * Every call site runs straight after a `goto` or a `reload`, so the dialog is always freshly
 * mounted and waiting for it is safe. If a future flow starts the engine without it, this fails
 * with "waiting for start audio button" rather than silently skipping, which is the better way
 * round: that is a change worth noticing.
 */
export async function dismissStart(page: Page): Promise<void> {
  const start = page.getByRole("button", { name: /start audio/i });
  await start.waitFor({ state: "visible" });
  await start.click();
  // engine.start() awaits the worklet modules, so the overlay clears (and the layout settles) a
  // beat after the click - interacting before that races the re-layout.
  await expect(start).toHaveCount(0);
}

/**
 * Open the settings panel on its Timing page (tempo, meter, metronome, count-in, groove - MOBILE-19),
 * from the account button on either shell. The panel reopens on the page it was closed on, so on a
 * phone the category list is only there to tap on the first opening.
 */
export async function openTimingSettings(page: Page): Promise<void> {
  await openSettingsPage(page, "Timing");
  // Scoped to the panel: the desktop transport has a tempo field of its own.
  await expect(page.getByRole("dialog").getByRole("spinbutton", { name: "Tempo", exact: true })).toBeVisible();
}

/**
 * Open the settings panel on one of its pages, from the account button on either shell, or switch
 * page if it is already open.
 */
export async function openSettingsPage(page: Page, name: string): Promise<void> {
  const close = page.getByRole("button", { name: "Close settings" });
  if (!(await close.isVisible())) await page.getByRole("button", { name: "Account and settings" }).click();
  const tab = page.getByRole("tab", { name, exact: true });
  // Reopening lands on the page it was closed on, where a phone hides the list.
  if (await tab.isVisible()) await tab.click();
  else
    await page
      .getByRole("button", { name: "All settings" })
      .click()
      .then(() => tab.click());
  await expect(page.getByRole("tabpanel", { name })).toBeVisible();
}

/** Set the count-in from the Timing page and close the panel again. */
export async function setCountIn(page: Page, choice: "None" | "1 bar" | "2 bars"): Promise<void> {
  await openTimingSettings(page);
  await page.getByRole("radio", { name: choice }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
}

/**
 * Open an Explore category page (COMM-1.9.1) from wherever Explore is: home, or another category.
 * Explore must already be on screen (the desktop library's default view, or the phone's tab).
 */
export async function openExploreCategory(page: Page, label: string): Promise<void> {
  const back = page.getByRole("button", { name: "Back to Explore" });
  if (await back.isVisible()) await back.click();
  await page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
}

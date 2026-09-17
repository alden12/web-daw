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

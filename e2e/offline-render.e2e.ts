import { test, expect } from "@playwright/test";

/**
 * AGENT-4.1 spike: the single biggest unknown for the "agent ears" epic is whether our custom
 * AudioWorklet instruments render under an OfflineAudioContext. jsdom (the unit-test env) has no
 * AudioWorklet, so this can only be proven in a real browser - here. The app installs a dev/test
 * hook (main.tsx) that builds a wavetable instrument through the normal factory on a fresh offline
 * context, plays a note, renders, and returns the peak amplitude. Non-silent => the factory +
 * worklet reuse thesis holds and the full renderProjectOffline is mechanical from here.
 */
test("a worklet instrument renders to a non-silent buffer offline (AGENT-4.1 spike)", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as unknown as { __dawRenderWorkletSmoke?: unknown }).__dawRenderWorkletSmoke === "function",
  );

  const peak = await page.evaluate(async () =>
    (window as unknown as { __dawRenderWorkletSmoke: () => Promise<number> }).__dawRenderWorkletSmoke(),
  );

  expect(peak).toBeGreaterThan(0.001);
});

/**
 * The real path: renderProjectOffline consumes a ProjectStore (a seeded synth track + a wavetable
 * worklet track, each with a note), builds the instrument -> effects -> group -> master graph, and
 * schedules the flattened arrangement. Non-silent proves the project-consuming render works end to
 * end in a real browser.
 */
test("a project (synth + worklet tracks) renders to a non-silent buffer offline", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as unknown as { __dawRenderProjectSmoke?: unknown }).__dawRenderProjectSmoke === "function",
  );

  const peak = await page.evaluate(async () =>
    (window as unknown as { __dawRenderProjectSmoke: () => Promise<number> }).__dawRenderProjectSmoke(),
  );

  expect(peak).toBeGreaterThan(0.001);
});

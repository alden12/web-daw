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

/**
 * Sampler pre-decode: a sampler's buffer decodes asynchronously and, without Instrument.ready,
 * would render silent offline (the render runs to completion before the decode lands). A sampler
 * track (default sample: builtin:kick) with a note must render non-silent - proving the render
 * awaits sample readiness before startRendering.
 */
test("a sampler track renders to a non-silent buffer offline (sample pre-decode)", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as unknown as { __dawRenderSamplerSmoke?: unknown }).__dawRenderSamplerSmoke === "function",
  );

  const peak = await page.evaluate(async () =>
    (window as unknown as { __dawRenderSamplerSmoke: () => Promise<number> }).__dawRenderSamplerSmoke(),
  );

  expect(peak).toBeGreaterThan(0.001);
});

/**
 * Audio tracks: a recorded take (a synthetic sine stored via putAudio) on an audio track must be
 * decoded and scheduled into the render, so the offline mix includes recorded audio, not just
 * instrument tracks. Non-silent proves the audio-clip decode + windowed scheduling path.
 */
test("an audio track (recorded take) renders to a non-silent buffer offline", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __dawRenderAudioTrackSmoke?: unknown }).__dawRenderAudioTrackSmoke === "function",
  );

  const peak = await page.evaluate(async () =>
    (window as unknown as { __dawRenderAudioTrackSmoke: () => Promise<number> }).__dawRenderAudioTrackSmoke(),
  );

  expect(peak).toBeGreaterThan(0.001);
});

/**
 * The full "agent ears" chain end to end: render offline -> analyzeMix -> summarizeMix, the exact
 * logic behind the analyze_mix agent tool. Proves the render produces measurable audio and the
 * analysis yields a sane, model-friendly report (audible, with headroom, not clipping - the master
 * limiter keeps a single note well under full scale).
 */
test("render + analyze produces a sane mix report (analyze_mix chain)", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as unknown as { __dawAnalyzeMix?: unknown }).__dawAnalyzeMix === "function",
  );

  const report = (await page.evaluate(async () =>
    (window as unknown as { __dawAnalyzeMix: () => Promise<Record<string, unknown>> }).__dawAnalyzeMix(),
  )) as { peakDbfs: number; headroomDb: number; loudnessDbfs: number; clipping: boolean; note: string };

  expect(report.clipping).toBe(false);
  expect(report.peakDbfs).toBeGreaterThan(-120); // audible, not silent
  expect(report.peakDbfs).toBeLessThanOrEqual(0.5); // under (or at) full scale
  expect(report.headroomDb).toBeGreaterThan(0);
  expect(typeof report.note).toBe("string");
});

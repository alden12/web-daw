/**
 * Sample playback in the declarative format (INST-13): a `buffer` node, rendered offline in a real
 * browser and measured. One-shot against gated is about time - what still sounds after the note is
 * let go - so that is what these listen for.
 */
import { test, expect, type Page } from "@playwright/test";

type Options = {
  /** Omitted: the built-in Sampler. Given: a custom def whose one buffer node has this `oneShot`. */
  oneShot?: boolean;
  /** When the note is let go, and (optionally) when Stop is pressed, in seconds. */
  releaseAt: number;
  stopAt?: number;
  windows: [number, number][];
};

/** The built-in kick through a sampler, played with an explicit note-on/note-off; RMS per window. */
async function render(page: Page, options: Options): Promise<number[]> {
  return page.evaluate(async ({ oneShot, releaseAt, stopAt, windows }) => {
    const { createInstrument, instrumentSchema } = await import(
      /* @vite-ignore */ "/src/audio/instruments/registry.ts"
    );
    const { GraphInstrument } = await import(/* @vite-ignore */ "/src/audio/graph/GraphInstrument.ts");
    const { ParamStore } = await import(/* @vite-ignore */ "/src/audio/params/store.ts");
    const sampleRate = 44100;
    const context = new OfflineAudioContext(1, sampleRate, sampleRate);
    const instrument =
      oneShot === undefined
        ? createInstrument("sampler", context, new ParamStore(instrumentSchema("sampler")))
        : new GraphInstrument(context, new ParamStore([]), {
            type: "ci-sample",
            schema: [],
            voice: {
              nodes: [{ id: "hit", kind: "buffer", sample: "builtin:kick", oneShot }],
              connections: [["hit", "amp"]],
            },
          });
    await instrument.ready?.();
    instrument.output.connect(context.destination);
    instrument.noteOn(60, 1, 0.01);
    instrument.noteOff(60, releaseAt);
    // Stop partway through the render, as the transport would.
    if (stopAt !== undefined) void context.suspend(stopAt).then(() => (instrument.allNotesOff(), context.resume()));
    const samples = (await context.startRendering()).getChannelData(0);
    return windows.map(([from, to]) => {
      const window = samples.subarray(Math.floor(from * sampleRate), Math.floor(to * sampleRate));
      return Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
    });
  }, options);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the Sampler, now a graph, plays a hit out after a short note is let go", async ({ page }) => {
  const [afterRelease] = await render(page, { releaseAt: 0.03, windows: [[0.12, 0.18]] });
  expect(afterRelease).toBeGreaterThan(0.005);
});

test("a gated sample stops with the note, where a one-shot plays on", async ({ page }) => {
  const windows: [number, number][] = [[0.35, 0.45]];
  const [gated] = await render(page, { oneShot: false, releaseAt: 0.03, windows });
  const [oneShot] = await render(page, { oneShot: true, releaseAt: 0.03, windows });
  expect(gated).toBeLessThan(0.0005);
  expect(oneShot).toBeGreaterThan(gated * 10);
});

test("Stop cuts a one-shot that is still playing out", async ({ page }) => {
  const [playing] = await render(page, { releaseAt: 0.03, windows: [[0.12, 0.18]] });
  const [stopped] = await render(page, { releaseAt: 0.03, stopAt: 0.1, windows: [[0.12, 0.18]] });
  expect(playing).toBeGreaterThan(0.005);
  expect(stopped).toBeLessThan(0.0005);
});

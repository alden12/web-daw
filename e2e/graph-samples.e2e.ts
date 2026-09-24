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

/** One hit on the Drum Kit, now a graph; returns the rendered samples' RMS over the first 100ms. */
async function kitHit(page: Page, note: number): Promise<{ level: number; fingerprint: number[] }> {
  return page.evaluate(async (note) => {
    const { createInstrument, instrumentSchema } = await import(
      /* @vite-ignore */ "/src/audio/instruments/registry.ts"
    );
    const { ParamStore } = await import(/* @vite-ignore */ "/src/audio/params/store.ts");
    const sampleRate = 44100;
    const context = new OfflineAudioContext(1, sampleRate / 2, sampleRate);
    const kit = createInstrument("drumkit", context, new ParamStore(instrumentSchema("drumkit")));
    await kit.ready?.();
    kit.output.connect(context.destination);
    kit.playNote(note, 0.05, 1, 0.01);
    const samples = (await context.startRendering()).getChannelData(0).subarray(0, sampleRate / 10);
    const level = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    // A coarse shape to tell two sounds apart: RMS per 10ms.
    const fingerprint = Array.from({ length: 10 }, (_unused, slot) => {
      const slice = samples.subarray((slot * sampleRate) / 100, ((slot + 1) * sampleRate) / 100);
      return Math.sqrt(slice.reduce((sum, sample) => sum + sample * sample, 0) / slice.length);
    });
    return { level, fingerprint };
  }, note);
}

test("the Drum Kit, now a graph, plays the pad on a note and nothing on an unmapped one", async ({ page }) => {
  const kick = await kitHit(page, 36); // GM kick
  const snare = await kitHit(page, 38); // GM snare
  const nothing = await kitHit(page, 120); // no pad
  expect(kick.level).toBeGreaterThan(0.005);
  expect(snare.level).toBeGreaterThan(0.005);
  expect(nothing.level).toBe(0);
  expect(kick.fingerprint).not.toEqual(snare.fingerprint);
});

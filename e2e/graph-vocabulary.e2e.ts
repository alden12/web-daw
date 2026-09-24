/**
 * The native-node vocabulary (INST-13), heard: devices built from the new nodes render offline in a
 * real browser and the result is measured. The unit tests cover what a def may say; only a real
 * AudioContext says the nodes make the sound they should.
 */
import { test, expect, type Page } from "@playwright/test";

/** Per-channel loudness (RMS) of a window of a rendered buffer. */
type Levels = { left: number; right: number };

/** A snare authored in the format - noise, band-pass, envelope, pan - played once and rendered. */
async function renderSnare(page: Page, pan: number, windows: [number, number][]): Promise<Levels[]> {
  return page.evaluate(
    async ({ pan, windows }) => {
      const { GraphInstrument } = await import(/* @vite-ignore */ "/src/audio/graph/GraphInstrument.ts");
      const { ParamStore } = await import(/* @vite-ignore */ "/src/audio/params/store.ts");
      const sampleRate = 44100;
      const context = new OfflineAudioContext(2, sampleRate, sampleRate);
      const snare = new GraphInstrument(context, new ParamStore([]), {
        type: "ci-snare",
        schema: [],
        voice: {
          nodes: [
            { id: "noise", kind: "noise" },
            { id: "band", kind: "biquad", filterType: "bandpass", frequency: 1800, q: 0.8 },
            { id: "env", kind: "env", attack: 1, decay: 120, sustain: 0, release: 50 },
            { id: "vca", kind: "gain", gain: 0 },
            { id: "place", kind: "pan", pan },
          ],
          connections: [
            ["noise", "band"],
            ["band", "vca"],
            ["env", "vca.gain"],
            ["vca", "place"],
            ["place", "out"],
          ],
        },
      });
      snare.output.connect(context.destination);
      snare.playNote(38, 0.5, 1, 0.01);
      const rendered = await context.startRendering();
      const rms = (samples: Float32Array) =>
        Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      return windows.map(([from, to]) => {
        const window = (channel: number) =>
          rendered.getChannelData(channel).subarray(Math.floor(from * sampleRate), Math.floor(to * sampleRate));
        return { left: rms(window(0)), right: rms(window(1)) };
      });
    },
    { pan, windows },
  );
}

/** A short click through one of the built-in effects, fully wet; returns loudness per window. */
async function renderThroughEffect(page: Page, type: string, windows: [number, number][]): Promise<number[]> {
  return page.evaluate(
    async ({ type, windows }) => {
      const { createEffect, effectSchema } = await import(/* @vite-ignore */ "/src/audio/effects/registry.ts");
      const { ParamStore } = await import(/* @vite-ignore */ "/src/audio/params/store.ts");
      const sampleRate = 44100;
      const context = new OfflineAudioContext(2, sampleRate * 2, sampleRate);
      const store = new ParamStore(effectSchema(type));
      store.set("mix", 1);
      const effect = createEffect(type, context, store);
      effect.output.connect(context.destination);
      // 50ms of a 440Hz tone, then silence: anything after it is the effect's own tail.
      const tone = context.createOscillator();
      tone.frequency.value = 440;
      tone.connect(effect.input);
      tone.start(0);
      tone.stop(0.05);
      const samples = (await context.startRendering()).getChannelData(0);
      return windows.map(([from, to]) => {
        const window = samples.subarray(Math.floor(from * sampleRate), Math.floor(to * sampleRate));
        return Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
      });
    },
    { type, windows },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a snare built from noise sounds, then dies away with its envelope", async ({ page }) => {
  const [hit, later] = await renderSnare(page, 0, [
    [0.012, 0.04],
    [0.4, 0.45],
  ]);
  expect(hit.left).toBeGreaterThan(0.01);
  expect(later.left).toBeLessThan(hit.left / 20);
});

test("pan places a voice in the stereo field", async ({ page }) => {
  const [hardLeft] = await renderSnare(page, -1, [[0.012, 0.04]]);
  expect(hardLeft.left).toBeGreaterThan(0.01);
  expect(hardLeft.right).toBeLessThan(hardLeft.left / 100);
});

test("the Reverb, now a graph, still rings on after its input stops", async ({ page }) => {
  const [tail] = await renderThroughEffect(page, "reverb", [[0.3, 0.4]]);
  expect(tail).toBeGreaterThan(0.001);
});

test("the Chorus and the Filter, now graphs, pass sound through", async ({ page }) => {
  for (const type of ["chorus", "filter"]) {
    const [during, after] = await renderThroughEffect(page, type, [
      [0.03, 0.05],
      [1, 1.5],
    ]);
    expect(during, type).toBeGreaterThan(0.01);
    expect(after, type).toBeLessThan(0.001);
  }
});

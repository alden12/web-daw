/**
 * Envelopes in the declarative format (INST-12), heard rather than asserted: Subtractive renders
 * offline in a real browser and the test measures the result. The unit tests cover the timing
 * math; only a real AudioContext says the envelope actually reaches the sound.
 */
import { test, expect, type Page } from "@playwright/test";

/** One note through Subtractive with some params set, rendered offline; returns per-window levels. */
async function render(
  page: Page,
  {
    params,
    holdSeconds,
    windows,
  }: { params: Record<string, number>; holdSeconds: number; windows: [number, number][] },
) {
  return page.evaluate(
    async ({ params, holdSeconds, windows }) => {
      // Straight from Vite's dev server, so the test drives the real modules with no app hook.
      const registryPath = "/src/audio/instruments/registry.ts";
      const storePath = "/src/audio/params/store.ts";
      const { createInstrument, instrumentSchema } = await import(/* @vite-ignore */ registryPath);
      const { ParamStore } = await import(/* @vite-ignore */ storePath);

      const sampleRate = 44100;
      const context = new OfflineAudioContext(1, sampleRate * 2, sampleRate);
      const store = new ParamStore(instrumentSchema("subtractive"));
      for (const [id, value] of Object.entries(params)) store.set(id, value);
      const instrument = createInstrument("subtractive", context, store);
      instrument.output.connect(context.destination);
      instrument.playNote(48, holdSeconds, 1, 0.01);
      const samples = (await context.startRendering()).getChannelData(0);

      // Loudness (RMS) and brightness (how much of it is sample-to-sample change) per window.
      return windows.map(([from, to]) => {
        const slice = samples.subarray(Math.floor(from * sampleRate), Math.floor(to * sampleRate));
        const energy = slice.reduce((sum, sample) => sum + sample * sample, 0);
        const change = slice.reduce((sum, sample, index) => (index ? sum + (sample - slice[index - 1]) ** 2 : sum), 0);
        return { level: Math.sqrt(energy / slice.length), brightness: energy ? change / energy : 0 };
      });
    },
    { params, holdSeconds, windows },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the amp envelope decays to its sustain while the note is held", async ({ page }) => {
  const [early, held] = await render(page, {
    params: { "env.decay": 80, "env.sustain": 0.1 },
    holdSeconds: 1,
    windows: [
      [0.02, 0.05],
      [0.5, 0.6],
    ],
  });
  expect(held.level).toBeGreaterThan(0);
  expect(held.level / early.level).toBeLessThan(0.25);
});

test("at the default full sustain it holds its level, as it did before envelopes", async ({ page }) => {
  const [early, held] = await render(page, {
    params: {},
    holdSeconds: 1,
    windows: [
      [0.05, 0.1],
      [0.5, 0.6],
    ],
  });
  expect(held.level / early.level).toBeGreaterThan(0.9);
});

test("a long release keeps the voice sounding after the note ends", async ({ page }) => {
  const [short] = await render(page, { params: { "env.release": 50 }, holdSeconds: 0.2, windows: [[0.5, 0.6]] });
  const [long] = await render(page, { params: { "env.release": 1500 }, holdSeconds: 0.2, windows: [[0.5, 0.6]] });
  expect(short.level).toBeLessThan(0.001);
  expect(long.level).toBeGreaterThan(0.01);
});

test("the filter envelope opens the cutoff and closes it again", async ({ page }) => {
  const [open, closed] = await render(page, {
    params: { "filter.cutoff": 200, "filter.env": 48, "fenv.decay": 100, "fenv.sustain": 0 },
    holdSeconds: 1,
    windows: [
      [0.01, 0.03],
      [0.5, 0.6],
    ],
  });
  expect(open.brightness).toBeGreaterThan(closed.brightness * 4);
});

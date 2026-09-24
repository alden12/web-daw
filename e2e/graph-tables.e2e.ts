/**
 * Lookup-table bindings (INST-17), heard: Organ and Supersaw, now graphs, rendered offline in a
 * real browser. The unit tests check the tables against the old classes' formulas; these check
 * the knobs still do to the sound what they say.
 */
import { test, expect, type Page } from "@playwright/test";

type Measure = { rms: number; fundamental: number; second: number };

/**
 * Hold A3 (220Hz) on a built-in instrument, set `before` params, then `after` ones halfway through
 * while the note is still held. Returns, per window, the loudness and the strength of 220Hz and
 * 440Hz (a single-frequency DFT).
 */
async function render(
  page: Page,
  type: string,
  before: Record<string, number>,
  after: Record<string, number>,
  windows: [number, number][],
): Promise<Measure[]> {
  return page.evaluate(
    async ({ type, before, after, windows }) => {
      const { createInstrument, instrumentSchema } = await import(
        /* @vite-ignore */ "/src/audio/instruments/registry.ts"
      );
      const { ParamStore } = await import(/* @vite-ignore */ "/src/audio/params/store.ts");
      const sampleRate = 44100;
      const context = new OfflineAudioContext(1, sampleRate * 1.2, sampleRate);
      const store = new ParamStore(instrumentSchema(type));
      Object.entries(before).forEach(([id, value]) => store.set(id, value));
      const instrument = createInstrument(type, context, store);
      instrument.output.connect(context.destination);
      instrument.noteOn(57, 1, 0.01);
      void context.suspend(0.6).then(() => {
        Object.entries(after).forEach(([id, value]) => store.set(id, value));
        return context.resume();
      });
      const samples = (await context.startRendering()).getChannelData(0);
      const strength = (window: Float32Array, frequency: number) => {
        const [real, imaginary] = window.reduce(
          ([re, im], sample, index) => {
            const phase = (2 * Math.PI * frequency * index) / sampleRate;
            return [re + sample * Math.cos(phase), im - sample * Math.sin(phase)];
          },
          [0, 0],
        );
        return Math.hypot(real, imaginary) / window.length;
      };
      return windows.map(([from, to]) => {
        const window = samples.subarray(Math.floor(from * sampleRate), Math.floor(to * sampleRate));
        const rms = Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
        return { rms, fundamental: strength(window, 220), second: strength(window, 440) };
      });
    },
    { type, before, after, windows },
  );
}

const HALVES: [number, number][] = [
  [0.1, 0.5],
  [0.7, 1.1],
];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("Organ brightness brings the upper partials in, on a note already held", async ({ page }) => {
  const [dark, bright] = await render(page, "organ", { "organ.brightness": 0 }, { "organ.brightness": 1 }, HALVES);
  // No brightness is the fundamental alone; full brightness has every partial level with it.
  expect(dark.second / dark.fundamental).toBeLessThan(0.02);
  expect(bright.second / bright.fundamental).toBeGreaterThan(0.8);
  expect(bright.second / bright.fundamental).toBeLessThan(1.25);
});

test("Supersaw voices spread the note across detuned saws, at a tamed loudness, on a held note", async ({ page }) => {
  const [single, stack] = await render(
    page,
    "supersaw",
    { "super.voices": 1, "super.detune": 50 },
    { "super.voices": 9 },
    HALVES,
  );
  // One saw puts its fundamental right on 220Hz; nine spread +/-50 cents leave little exactly there.
  expect(stack.fundamental).toBeLessThan(single.fundamental * 0.4);
  // The 1/n mix (as the class had it) keeps nine saws from being nine times as loud. Detuned saws
  // add in power rather than amplitude, so the stack lands quieter than one, not level with it.
  expect(stack.rms / single.rms).toBeGreaterThan(0.1);
  expect(stack.rms / single.rms).toBeLessThan(0.6);
});

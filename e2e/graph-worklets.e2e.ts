/**
 * Custom-DSP blocks (INST-15.1), heard: the ladder and bitcrush kinds rendered offline in a real
 * browser, which is the only place an AudioWorklet runs. Covers that a block sounds in a voice
 * whose note starts after it is built (its processor lives only while something plays into it),
 * that its fields and modulation reach the DSP, the voice cap, and the Bitcrusher as a graph.
 */
import { test, expect, type Page } from "@playwright/test";

type VoiceNode = Record<string, unknown> & { id: string; kind: string };
type Played = { notes: number[]; at: number; seconds: number };
/** Loudness and brightness (loudness of the sample-to-sample change, over loudness) per window. */
type Measure = { rms: number; brightness: number };

/** Render an instrument voice made of `nodes`, playing `played`, and measure each window. */
async function renderVoice(
  page: Page,
  nodes: VoiceNode[],
  connections: [string, string][],
  played: Played,
  windows: [number, number][],
): Promise<Measure[]> {
  return page.evaluate(
    async ({ nodes, connections, played, windows }) => {
      const { GraphInstrument } = await import(/* @vite-ignore */ "/src/audio/graph/GraphInstrument.ts");
      const { ParamStore } = await import(/* @vite-ignore */ "/src/audio/params/store.ts");
      const { loadWorklets } = await import(/* @vite-ignore */ "/src/audio/worklets/index.ts");
      const sampleRate = 44100;
      const context = new OfflineAudioContext(1, sampleRate, sampleRate);
      await loadWorklets(context);
      const instrument = new GraphInstrument(context, new ParamStore([]), {
        type: "ci-worklet",
        schema: [],
        voice: { nodes, connections },
      });
      instrument.output.connect(context.destination);
      for (const note of played.notes) instrument.playNote(note, played.seconds, 0.1, played.at);
      const samples = (await context.startRendering()).getChannelData(0);
      const rms = (values: ArrayLike<number>) =>
        Math.sqrt(Array.from(values).reduce((sum, value) => sum + value * value, 0) / values.length);
      return windows.map(([from, to]) => {
        const window = samples.subarray(Math.floor(from * sampleRate), Math.floor(to * sampleRate));
        const change = window.slice(1).map((sample, index) => sample - window[index]);
        const loudness = rms(window);
        return { rms: loudness, brightness: loudness > 0 ? rms(change) / loudness : 0 };
      });
    },
    { nodes, connections, played, windows },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

const sawThroughLadder = (ladder: Record<string, unknown>): VoiceNode[] => [
  { id: "osc", kind: "osc", waveform: "sawtooth" },
  { id: "filter", kind: "ladder", ...ladder },
];
const INTO_LADDER: [string, string][] = [
  ["osc", "filter"],
  ["filter", "amp"],
];
const LATE_NOTE: Played = { notes: [45], at: 0.2, seconds: 0.6 }; // A2, starting well after it is built

test("a ladder in a voice sounds, and its cutoff darkens a saw", async ({ page }) => {
  const [dark] = await renderVoice(page, sawThroughLadder({ frequency: 300 }), INTO_LADDER, LATE_NOTE, [[0.3, 0.7]]);
  const [bright] = await renderVoice(page, sawThroughLadder({ frequency: 8000 }), INTO_LADDER, LATE_NOTE, [[0.3, 0.7]]);
  expect(dark.rms).toBeGreaterThan(0.005);
  expect(bright.rms).toBeGreaterThan(0.005);
  expect(dark.brightness).toBeLessThan(bright.brightness * 0.5);
});

test("an envelope into a ladder's detune sweeps it down as the note goes on", async ({ page }) => {
  const nodes: VoiceNode[] = [
    ...sawThroughLadder({ frequency: 200 }),
    { id: "sweep", kind: "env", attack: 1, decay: 250, sustain: 0 },
    { id: "depth", kind: "gain", gain: 4800 }, // four octaves of cents at the peak
  ];
  const connections: [string, string][] = [...INTO_LADDER, ["sweep", "depth"], ["depth", "filter.detune"]];
  const [early, late] = await renderVoice(page, nodes, connections, LATE_NOTE, [
    [0.21, 0.26],
    [0.6, 0.7],
  ]);
  expect(late.brightness).toBeLessThan(early.brightness * 0.6);
});

test("an instrument using a custom block plays at most 8 notes at once; a native one is not capped", async ({
  page,
}) => {
  const unison = (count: number): Played => ({ notes: Array(count).fill(57), at: 0.05, seconds: 0.8 });
  const window: [number, number][] = [[0.3, 0.6]];
  // Identical notes add up exactly, so loudness counts how many are sounding.
  const [eightCapped] = await renderVoice(page, sawThroughLadder({ frequency: 2000 }), INTO_LADDER, unison(8), window);
  const [twelveCapped] = await renderVoice(
    page,
    sawThroughLadder({ frequency: 2000 }),
    INTO_LADDER,
    unison(12),
    window,
  );
  const native: VoiceNode[] = [{ id: "osc", kind: "osc", waveform: "sawtooth" }];
  const [eightNative] = await renderVoice(page, native, [["osc", "amp"]], unison(8), window);
  const [twelveNative] = await renderVoice(page, native, [["osc", "amp"]], unison(12), window);
  expect(twelveCapped.rms / eightCapped.rms).toBeCloseTo(1, 1);
  expect(twelveNative.rms / eightNative.rms).toBeCloseTo(1.5, 1);
});

test("the Bitcrusher, now a graph, crushes a tone to a few levels", async ({ page }) => {
  const levels = await page.evaluate(async () => {
    const { createEffect, effectSchema } = await import(/* @vite-ignore */ "/src/audio/effects/registry.ts");
    const { ParamStore } = await import(/* @vite-ignore */ "/src/audio/params/store.ts");
    const { loadWorklets } = await import(/* @vite-ignore */ "/src/audio/worklets/index.ts");
    const sampleRate = 44100;
    const context = new OfflineAudioContext(1, sampleRate / 2, sampleRate);
    await loadWorklets(context);
    const store = new ParamStore(effectSchema("bitcrusher"));
    store.set("mix", 1);
    store.set("bits", 2);
    store.set("downsample", 1);
    const effect = createEffect("bitcrusher", context, store);
    effect.output.connect(context.destination);
    const tone = context.createOscillator();
    tone.frequency.value = 220;
    tone.connect(effect.input);
    tone.start(0);
    // From 0.4s: an effect built at mix 1 still fades its dry path out over its first moments.
    const samples = (await context.startRendering()).getChannelData(0).subarray(sampleRate * 0.4);
    return new Set(Array.from(samples, (sample) => sample.toFixed(2))).size;
  });
  // 2 bits is 4 levels; the dry path is fully off at mix 1.
  expect(levels).toBeGreaterThan(1);
  expect(levels).toBeLessThanOrEqual(4);
});

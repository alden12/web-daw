/**
 * Custom-DSP blocks (INST-15.1), heard: the ladder and bitcrush kinds rendered offline in a real
 * browser, which is the only place an AudioWorklet runs. Covers that a block sounds in a voice
 * whose note starts after it is built (its processor lives only while something plays into it),
 * that its fields and modulation reach the DSP, the voice cap, and the Bitcrusher as a graph.
 */
import { test, expect, type Page } from "@playwright/test";

type VoiceNode = Record<string, unknown> & { id: string; kind: string };
type Played = { notes: number[]; at: number; seconds: number };
/**
 * Loudness and brightness (loudness of the sample-to-sample change, over loudness) per window, and
 * the strength of the first four harmonics of `fundamental` Hz when one is given.
 */
type Measure = { rms: number; brightness: number; harmonics: number[] };

/** Render an instrument voice made of `nodes`, playing `played`, and measure each window. */
async function renderVoice(
  page: Page,
  nodes: VoiceNode[],
  connections: [string, string][],
  played: Played,
  windows: [number, number][],
  fundamental = 0,
): Promise<Measure[]> {
  return page.evaluate(
    async ({ nodes, connections, played, windows, fundamental }) => {
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
        // A single-frequency DFT at each harmonic.
        const strength = (hz: number) => {
          const [real, imaginary] = window.reduce(
            ([re, im], sample, index) => {
              const phase = (2 * Math.PI * hz * index) / sampleRate;
              return [re + sample * Math.cos(phase), im - sample * Math.sin(phase)];
            },
            [0, 0],
          );
          return Math.hypot(real, imaginary) / window.length;
        };
        const harmonics = fundamental ? [1, 2, 3, 4].map((harmonic) => strength(fundamental * harmonic)) : [];
        return { rms: loudness, brightness: loudness > 0 ? rms(change) / loudness : 0, harmonics };
      });
    },
    { nodes, connections, played, windows, fundamental },
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

const A3: Played = { notes: [57], at: 0.2, seconds: 0.6 }; // 220Hz, starting well after it is built

test("an analogOsc plays the note, and its pulse width shapes the harmonics", async ({ page }) => {
  const pulse = (pulseWidth: number): VoiceNode[] => [{ id: "osc", kind: "analogOsc", waveform: "pulse", pulseWidth }];
  const window: [number, number][] = [[0.3, 0.7]];
  const [square] = await renderVoice(page, pulse(0.5), [["osc", "amp"]], A3, window, 220);
  const [narrow] = await renderVoice(page, pulse(0.25), [["osc", "amp"]], A3, window, 220);
  const [fundamental, second, third] = square.harmonics;
  // A square is the fundamental plus odd harmonics only; a 25% pulse has a strong 2nd.
  expect(fundamental).toBeGreaterThan(0.01);
  expect(second).toBeLessThan(fundamental / 50);
  expect(third).toBeGreaterThan(fundamental / 5);
  expect(narrow.harmonics[1]).toBeGreaterThan(narrow.harmonics[0] / 3);
});

test("an analogOsc saw is silent before and after its note", async ({ page }) => {
  const [before, during, after] = await renderVoice(
    page,
    [{ id: "osc", kind: "analogOsc", waveform: "saw" }],
    [["osc", "amp"]],
    { ...A3, seconds: 0.4 },
    [
      [0.05, 0.19],
      [0.3, 0.55],
      [0.9, 1.0], // after the note (0.2 to 0.6s) and its 200ms release
    ],
    220,
  );
  expect(during.harmonics[0]).toBeGreaterThan(0.01);
  expect(during.harmonics[1]).toBeGreaterThan(during.harmonics[0] / 3); // a saw has every harmonic
  expect(before.rms).toBe(0);
  expect(after.rms).toBeLessThan(during.rms / 100);
});

test("an LFO into an analogOsc's pulseWidth modulates it", async ({ page }) => {
  const nodes: VoiceNode[] = [
    { id: "osc", kind: "analogOsc", waveform: "pulse", pulseWidth: 0.5 },
    { id: "lfo", kind: "osc", frequency: 2 },
    { id: "depth", kind: "gain", gain: 0.3 },
  ];
  const connections: [string, string][] = [
    ["osc", "amp"],
    ["lfo", "depth"],
    ["depth", "osc.pulseWidth"],
  ];
  // Width swings 0.2..0.8 at 2Hz: the 2nd harmonic comes and goes, where a fixed square has none.
  const windows: [number, number][] = [
    [0.3, 0.4],
    [0.45, 0.55],
    [0.55, 0.65],
  ];
  const measures = await renderVoice(page, nodes, connections, A3, windows, 220);
  const seconds = measures.map((measure) => measure.harmonics[1] / measure.harmonics[0]);
  expect(Math.max(...seconds)).toBeGreaterThan(0.2);
});

test("a wavetableOsc morphs through its bank: a sine at 0, a saw at 1 on classic", async ({ page }) => {
  const wavetable = (bank: string, position: number): VoiceNode[] => [
    { id: "osc", kind: "wavetableOsc", bank, position },
  ];
  const window: [number, number][] = [[0.3, 0.7]];
  const [sine] = await renderVoice(page, wavetable("classic", 0), [["osc", "amp"]], A3, window, 220);
  const [saw] = await renderVoice(page, wavetable("classic", 1), [["osc", "amp"]], A3, window, 220);
  const [organ] = await renderVoice(page, wavetable("harmonics", 1), [["osc", "amp"]], A3, window, 220);
  expect(sine.harmonics[0]).toBeGreaterThan(0.01);
  expect(sine.harmonics[1]).toBeLessThan(sine.harmonics[0] / 100);
  expect(saw.harmonics[1] / saw.harmonics[0]).toBeCloseTo(0.5, 1); // a saw's 2nd is half its 1st
  expect(organ.harmonics[3] / organ.harmonics[0]).toBeCloseTo(1, 1); // 16 equal harmonics
});

test("an envelope into a wavetableOsc's position moves its timbre as the note goes on", async ({ page }) => {
  const nodes: VoiceNode[] = [
    { id: "osc", kind: "wavetableOsc", bank: "classic", position: 0 },
    { id: "sweep", kind: "env", attack: 1, decay: 250, sustain: 0 },
  ];
  const connections: [string, string][] = [
    ["osc", "amp"],
    ["sweep", "osc.position"],
  ];
  const [early, late] = await renderVoice(page, nodes, connections, A3, [
    [0.21, 0.24],
    [0.6, 0.7],
  ]);
  // Starts at a saw (the envelope's peak), settles to a sine.
  expect(late.brightness).toBeLessThan(early.brightness * 0.5);
});

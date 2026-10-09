/**
 * Render every built-in's portrait (COMM-1.9.2): each instrument, factory patch, effect and MIDI
 * device, alone, drawn by `draw.ts`. Iterates the catalogs, so a newly registered device gets one
 * on the next `yarn portraits` (which runs this in a headless browser and commits the result -
 * nothing renders on page load).
 *
 * Browser only: instruments and effects render through `renderIsolated`, which needs a real
 * `OfflineAudioContext` with AudioWorklets.
 */
import { pickableInstrumentInfos } from "../instruments/catalog";
import { effectInfos } from "../effects/catalog";
import { midiDeviceInfos } from "../midi/device/catalog";
import { FACTORY_PATCHES } from "../patches/factory";
import { renderIsolated, type IsolatedChain } from "../engine/renderIsolated";
import { capturePhrase } from "./capturePhrase";
import { envelope, isSustained, phaseScope, phrase, ringSeconds, transfer, type Portrait } from "./draw";
import { PORTRAIT_KEYS } from "./keys";

const SAMPLE_RATE = 44100;
/** A3, 220 Hz: low enough that two cycles are a few hundred samples, high enough to be a tone. */
const NOTE = { pitch: 57, frequency: 220 };
/** GM kick (MIDI 36): what a drum kit is asked for when a held A3 lands on no pad. */
const GM_KICK = 36;

const channel = (buffer: AudioBuffer) => buffer.getChannelData(0);
const silent = (samples: Float32Array) => !samples.some((sample) => Math.abs(sample) > 1e-4);

/** An instrument (with whatever chain a patch brings): its timbre if it holds, its hit if it decays. */
async function instrumentPortrait(chain: IsolatedChain): Promise<Portrait> {
  const play = async (pitch: number) =>
    channel(await renderIsolated(chain, { kind: "note", pitch, holdSec: 1.2 }, { durationSec: 1.6 }));
  const held = await play(NOTE.pitch);
  const samples = silent(held) ? await play(GM_KICK) : held;
  return isSustained(samples, SAMPLE_RATE)
    ? { line: phaseScope(samples, SAMPLE_RATE, NOTE.frequency) }
    : { fill: envelope(samples) };
}

/** A response longer than this rings on (a delay's echoes, a reverb's tail) rather than passing through. */
const RINGS_SEC = 0.2;

/**
 * An effect: its impulse response if it rings on (delay, reverb), else its transfer curve against a
 * sine (a click through distortion is still just a click, but a sine through it shows the bend).
 */
async function effectPortrait(type: string): Promise<Portrait> {
  const chain = { effects: [{ type }] };
  const response = channel(
    await renderIsolated(chain, { kind: "burst", frequency: 440, seconds: 0.02 }, { durationSec: 2.5 }),
  );
  if (ringSeconds(response, SAMPLE_RATE) > RINGS_SEC) return { fill: envelope(response) };
  const through = channel(await renderIsolated(chain, { kind: "sine", frequency: NOTE.frequency }, { durationSec: 1 }));
  return { line: transfer(through, SAMPLE_RATE, NOTE.frequency) };
}

const midiPortrait = (type: string): Portrait => {
  const { notes, spanSec } = capturePhrase(type);
  return { fill: phrase(notes, spanSec) };
};

export async function renderPortraits(): Promise<Record<string, Portrait>> {
  const jobs: (readonly [string, () => Promise<Portrait> | Portrait])[] = [
    ...pickableInstrumentInfos().map(
      (info) =>
        [PORTRAIT_KEYS.instrument(info.type), () => instrumentPortrait({ instrument: { type: info.type } })] as const,
    ),
    ...FACTORY_PATCHES.map(
      (patch) =>
        [
          PORTRAIT_KEYS.patch(patch.id),
          () =>
            instrumentPortrait({
              instrument: { type: patch.instrumentType, params: patch.params },
              effects: patch.effects.map((effect) => ({ type: effect.type, params: effect.params })),
            }),
        ] as const,
    ),
    ...effectInfos().map((info) => [PORTRAIT_KEYS.effect(info.type), () => effectPortrait(info.type)] as const),
    ...midiDeviceInfos().map((info) => [PORTRAIT_KEYS.midi(info.type), () => midiPortrait(info.type)] as const),
  ];
  // One at a time: each render spins up its own context and worklets, and the order keeps the
  // output file stable from run to run.
  const portraits: Record<string, Portrait> = {};
  for (const [key, draw] of jobs) portraits[key] = await draw();
  return portraits;
}

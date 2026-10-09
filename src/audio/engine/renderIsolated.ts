/**
 * Render one device alone (COMM-1.9.2, AGENT-4.8): an instrument and/or an effect chain, fed a
 * held note, a single-sample click or a steady sine, under an `OfflineAudioContext`. No project,
 * no tracks, no transport - just the device and what it does to one input.
 *
 * The same factories and worklets the live engine uses, so what Explore draws and what the agent
 * smoke-tests is what you would hear. Browser only (jsdom has no AudioWorklet), like the rest of
 * the offline renderer.
 */
import { createInstrument } from "../instruments/registry";
import { createEffect } from "../effects/registry";
import { instrumentSchema } from "../instruments/catalog";
import { effectSchema } from "../effects/catalog";
import { ParamStore } from "../params/store";
import type { ParamSchema, ParamValue } from "../params/types";
import { loadWorklets } from "../worklets";

export interface IsolatedDevice {
  type: string;
  params?: Record<string, ParamValue>;
}

export interface IsolatedChain {
  /** Omitted for an effect on its own, which the input then feeds directly. */
  instrument?: IsolatedDevice;
  effects?: IsolatedDevice[];
}

/**
 * What goes in: a note for an instrument; for an effect, a click, a short tone burst (a click with
 * enough body that a reverb's tail is not lost under it) or a steady sine.
 */
export type IsolatedInput =
  | { kind: "note"; pitch: number; holdSec: number; velocity?: number }
  | { kind: "impulse" }
  | { kind: "burst"; frequency: number; seconds: number }
  | { kind: "sine"; frequency: number };

const storeFor = (schema: ParamSchema, params: Record<string, ParamValue> = {}) => {
  const store = new ParamStore(schema);
  Object.entries(params).forEach(([id, value]) => store.set(id, value));
  return store;
};

const playBuffer = (ctx: OfflineAudioContext, samples: Float32Array<ArrayBuffer>) => {
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
};

/** A source node for the effect inputs; the note input plays the instrument instead. */
const SOURCES: {
  [Kind in Exclude<IsolatedInput["kind"], "note">]: (
    ctx: OfflineAudioContext,
    input: Extract<IsolatedInput, { kind: Kind }>,
  ) => AudioScheduledSourceNode;
} = {
  impulse: (ctx) => playBuffer(ctx, Float32Array.of(1)),
  // Hann-windowed, so it starts and ends at zero rather than clicking at its edges.
  burst: (ctx, input) => {
    const length = Math.round(input.seconds * ctx.sampleRate);
    return playBuffer(
      ctx,
      Float32Array.from({ length }, (_, index) => {
        const window = Math.sin((Math.PI * index) / length) ** 2;
        return window * Math.sin((2 * Math.PI * input.frequency * index) / ctx.sampleRate);
      }),
    );
  },
  sine: (ctx, input) => {
    const oscillator = ctx.createOscillator();
    oscillator.frequency.value = input.frequency;
    return oscillator;
  },
};

export async function renderIsolated(
  chain: IsolatedChain,
  input: IsolatedInput,
  { durationSec, sampleRate = 44100 }: { durationSec: number; sampleRate?: number },
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  // Worklet modules are keyed per-context, so a fresh offline context re-adds them cleanly. Must
  // complete BEFORE constructing any AudioWorkletNode.
  await loadWorklets(ctx);

  const effects = (chain.effects ?? []).map((device) =>
    createEffect(device.type, ctx, storeFor(effectSchema(device.type), device.params)),
  );
  // Chain the effects in order, ending at the destination; the head is where the input goes.
  const head = effects.reduceRight<AudioNode>((next, effect) => {
    effect.output.connect(next);
    return effect.input;
  }, ctx.destination);

  if (input.kind === "note") {
    const type = chain.instrument?.type ?? "subtractive";
    const instrument = createInstrument(type, ctx, storeFor(instrumentSchema(type), chain.instrument?.params));
    instrument.output.connect(head);
    // Samples decode asynchronously; a render that starts first is silent.
    await instrument.ready?.();
    // Worklet note commands are port messages. One posted before startRendering() races the render
    // and loses, so suspend at t=0, post the note while paused, then resume: the message is queued
    // before the first block renders.
    void ctx.suspend(0).then(() => {
      instrument.playNote(input.pitch, input.holdSec, input.velocity ?? 0.9, 0);
      void ctx.resume();
    });
  } else {
    const source = (
      SOURCES[input.kind] as (ctx: OfflineAudioContext, input: IsolatedInput) => AudioScheduledSourceNode
    )(ctx, input);
    source.connect(head);
    source.start(0);
  }

  return ctx.startRendering();
}

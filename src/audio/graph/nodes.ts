/**
 * The primitive vocabulary: the curated set of node kinds a declarative graph can
 * use, each mapped to a Web Audio node. This is the single extension point for the
 * format - adding a primitive is adding one entry here (and, for a custom-DSP
 * primitive later, a WASM/worklet-backed node). Each kind exposes how to build the
 * node, which of its fields are modulatable AudioParams (for `.param` connection
 * targets and ramped bindings), and how to set its enum/string properties.
 *
 * Curve families for the waveshaper live here too; `classic` is the exact curve
 * lifted from the original Distortion effect so the graph version sounds identical.
 */
import type { ImpulseShape, NodeSpec, NoiseColor, ShaperShape } from "./types";

export interface NodeImpl {
  /** Build the bare node (construction-only args like delay length are read from the spec). */
  create(ctx: BaseAudioContext, spec: NodeSpec): { node: AudioNode; source?: AudioScheduledSourceNode };
  /** The AudioParam for a field, if it is one (else undefined - it's a property). */
  audioParam(node: AudioNode, field: string): AudioParam | undefined;
  /** Set an enum/string property (waveform, filter type). */
  setProperty(node: AudioNode, field: string, value: string): void;
}

/** A node's AudioParams by field name, for the kinds that are just a set of them. */
const paramsOf =
  <T extends AudioNode>(pick: (node: T) => Record<string, AudioParam>) =>
  (node: AudioNode, field: string): AudioParam | undefined =>
    pick(node as T)[field];

export const NODE_IMPLS: Record<NodeSpec["kind"], NodeImpl> = {
  osc: {
    create: (ctx) => {
      const node = ctx.createOscillator();
      return { node, source: node };
    },
    audioParam: (node, field) => {
      const osc = node as OscillatorNode;
      return field === "frequency" ? osc.frequency : field === "detune" ? osc.detune : undefined;
    },
    setProperty: (node, field, value) => {
      if (field === "waveform") (node as OscillatorNode).type = value as OscillatorType;
    },
  },
  gain: {
    create: (ctx) => ({ node: ctx.createGain() }),
    audioParam: (node, field) => (field === "gain" ? (node as GainNode).gain : undefined),
    setProperty: () => {},
  },
  biquad: {
    create: (ctx) => ({ node: ctx.createBiquadFilter() }),
    audioParam: (node, field) => {
      const filter = node as BiquadFilterNode;
      return field === "frequency"
        ? filter.frequency
        : field === "detune"
          ? filter.detune
          : field === "q"
            ? filter.Q
            : field === "gain"
              ? filter.gain
              : undefined;
    },
    setProperty: (node, field, value) => {
      if (field === "filterType") (node as BiquadFilterNode).type = value as BiquadFilterType;
    },
  },
  delay: {
    create: (ctx, spec) => ({ node: ctx.createDelay(spec.kind === "delay" ? (spec.maxSeconds ?? 1) : 1) }),
    audioParam: (node, field) => (field === "delayTime" ? (node as DelayNode).delayTime : undefined),
    setProperty: () => {},
  },
  shaper: {
    create: (ctx, spec) => {
      const node = ctx.createWaveShaper();
      if (spec.kind === "shaper" && spec.oversample) node.oversample = spec.oversample;
      return { node };
    },
    audioParam: () => undefined, // the curve is set as a whole (see build.ts), not ramped
    setProperty: () => {},
  },
  // A constant source whose level the envelope schedules (build.ts), started and stopped with the
  // voice like an oscillator. Its default offset is 1, so it is zeroed until the note starts.
  env: {
    create: (ctx) => {
      const node = ctx.createConstantSource();
      node.offset.value = 0;
      return { node, source: node };
    },
    audioParam: () => undefined,
    setProperty: () => {},
  },
  // A looped buffer of noise, shared by every voice on the context rather than regenerated per note.
  noise: {
    create: (ctx, spec) => {
      const node = ctx.createBufferSource();
      node.buffer = noiseBuffer(ctx, spec.kind === "noise" ? (spec.color ?? "white") : "white");
      node.loop = true;
      return { node, source: node };
    },
    audioParam: () => undefined,
    setProperty: () => {},
  },
  constant: {
    create: (ctx) => {
      const node = ctx.createConstantSource();
      return { node, source: node };
    },
    audioParam: paramsOf<ConstantSourceNode>((node) => ({ offset: node.offset })),
    setProperty: () => {},
  },
  pan: {
    create: (ctx) => ({ node: ctx.createStereoPanner() }),
    audioParam: paramsOf<StereoPannerNode>((node) => ({ pan: node.pan })),
    setProperty: () => {},
  },
  compressor: {
    create: (ctx) => ({ node: ctx.createDynamicsCompressor() }),
    audioParam: paramsOf<DynamicsCompressorNode>((node) => ({
      threshold: node.threshold,
      knee: node.knee,
      ratio: node.ratio,
      attack: node.attack,
      release: node.release,
    })),
    setProperty: () => {},
  },
  convolver: {
    create: (ctx) => ({ node: ctx.createConvolver() }),
    audioParam: () => undefined, // the impulse is set as a whole (see build.ts), not ramped
    setProperty: () => {},
  },
};

/** Seconds of noise in a buffer: long enough that its loop point is not heard as a rhythm. */
const NOISE_SECONDS = 2;
const noiseBuffers = new WeakMap<BaseAudioContext, Map<NoiseColor, AudioBuffer>>();

/** The context's shared noise buffer in a colour, generated the first time it is asked for. */
function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const byColor = noiseBuffers.get(ctx) ?? noiseBuffers.set(ctx, new Map()).get(ctx)!;
  const cached = byColor.get(color);
  if (cached) return cached;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  NOISE_FILLS[color](buffer.getChannelData(0));
  byColor.set(color, buffer);
  return buffer;
}

const NOISE_FILLS: Record<NoiseColor, (samples: Float32Array) => void> = {
  white: (samples) => {
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  },
  // Paul Kellet's economy pink filter: three one-pole filters over white noise, within a dB or so of
  // true pink across the audible range, then scaled back to roughly unit peak.
  pink: (samples) => {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let index = 0; index < samples.length; index++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      samples[index] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    }
  },
};

/** Impulse families for a convolver, keyed by name. */
export const IMPULSES: Record<ImpulseShape, (ctx: BaseAudioContext, seconds: number) => AudioBuffer> = {
  // The original Reverb effect's tail, exactly: stereo noise fading as (1 - t)^2.5.
  decay: (ctx, seconds) => {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * seconds));
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2.5;
      }
    }
    return buffer;
  },
};

/** Waveshaper curve families, keyed by name. `amount` grows the drive, 0 (clean) to about 100. */
export const SHAPER_CURVES: Record<ShaperShape, (amount: number) => Float32Array<ArrayBuffer>> = {
  // The exact tanh-ish curve from the original Distortion effect.
  classic: (amount) => {
    const length = 1024;
    const curve = new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
    const deg = Math.PI / 180;
    for (let index = 0; index < length; index++) {
      const x = (index * 2) / length - 1;
      curve[index] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  },
  // Smooth saturation that levels off, the tube/tape sound.
  tanh: (amount) => {
    const drive = 1 + amount * 0.2;
    return curveOf((x) => Math.tanh(drive * x) / Math.tanh(drive));
  },
  // Flat clipping at full scale: harsher, more digital.
  hardClip: (amount) => {
    const drive = 1 + amount * 0.2;
    return curveOf((x) => Math.max(-1, Math.min(1, drive * x)));
  },
  // A wavefolder: past full scale the wave folds back on itself, adding bright, shifting harmonics.
  fold: (amount) => {
    const drive = 1 + amount * 0.1;
    return curveOf((x) => Math.sin((Math.PI / 2) * drive * x));
  },
};

/** A 1024-point curve over -1..1 from a transfer function. */
function curveOf(transfer: (x: number) => number): Float32Array<ArrayBuffer> {
  const length = 1024;
  const curve = new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
  for (let index = 0; index < length; index++) curve[index] = transfer((index * 2) / length - 1);
  return curve;
}

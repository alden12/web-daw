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
import type { NodeSpec, ShaperShape } from "./types";

export interface NodeImpl {
  /** Build the bare node (construction-only args like delay length are read from the spec). */
  create(ctx: BaseAudioContext, spec: NodeSpec): { node: AudioNode; source?: AudioScheduledSourceNode };
  /** The AudioParam for a field, if it is one (else undefined - it's a property). */
  audioParam(node: AudioNode, field: string): AudioParam | undefined;
  /** Set an enum/string property (waveform, filter type). */
  setProperty(node: AudioNode, field: string, value: string): void;
}

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
};

/** Waveshaper curve families, keyed by name. `amount` grows the drive. */
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
};

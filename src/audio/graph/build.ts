/**
 * The graph interpreter: turn a declarative Graph into a live Web Audio node graph.
 * Shared by GraphInstrument (once per voice) and GraphEffect (once). It builds each
 * node from the primitive vocabulary (nodes.ts), applies every field's initial value
 * (a literal, or the current value of a bound parameter), wires the connections, and
 * returns an `apply(paramId, value)` hook so parameter changes reach the live graph.
 *
 * Field values are literal or `{ param, scale?, offset? }` (value*scale + offset).
 * Two fields are computed rather than plain: an oscillator's frequency (tracks the
 * note, optionally times a ratio) and a waveshaper's curve (rebuilt from its family).
 * An envelope's fields are times, read when the note starts and ends (envelope.ts).
 */
import type { ParamValue } from "../params/types";
import { rampParam } from "../params/binding";
import type {
  Graph,
  NodeSpec,
  NumberField,
  EnumField,
  OscNodeSpec,
  ShaperNodeSpec,
  EnvNodeSpec,
  ConvolverNodeSpec,
} from "./types";
import { IMPULSES, NODE_IMPLS, SHAPER_CURVES } from "./nodes";
import { normalizeRelease, normalizeShape, scheduleAttack, scheduleRelease } from "./envelope";

export interface GraphContext {
  ctx: BaseAudioContext;
  /** Reserved endpoints by id: `amp` (instrument voice) or `in`/`wet` (effect). */
  reserved: Record<string, AudioNode>;
  /** The voice's fundamental frequency (instruments); absent for effects. */
  noteFreq?: number;
  /** AudioContext time to stamp initial values at (a voice's scheduled note time); defaults to now. */
  startTime?: number;
  /** Read a parameter's current value. */
  readParam: (id: string) => ParamValue;
}

export interface BuiltGraph {
  /** Oscillators / buffer sources to start (caller decides when: per-voice, or once). */
  sources: AudioScheduledSourceNode[];
  /** Apply a parameter change to this live graph. */
  apply(paramId: string, value: ParamValue, smoothMs?: number): void;
  /**
   * Let go of the note at `at`: start every envelope's release, and return how many seconds the
   * longest takes, which is how long the voice must keep sounding. 0 for a graph with none.
   */
  release(at: number): number;
  /** Disconnect every node (effect teardown; instrument voices are torn down by the base). */
  disconnect(): void;
}

/** Apply a parameter reference's linear transform: raw*scale + offset (defaults 1, 0). */
export function resolveLinear(raw: number, ref: { scale?: number; offset?: number }): number {
  return raw * (ref.scale ?? 1) + (ref.offset ?? 0);
}

// collectParamIds lives in validate.ts (pure, DOM-free); re-exported here for the runtimes.
export { collectParamIds } from "./validate";

export function buildGraph(graph: Graph, context: GraphContext): BuiltGraph {
  const { ctx, reserved } = context;
  const nodes = new Map<string, { node: AudioNode; kind: NodeSpec["kind"] }>();
  const sources: AudioScheduledSourceNode[] = [];
  // paramId -> applicators that push a new value into the live graph.
  const targets = new Map<string, ((value: ParamValue, smoothMs?: number) => void)[]>();
  const addTarget = (paramId: string, apply: (value: ParamValue, smoothMs?: number) => void): void => {
    (targets.get(paramId) ?? targets.set(paramId, []).get(paramId)!).push(apply);
  };
  const releases: Release[] = [];

  // 1. Create nodes.
  for (const spec of graph.nodes) {
    const { node, source } = NODE_IMPLS[spec.kind].create(ctx, spec);
    nodes.set(spec.id, { node, kind: spec.kind });
    if (source) sources.push(source);
  }
  const nodeById = (id: string): AudioNode => reserved[id] ?? nodes.get(id)!.node;

  // 2. Apply each node's fields (initial value now; a bound field also registers a
  //    live target so parameter changes reach it).
  for (const spec of graph.nodes) {
    applyFields(spec, nodes.get(spec.id)!.node, ctx, context, addTarget, (release) => releases.push(release));
  }

  // 3. Wire connections: `to` is a node input, or `nodeId.param` to modulate a param.
  for (const [from, to] of graph.connections) {
    const [toId, toParam] = to.split(".");
    if (toParam) {
      const target = nodes.get(toId)!;
      const audioParam = NODE_IMPLS[target.kind].audioParam(target.node, toParam);
      if (audioParam) nodeById(from).connect(audioParam);
    } else {
      nodeById(from).connect(nodeById(to));
    }
  }

  return {
    sources,
    apply: (paramId, value, smoothMs) => {
      for (const applyTarget of targets.get(paramId) ?? []) applyTarget(value, smoothMs);
    },
    release: (at) => releases.reduce((longest, release) => Math.max(longest, release(at)), 0),
    disconnect: () => {
      for (const { node } of nodes.values()) node.disconnect();
    },
  };
}

type AddTarget = (paramId: string, apply: (value: ParamValue, smoothMs?: number) => void) => void;
/** Start one envelope's release at `at`, returning how many seconds it takes. */
type Release = (at: number) => number;

/** Apply one node's declared fields, per kind. */
function applyFields(
  spec: NodeSpec,
  node: AudioNode,
  ctx: BaseAudioContext,
  context: GraphContext,
  addTarget: AddTarget,
  addRelease: (release: Release) => void,
): void {
  const impl = NODE_IMPLS[spec.kind];
  const startTime = context.startTime ?? ctx.currentTime;
  const numberField = (field: NumberField | undefined, param: AudioParam): void =>
    bindNumber(field, param, ctx, startTime, context.readParam, addTarget);
  const enumField = (field: EnumField<string> | undefined, name: string, fallback?: string): void =>
    bindProperty(field, (value) => impl.setProperty(node, name, value), context.readParam, addTarget, fallback);

  switch (spec.kind) {
    case "osc": {
      const osc = node as OscillatorNode;
      enumField(spec.waveform, "waveform", "sine");
      bindOscFrequency(spec, osc, ctx, startTime, context, addTarget);
      numberField(spec.detune, osc.detune);
      break;
    }
    case "gain":
      numberField(spec.gain, (node as GainNode).gain);
      break;
    case "biquad": {
      const filter = node as BiquadFilterNode;
      enumField(spec.filterType, "filterType", "lowpass");
      numberField(spec.frequency, filter.frequency);
      numberField(spec.q, filter.Q);
      numberField(spec.gain, filter.gain);
      break;
    }
    case "delay":
      numberField(spec.delayTime, (node as DelayNode).delayTime);
      break;
    case "shaper":
      bindShaperCurve(spec, node as WaveShaperNode, context.readParam, addTarget);
      break;
    case "env":
      addRelease(startEnvelope(spec, (node as ConstantSourceNode).offset, startTime, context.readParam));
      break;
    case "noise":
      break; // its colour is chosen when it is built
    case "constant":
      numberField(spec.offset, (node as ConstantSourceNode).offset);
      break;
    case "pan":
      numberField(spec.pan, (node as StereoPannerNode).pan);
      break;
    case "compressor": {
      const compressor = node as DynamicsCompressorNode;
      numberField(spec.threshold, compressor.threshold);
      numberField(spec.knee, compressor.knee);
      numberField(spec.ratio, compressor.ratio);
      numberField(spec.attack, compressor.attack);
      numberField(spec.release, compressor.release);
      break;
    }
    case "convolver":
      bindImpulse(spec, node as ConvolverNode, ctx, context.readParam, addTarget);
      break;
  }
}

/** Apply a numeric field (literal or param): initial value at startTime, ramping live changes. */
function bindNumber(
  field: NumberField | undefined,
  param: AudioParam,
  ctx: BaseAudioContext,
  startTime: number,
  readParam: (id: string) => ParamValue,
  addTarget: AddTarget,
): void {
  if (field === undefined) return;
  if (typeof field === "number") {
    param.setValueAtTime(field, startTime);
    return;
  }
  const compute = (raw: ParamValue): number => resolveLinear(raw as number, field);
  param.setValueAtTime(compute(readParam(field.param)), startTime);
  addTarget(field.param, (value, smoothMs) => rampParam(ctx, param, compute(value), smoothMs));
}

/** Apply an enum/string field (literal or param) to a node property. */
function bindProperty(
  field: EnumField<string> | undefined,
  setProperty: (value: string) => void,
  readParam: (id: string) => ParamValue,
  addTarget: AddTarget,
  fallback?: string,
): void {
  if (field === undefined) {
    if (fallback !== undefined) setProperty(fallback);
    return;
  }
  if (typeof field === "string") {
    setProperty(field);
    return;
  }
  const id = field.param;
  setProperty(readParam(id) as string);
  addTarget(id, (value) => setProperty(value as string));
}

/** Oscillator frequency: an absolute Hz, or the note frequency times an optional ratio. */
function bindOscFrequency(
  spec: OscNodeSpec,
  osc: OscillatorNode,
  ctx: BaseAudioContext,
  startTime: number,
  context: GraphContext,
  addTarget: AddTarget,
): void {
  if (spec.frequency !== undefined) {
    bindNumber(spec.frequency, osc.frequency, ctx, startTime, context.readParam, addTarget);
    return;
  }
  const base = context.noteFreq ?? 440;
  const ratio = spec.noteRatio;
  if (ratio === undefined) {
    osc.frequency.setValueAtTime(base, startTime);
    return;
  }
  if (typeof ratio === "number") {
    osc.frequency.setValueAtTime(base * ratio, startTime);
    return;
  }
  const compute = (raw: ParamValue): number => base * resolveLinear(raw as number, ratio);
  osc.frequency.setValueAtTime(compute(context.readParam(ratio.param)), startTime);
  addTarget(ratio.param, (value, smoothMs) => rampParam(ctx, osc.frequency, compute(value), smoothMs));
}

/** Waveshaper curve: rebuilt from its family whenever the amount changes. */
function bindShaperCurve(
  spec: ShaperNodeSpec,
  node: WaveShaperNode,
  readParam: (id: string) => ParamValue,
  addTarget: AddTarget,
): void {
  const { shape, amount } = spec.curve;
  const setCurve = (value: number): void => void (node.curve = SHAPER_CURVES[shape](value));
  if (typeof amount === "number") {
    setCurve(amount);
    return;
  }
  setCurve(resolveLinear(readParam(amount.param) as number, amount));
  addTarget(amount.param, (value) => setCurve(resolveLinear(value as number, amount)));
}

/** Convolver impulse: regenerated from its family whenever its length changes. */
function bindImpulse(
  spec: ConvolverNodeSpec,
  node: ConvolverNode,
  ctx: BaseAudioContext,
  readParam: (id: string) => ParamValue,
  addTarget: AddTarget,
): void {
  const { shape, seconds } = spec.impulse;
  const setImpulse = (value: number): void => void (node.buffer = IMPULSES[shape](ctx, value));
  if (typeof seconds === "number") {
    setImpulse(seconds);
    return;
  }
  setImpulse(resolveLinear(readParam(seconds.param) as number, seconds));
  addTarget(seconds.param, (value) => setImpulse(resolveLinear(value as number, seconds)));
}

/** Envelope defaults, in the units the fields are authored in: milliseconds, and 0..1 sustain. */
const ENV_DEFAULTS = { attack: 5, decay: 200, sustain: 1, release: 200 };

/** A number field's value right now: literal, bound param, or the default when it is left out. */
const readNumber = (field: NumberField | undefined, fallback: number, readParam: (id: string) => ParamValue) =>
  field === undefined
    ? fallback
    : typeof field === "number"
      ? field
      : resolveLinear(readParam(field.param) as number, field);

/** Schedule an envelope's attack, decay and sustain from the note's start; return its release. */
function startEnvelope(
  spec: EnvNodeSpec,
  level: AudioParam,
  startTime: number,
  readParam: (id: string) => ParamValue,
): Release {
  const seconds = (field: NumberField | undefined, fallbackMs: number) =>
    readNumber(field, fallbackMs, readParam) / 1000;
  const shape = normalizeShape({
    attack: seconds(spec.attack, ENV_DEFAULTS.attack),
    decay: seconds(spec.decay, ENV_DEFAULTS.decay),
    sustain: readNumber(spec.sustain, ENV_DEFAULTS.sustain, readParam),
  });
  scheduleAttack(level, shape, startTime);
  // Release is read when the note ends, so a knob turned while it is held still counts.
  return (at) => {
    const release = normalizeRelease(seconds(spec.release, ENV_DEFAULTS.release));
    scheduleRelease(level, shape, startTime, at, release);
    return release;
  };
}

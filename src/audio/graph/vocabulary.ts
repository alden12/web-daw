/**
 * The primitive vocabulary as pure data: for each node kind, which of its fields are
 * modulatable AudioParams (valid `.param` connection targets and ramped bindings) and
 * which are set-once properties (waveform, filter type). DOM-free on purpose - the Web
 * Audio builders (nodes.ts) realize these fields, but `validate.ts`, the def zod layer,
 * and the Node MCP server all describe/validate a def against this without importing Web
 * Audio. This is the canonical field list; nodes.ts mirrors it with concrete getters.
 */
import type { NodeSpec } from "./types";

export interface KindVocabulary {
  /** Fields that map to an AudioParam (modulatable; usable as a `nodeId.param` target). */
  audioParams: readonly string[];
  /** Fields that map to an enum/string property. */
  properties: readonly string[];
}

export const VOCABULARY: Record<NodeSpec["kind"], KindVocabulary> = {
  osc: { audioParams: ["frequency", "detune"], properties: ["waveform"] },
  gain: { audioParams: ["gain"], properties: [] },
  // `detune` is in cents, so an envelope into it sweeps the cutoff by musical intervals, not Hz.
  biquad: { audioParams: ["frequency", "detune", "q", "gain"], properties: ["filterType"] },
  delay: { audioParams: ["delayTime"], properties: [] },
  shaper: { audioParams: [], properties: [] }, // `curve` is a composite field, not a plain AudioParam
  // Its fields are times read at note-on and note-off, not AudioParams: an envelope is a source to
  // wire elsewhere, and nothing modulates it.
  env: { audioParams: [], properties: [] },
};

/** Kinds that follow a played note, so only make sense in an instrument voice. */
export const GATED_KINDS: readonly NodeSpec["kind"][] = ["env"];

export const NODE_KINDS = Object.keys(VOCABULARY) as NodeSpec["kind"][];

/** Whether a kind is part of the vocabulary. */
export function isKnownKind(kind: string): kind is NodeSpec["kind"] {
  return kind in VOCABULARY;
}

/** Whether `field` is a modulatable AudioParam of `kind` (a valid `.param` target). */
export function isAudioParam(kind: NodeSpec["kind"], field: string): boolean {
  return VOCABULARY[kind].audioParams.includes(field);
}

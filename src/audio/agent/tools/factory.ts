/**
 * Shared machinery for the agent's tools: the `defineTool` factory (one zod schema per
 * tool both validates the model's arguments and generates the provider JSON Schema), a
 * `ToolContext` bundling the project store / dispatch / scheduler plus the track+effect
 * resolvers, and small helpers. Each tool module takes a ToolContext and returns
 * AgentTool[]; the index concatenates them. See docs/AGENT.md.
 */
import { z } from "zod";
import type { AgentTool } from "../types";
import type { ProjectStore, InstrumentTrack, Track, EffectInstance } from "../../project/projectStore";
import type { Dispatch } from "../../commands/types";
import type { Scheduler } from "../../sequencer/scheduler";
import type { ParamSpec, ParamValue } from "../../params/types";

export interface AgentToolDeps {
  projectStore: ProjectStore;
  dispatch: Dispatch;
  scheduler: Scheduler;
}

export interface ToolContext extends AgentToolDeps {
  resolveTrack(trackId?: string): Track;
  resolveInstrumentTrack(trackId?: string): InstrumentTrack;
  resolveEffect(trackId: string | undefined, effectId: string): { track: Track; effect: EffectInstance };
}

/** Build the resolvers once so every tool shares the same "default to selected track"
 *  behaviour and error messages. */
export function makeContext(deps: AgentToolDeps): ToolContext {
  const { projectStore } = deps;
  const resolveTrack = (trackId?: string): Track => {
    const id = trackId ?? projectStore.selectedId ?? undefined;
    if (!id) throw new Error("No track given and none is selected. Call list_tracks and pass a track id.");
    const track = projectStore.getTrack(id);
    if (!track) throw new Error(`No track with id "${id}". Call list_tracks for valid ids.`);
    return track;
  };
  const resolveInstrumentTrack = (trackId?: string): InstrumentTrack => {
    const track = resolveTrack(trackId);
    if (track.kind !== "instrument") throw new Error(`Track "${track.id}" is an audio track, not an instrument track.`);
    return track;
  };
  const resolveEffect = (trackId: string | undefined, effectId: string): { track: Track; effect: EffectInstance } => {
    const track = resolveTrack(trackId);
    const effect = projectStore.getEffect(track.id, effectId);
    if (!effect) throw new Error(`No effect "${effectId}" on track "${track.id}". Call list_effects for its chain.`);
    return { track, effect };
  };
  return { ...deps, resolveTrack, resolveInstrumentTrack, resolveEffect };
}

export function defineTool<Schema extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: Schema;
  run: (args: z.infer<Schema>) => unknown | Promise<unknown>;
}): AgentTool {
  const jsonSchema = z.toJSONSchema(def.schema) as Record<string, unknown>;
  delete jsonSchema.$schema; // providers want a bare parameter schema
  return {
    name: def.name,
    description: def.description,
    jsonSchema,
    async run(rawArgs: unknown) {
      const parsed = def.schema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new Error(`Invalid arguments: ${detail}`);
      }
      return def.run(parsed.data);
    },
  };
}

/** A compact, model-friendly description of a parameter (its value + range/options). */
export function describeParam(spec: ParamSpec, value: ParamValue) {
  const base = { id: spec.id, label: spec.label, kind: spec.kind, value };
  if (spec.kind === "number") {
    return { ...base, min: spec.min, max: spec.max, unit: spec.unit, step: spec.step, format: spec.format };
  }
  if (spec.kind === "enum") return { ...base, options: spec.options };
  return base;
}

export const noteInput = z.object({
  pitch: z.number().int().min(0).max(127).describe("MIDI note, C4 = 60"),
  start: z.number().min(0).describe("onset in beats from the clip start (4 beats = 1 bar)"),
  length: z.number().min(0).optional().describe("duration in beats (default 1)"),
  velocity: z.number().min(0).max(1).optional().describe("0..1 (default 0.8)"),
});

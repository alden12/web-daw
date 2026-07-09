/**
 * Sound-design tools: instrument parameters, the effect chain, and patches (saved
 * sounds). Parameter writes validate against the catalog schema (validateParam) before
 * dispatching as "agent"; applying a patch creates a new track from a saved sound.
 */
import { z } from "zod";
import type { AgentTool } from "../types";
import type { ParamSpec } from "../../params/types";
import type { ParamStore } from "../../params/store";
import type { ProjectStore } from "../../project/projectStore";
import { defineTool, describeParam, type ToolContext } from "./factory";
import { newEffectId, newTrackId } from "../../commands/ids";
import { effectInfos, effectSchema, hasEffect } from "../../effects/catalog";
import { instrumentSchema } from "../../instruments/catalog";
import { validateParam } from "../../params/validate";
import { pitchName } from "../../params/noteName";
import { BUILTIN_SAMPLES, assetRef, builtinRef } from "../../samples/catalog";
import { newPatchId, savePatch } from "../../patches/library";
import { allPatches, findPatch } from "../../patches/factory";

export function soundTools(ctx: ToolContext): AgentTool[] {
  const { projectStore, dispatch, resolveInstrumentTrack, resolveTrack, resolveEffect } = ctx;

  return [
    defineTool({
      name: "list_parameters",
      description:
        "List an instrument track's parameters with their current values and ranges (defaults to the selected track). " +
        "For a pad-based instrument (a drum kit) it also returns `pads`: each loaded pad's MIDI note, note name, and " +
        "sound - the note that triggers that drum. Drum kits use their own note layout (not General MIDI), so consult " +
        "`pads` (not a standard drum map) before writing drum notes.",
      schema: z.object({ track: z.string().optional() }),
      run: ({ track }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        const specs = instrumentSchema(instrumentTrack.instrumentType);
        const loadedPads = loadedPadNumbers(specs, instrumentTrack.params);
        const pads = padMap(loadedPads, instrumentTrack.params, projectStore);
        return {
          trackId: instrumentTrack.id,
          instrument: instrumentTrack.instrumentType,
          // Concise pad->note->sound map for drum kits; omitted for other instruments.
          ...(pads.length > 0 ? { pads } : {}),
          // Drop the many unused pad slots so the list is not mostly empty pads.
          parameters: specs
            .filter((spec) => !isUnusedPadParam(spec.id, loadedPads))
            .map((spec) => describeParam(spec, instrumentTrack.params.get(spec.id))),
        };
      },
    }),

    defineTool({
      name: "set_parameter",
      description:
        "Set an instrument parameter by id (get ids/ranges from list_parameters). Defaults to the selected track.",
      schema: z.object({
        track: z.string().optional(),
        id: z.string(),
        value: z.union([z.number(), z.string(), z.boolean()]),
      }),
      run: ({ track, id, value }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        let spec: ParamSpec;
        try {
          spec = instrumentTrack.params.spec(id);
        } catch {
          throw new Error(
            `Unknown parameter "${id}" on ${instrumentTrack.instrumentType}. Call list_parameters for valid ids.`,
          );
        }
        const error = validateParam(spec, value);
        if (error) throw new Error(error);
        dispatch({ type: "setParam", trackId: instrumentTrack.id, id, value }, "agent");
        return { ok: true, trackId: instrumentTrack.id, id, value };
      },
    }),

    defineTool({
      name: "list_effects",
      description:
        "List a track's effect chain (id, type, bypassed) plus the effect palette you can add (defaults to the selected track).",
      schema: z.object({ track: z.string().optional() }),
      run: ({ track }) => {
        const resolved = resolveTrack(track);
        return {
          trackId: resolved.id,
          palette: effectInfos().map((info) => ({ type: info.type, label: info.label })),
          effects: resolved.effects.map((effect) => ({ id: effect.id, type: effect.type, bypassed: effect.bypassed })),
        };
      },
    }),

    defineTool({
      name: "list_effect_parameters",
      description: "List an effect's parameters with current values and ranges (get effect ids from list_effects).",
      schema: z.object({ track: z.string().optional(), effect_id: z.string() }),
      run: ({ track, effect_id }) => {
        const { track: resolved, effect } = resolveEffect(track, effect_id);
        return {
          trackId: resolved.id,
          effectId: effect.id,
          type: effect.type,
          bypassed: effect.bypassed,
          parameters: effectSchema(effect.type).map((spec) => describeParam(spec, effect.params.get(spec.id))),
        };
      },
    }),

    defineTool({
      name: "add_effect",
      description: "Add an effect to a track's chain. `effect` must be one of the palette types from list_effects.",
      schema: z.object({ track: z.string().optional(), effect: z.string() }),
      run: ({ track, effect }) => {
        if (!hasEffect(effect)) {
          throw new Error(
            `Unknown effect "${effect}". Valid: ${effectInfos()
              .map((info) => info.type)
              .join(", ")}.`,
          );
        }
        const resolved = resolveTrack(track);
        const id = newEffectId();
        dispatch({ type: "addEffect", hostId: resolved.id, effectType: effect, id }, "agent");
        return { ok: true, trackId: resolved.id, effectId: id, effect };
      },
    }),

    defineTool({
      name: "remove_effect",
      description: "Remove an effect from a track's chain by id (get ids from list_effects).",
      schema: z.object({ track: z.string().optional(), effect_id: z.string() }),
      run: ({ track, effect_id }) => {
        const { track: resolved, effect } = resolveEffect(track, effect_id);
        dispatch({ type: "removeEffect", hostId: resolved.id, effectId: effect.id }, "agent");
        return { ok: true, trackId: resolved.id, effectId: effect.id };
      },
    }),

    defineTool({
      name: "move_effect",
      description: "Reorder an effect within a track's chain to a new index (0 = first in the signal path).",
      schema: z.object({ track: z.string().optional(), effect_id: z.string(), to_index: z.number().int().min(0) }),
      run: ({ track, effect_id, to_index }) => {
        const { track: resolved, effect } = resolveEffect(track, effect_id);
        dispatch({ type: "moveEffect", hostId: resolved.id, effectId: effect.id, toIndex: to_index }, "agent");
        return { ok: true, trackId: resolved.id, effectId: effect.id, toIndex: to_index };
      },
    }),

    defineTool({
      name: "set_effect_parameter",
      description:
        "Set an effect parameter by id (get ids/ranges from list_effect_parameters). Every effect has a `mix` (0..1).",
      schema: z.object({
        track: z.string().optional(),
        effect_id: z.string(),
        id: z.string(),
        value: z.union([z.number(), z.string(), z.boolean()]),
      }),
      run: ({ track, effect_id, id, value }) => {
        const { track: resolved, effect } = resolveEffect(track, effect_id);
        let spec: ParamSpec;
        try {
          spec = effect.params.spec(id);
        } catch {
          throw new Error(`Unknown parameter "${id}" on ${effect.type}. Call list_effect_parameters for valid ids.`);
        }
        const error = validateParam(spec, value);
        if (error) throw new Error(error);
        dispatch({ type: "setEffectParam", hostId: resolved.id, effectId: effect.id, id, value }, "agent");
        return { ok: true, trackId: resolved.id, effectId: effect.id, id, value };
      },
    }),

    defineTool({
      name: "bypass_effect",
      description: "Enable or disable (bypass) an effect without removing it.",
      schema: z.object({ track: z.string().optional(), effect_id: z.string(), bypassed: z.boolean() }),
      run: ({ track, effect_id, bypassed }) => {
        const { track: resolved, effect } = resolveEffect(track, effect_id);
        dispatch({ type: "bypassEffect", hostId: resolved.id, effectId: effect.id, bypassed }, "agent");
        return { ok: true, trackId: resolved.id, effectId: effect.id, bypassed };
      },
    }),

    defineTool({
      name: "list_patches",
      description: "List saved sounds (patches): factory + user, with their instrument and category.",
      schema: z.object({}),
      run: () => ({
        patches: allPatches().map((patch) => ({
          id: patch.id,
          name: patch.name,
          author: patch.author,
          instrument: patch.instrumentType,
          builtin: patch.builtin ?? false,
          category: patch.category,
        })),
      }),
    }),

    defineTool({
      name: "get_patch",
      description: "Get a patch's full recipe (instrument, params, effects) by id or name.",
      schema: z.object({ patch: z.string() }),
      run: ({ patch }) => {
        const found = findPatch(patch);
        if (!found) throw new Error(`No patch matching "${patch}". Call list_patches.`);
        return {
          id: found.id,
          name: found.name,
          instrument: found.instrumentType,
          params: found.params,
          effects: found.effects,
        };
      },
    }),

    defineTool({
      name: "apply_patch",
      description:
        "Create a new track from a saved patch (by id or name), with its instrument, params, and effect chain.",
      schema: z.object({ patch: z.string(), name: z.string().optional() }),
      run: ({ patch, name }) => {
        const found = findPatch(patch);
        if (!found) throw new Error(`No patch matching "${patch}". Call list_patches.`);
        const id = newTrackId();
        dispatch(
          {
            type: "createTrackFromPatch",
            id,
            name: name ?? found.name,
            instrumentType: found.instrumentType,
            params: found.params,
            effects: found.effects.map((effect) => ({
              id: newEffectId(),
              type: effect.type,
              bypassed: effect.bypassed,
              params: effect.params,
            })),
          },
          "agent",
        );
        return { ok: true, trackId: id, patch: found.name };
      },
    }),

    defineTool({
      name: "save_patch",
      description:
        "Save a track's current instrument + params + effect chain as a reusable patch (defaults to the selected track).",
      schema: z.object({ name: z.string().min(1), track: z.string().optional() }),
      run: ({ name, track }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        const id = newPatchId();
        savePatch({
          id,
          name,
          author: "agent",
          instrumentType: instrumentTrack.instrumentType,
          params: instrumentTrack.params.snapshot(),
          effects: instrumentTrack.effects.map((effect) => ({
            type: effect.type,
            bypassed: effect.bypassed,
            params: effect.params.snapshot(),
          })),
          createdAt: Date.now(),
        });
        return { ok: true, patchId: id, name };
      },
    }),
  ];
}

// --- Drum-pad helpers for list_parameters -------------------------------------------
// A pad-based instrument (the drum kit) declares `pad{n}.sample` / `pad{n}.note` params.
// These read that shape generically (by id pattern), so nothing hardcodes "drumkit": any
// instrument with pads gets the same concise map, and instruments without pads get none.

const PAD_ID = /^pad(\d+)\./;
const PAD_SAMPLE_ID = /^pad(\d+)\.sample$/;

/** Pad numbers whose sample slot is filled (an empty pad makes no sound, so it is noise). */
function loadedPadNumbers(specs: readonly ParamSpec[], params: ParamStore): Set<number> {
  const loaded = new Set<number>();
  for (const spec of specs) {
    const match = PAD_SAMPLE_ID.exec(spec.id);
    if (!match) continue;
    const value = params.get(spec.id);
    if (typeof value === "string" && value !== "") loaded.add(Number(match[1]));
  }
  return loaded;
}

/** True for a pad param whose pad is not loaded (so list_parameters can skip it). */
function isUnusedPadParam(id: string, loadedPads: Set<number>): boolean {
  const match = PAD_ID.exec(id);
  return match !== null && !loadedPads.has(Number(match[1]));
}

/** The loaded pads as { pad, note, noteName, sound }, ascending by pad. */
function padMap(loadedPads: Set<number>, params: ParamStore, projectStore: ProjectStore) {
  return [...loadedPads]
    .sort((a, b) => a - b)
    .map((pad) => {
      const note = params.get(`pad${pad}.note`);
      const sample = params.get(`pad${pad}.sample`);
      const midi = typeof note === "number" ? note : 0;
      return {
        pad,
        note: midi,
        noteName: pitchName(midi),
        sound: soundName(typeof sample === "string" ? sample : "", projectStore),
      };
    });
}

/** A readable name for a sample ref (built-in kit name or imported asset name); the raw
 *  ref if it resolves to neither. */
function soundName(ref: string, projectStore: ProjectStore): string {
  const builtin = BUILTIN_SAMPLES.find((sample) => builtinRef(sample.id) === ref);
  if (builtin) return builtin.name;
  const asset = projectStore.getSamples().find((sample) => assetRef(sample.id) === ref);
  return asset?.name ?? ref;
}

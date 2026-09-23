/**
 * The patch library as the MCP tools see it: summaries, one patch in full, and the edit that makes a
 * track from one. Shared by the browser bridge and the hosted MCP server (AGENT-28), so both answer
 * `list_patches` / `get_patch` / `apply_patch` the same way. Pure: user patches come from whatever
 * `allPatches` can reach, which on the server is the factory bank alone.
 */
import type { EditCommand } from "../commands/types";
import { newEffectId, newMidiDeviceId, newTrackId } from "../commands/ids";
import { allPatches, findPatch } from "./factory";

export const listPatchSummaries = () =>
  allPatches().map((patch) => ({
    id: patch.id,
    name: patch.name,
    author: patch.author,
    instrument: patch.instrumentType,
    builtin: patch.builtin ?? false,
    category: patch.category,
    effects: patch.effects.map((effect) => effect.type),
  }));

const requirePatch = (query: string) => {
  const patch = findPatch(query.trim());
  if (!patch) throw new Error(`No patch matching "${query.trim()}". Use list_patches.`);
  return patch;
};

/** Full specifics of one patch (param values + per-device params), searched by id or name. */
export const patchDetails = (query: string) => {
  const patch = requirePatch(query);
  return {
    id: patch.id,
    name: patch.name,
    author: patch.author,
    instrument: patch.instrumentType,
    builtin: patch.builtin ?? false,
    category: patch.category,
    params: patch.params,
    midiDevices: (patch.midiDevices ?? []).map((device) => ({
      type: device.type,
      bypassed: device.bypassed ?? false,
      params: device.params,
    })),
    effects: patch.effects.map((effect) => ({
      type: effect.type,
      bypassed: effect.bypassed ?? false,
      params: effect.params,
    })),
  };
};

/** The edit that creates a track from a patch. Ids are minted here and carried, so it replays exactly. */
export const patchTrackCommand = (
  query: string,
  name?: string,
): Extract<EditCommand, { type: "createTrackFromPatch" }> => {
  const patch = requirePatch(query);
  return {
    type: "createTrackFromPatch",
    id: newTrackId(),
    name: name?.trim() || patch.name,
    instrumentType: patch.instrumentType,
    params: patch.params,
    midiDevices: (patch.midiDevices ?? []).map((device) => ({
      id: newMidiDeviceId(),
      type: device.type,
      bypassed: device.bypassed,
      params: device.params,
    })),
    effects: patch.effects.map((effect) => ({
      id: newEffectId(),
      type: effect.type,
      bypassed: effect.bypassed,
      params: effect.params,
    })),
  };
};

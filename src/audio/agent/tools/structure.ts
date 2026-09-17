/**
 * Structural tools: tracks and groups (the bus tree), plus selection. Reads come off
 * the project store; edits dispatch as "agent". Selecting is navigation (a direct store
 * call), not a durable edit.
 */
import { z } from "zod";
import type { AgentTool } from "../types";
import { defineTool, type ToolContext } from "./factory";
import { newGroupId, newTrackId } from "../../commands/ids";
import { hasInstrument, pickableInstrumentInfos } from "../../instruments/catalog";

export function structureTools(ctx: ToolContext): AgentTool[] {
  const { projectStore, dispatch, resolveTrack } = ctx;
  const instrumentTypes = () => pickableInstrumentInfos().map((info) => info.type);

  return [
    defineTool({
      name: "list_tracks",
      description:
        "List the project's tracks (id, name, kind, instrument, group) plus tempo, length, groove, the selected track, and the instrument palette you can create from. Call this first to learn track ids.",
      schema: z.object({}),
      run: () => ({
        tempoBpm: projectStore.tempo,
        lengthBeats: projectStore.length,
        loopStartBeats: projectStore.loopStart,
        groove: projectStore.getGroove(),
        selectedTrackId: projectStore.selectedId,
        instruments: pickableInstrumentInfos().map((info) => ({
          type: info.type,
          label: info.label,
          family: info.family,
        })),
        tracks: projectStore.getTracks().map((track) => ({
          id: track.id,
          name: track.name,
          kind: track.kind,
          instrument: track.kind === "instrument" ? track.instrumentType : undefined,
          groupId: track.parentId,
          muted: track.muted,
          solo: track.solo,
          volume: track.volume,
          clips: track.clips.length,
          placements: track.placements.length,
        })),
      }),
    }),

    defineTool({
      name: "create_track",
      description: "Create a new instrument track. `instrument` must be one of the palette types from list_tracks.",
      schema: z.object({ instrument: z.string(), name: z.string().optional(), group: z.string().optional() }),
      run: ({ instrument, name, group }) => {
        if (!hasInstrument(instrument)) {
          throw new Error(`Unknown instrument "${instrument}". Valid: ${instrumentTypes().join(", ")}.`);
        }
        const id = newTrackId();
        dispatch({ type: "createTrack", instrumentType: instrument, name, id, groupId: group }, "agent");
        return { ok: true, trackId: id, instrument, name: name ?? null };
      },
    }),

    defineTool({
      name: "remove_track",
      description: "Delete a track (defaults to the selected track).",
      schema: z.object({ track: z.string().optional() }),
      run: ({ track }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "removeTrack", trackId: resolved.id }, "agent");
        return { ok: true, trackId: resolved.id };
      },
    }),

    defineTool({
      name: "move_track",
      description: "Move a track into a group (get group ids from list_groups).",
      schema: z.object({ track: z.string().optional(), group: z.string() }),
      run: ({ track, group }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "moveTrack", trackId: resolved.id, groupId: group }, "agent");
        return { ok: true, trackId: resolved.id, groupId: group };
      },
    }),

    defineTool({
      name: "rename_track",
      description: "Rename a track (defaults to the selected track).",
      schema: z.object({ track: z.string().optional(), name: z.string().min(1) }),
      run: ({ track, name }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "setTrack", trackId: resolved.id, name }, "agent");
        return { ok: true, trackId: resolved.id, name };
      },
    }),

    defineTool({
      name: "mix_track",
      description:
        "Adjust a track's mix: volume (0..1), mute, or solo (defaults to the selected track). Omit a field to leave it unchanged.",
      schema: z.object({
        track: z.string().optional(),
        volume: z.number().min(0).max(1).optional(),
        muted: z.boolean().optional(),
        solo: z.boolean().optional(),
      }),
      run: ({ track, volume, muted, solo }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "setTrack", trackId: resolved.id, volume, muted, solo }, "agent");
        return { ok: true, trackId: resolved.id, volume, muted, solo };
      },
    }),

    defineTool({
      name: "select_track",
      description: "Focus a track in the UI (so the user sees it and unqualified edits target it).",
      schema: z.object({ track: z.string() }),
      run: ({ track }) => {
        const resolved = resolveTrack(track);
        projectStore.selectTrack(resolved.id);
        return { ok: true, trackId: resolved.id };
      },
    }),

    defineTool({
      name: "list_groups",
      description:
        "List the group buses (id, name, parent). Tracks live inside groups; a null parent is the top level.",
      schema: z.object({}),
      run: () => ({
        groups: projectStore.getGroups().map((group) => ({
          id: group.id,
          name: group.name,
          parentId: group.parentId,
          muted: group.muted,
          solo: group.solo,
          volume: group.volume,
        })),
      }),
    }),

    defineTool({
      name: "create_group",
      description: "Create a group bus. `parent` is an optional parent group id (omit for the top level).",
      schema: z.object({ name: z.string().optional(), parent: z.string().optional() }),
      run: ({ name, parent }) => {
        const id = newGroupId();
        dispatch({ type: "createGroup", id, name, parentId: parent ?? null }, "agent");
        return { ok: true, groupId: id, name: name ?? null };
      },
    }),

    defineTool({
      name: "remove_group",
      description: "Delete a group bus by id.",
      schema: z.object({ group: z.string() }),
      run: ({ group }) => {
        dispatch({ type: "removeGroup", groupId: group }, "agent");
        return { ok: true, groupId: group };
      },
    }),

    defineTool({
      name: "set_group",
      description:
        "Rename or adjust a group bus: name, volume (0..1), mute, solo, collapsed. Omit a field to leave it.",
      schema: z.object({
        group: z.string(),
        name: z.string().optional(),
        volume: z.number().min(0).max(1).optional(),
        muted: z.boolean().optional(),
        solo: z.boolean().optional(),
        collapsed: z.boolean().optional(),
      }),
      run: ({ group, name, volume, muted, solo, collapsed }) => {
        dispatch({ type: "setGroup", groupId: group, name, volume, muted, solo, collapsed }, "agent");
        return { ok: true, groupId: group };
      },
    }),

    defineTool({
      name: "move_group",
      description: "Reparent a group bus. `parent` is the new parent group id, or omit for the top level.",
      schema: z.object({ group: z.string(), parent: z.string().optional() }),
      run: ({ group, parent }) => {
        dispatch({ type: "moveGroup", groupId: group, parentId: parent ?? null }, "agent");
        return { ok: true, groupId: group, parentId: parent ?? null };
      },
    }),
  ];
}

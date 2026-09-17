/**
 * Clip + arrangement tools: the notes inside a clip, the clip pool per track, and the
 * placements that lay clips out on the timeline (all in beats, 4 beats = 1 bar). Reads
 * come off the project store; edits dispatch as "agent". Selecting a clip is navigation
 * (a direct store call), not a durable edit.
 */
import { z } from "zod";
import type { AgentTool } from "../types";
import type { NoteEvent } from "../../sequencer/types";
import { defineTool, noteInput, type ToolContext } from "./factory";
import { newClipId, newNoteId, newPlacementId } from "../../commands/ids";

export function clipTools(ctx: ToolContext): AgentTool[] {
  const { projectStore, dispatch, resolveTrack, resolveInstrumentTrack } = ctx;

  return [
    defineTool({
      name: "list_notes",
      description: "List the note events in a track's clip (defaults to the selected track and its active clip).",
      schema: z.object({ track: z.string().optional(), clip: z.string().optional() }),
      run: ({ track, clip }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        const clipStore = projectStore.getClipStore(instrumentTrack.id, clip);
        if (!clipStore) throw new Error(`Track "${instrumentTrack.id}" has no clip to read.`);
        const { notes, lengthBeats } = clipStore.getClip();
        return {
          trackId: instrumentTrack.id,
          lengthBeats,
          notes: notes.map((note) => ({
            id: note.id,
            pitch: note.pitch,
            start: note.start,
            length: note.length,
            velocity: note.velocity,
          })),
        };
      },
    }),

    defineTool({
      name: "add_notes",
      description:
        "Add one or more notes to a track's clip in a single edit (defaults to the selected track / active clip). Times in beats.",
      schema: z.object({
        track: z.string().optional(),
        clip: z.string().optional(),
        notes: z.array(noteInput).min(1).max(512),
      }),
      run: ({ track, clip, notes }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        const built: NoteEvent[] = notes.map((note) => ({
          id: newNoteId(),
          pitch: note.pitch,
          start: note.start,
          length: note.length ?? 1,
          velocity: note.velocity ?? 0.8,
        }));
        dispatch({ type: "addNotes", trackId: instrumentTrack.id, clipId: clip, notes: built }, "agent");
        return { ok: true, added: built.length, trackId: instrumentTrack.id };
      },
    }),

    defineTool({
      name: "edit_notes",
      description:
        "Move or resize existing notes: pass each note's id from list_notes plus the new pitch/start/length/velocity. Inserts if the id is new.",
      schema: z.object({
        track: z.string().optional(),
        clip: z.string().optional(),
        notes: z
          .array(noteInput.extend({ id: z.string() }))
          .min(1)
          .max(512),
      }),
      run: ({ track, clip, notes }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        const edited: NoteEvent[] = notes.map((note) => ({
          id: note.id,
          pitch: note.pitch,
          start: note.start,
          length: note.length ?? 1,
          velocity: note.velocity ?? 0.8,
        }));
        dispatch({ type: "editNotes", trackId: instrumentTrack.id, clipId: clip, notes: edited }, "agent");
        return { ok: true, edited: edited.length, trackId: instrumentTrack.id };
      },
    }),

    defineTool({
      name: "remove_notes",
      description: "Remove notes by id from a track's clip (get ids from list_notes).",
      schema: z.object({ track: z.string().optional(), clip: z.string().optional(), ids: z.array(z.string()).min(1) }),
      run: ({ track, clip, ids }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        dispatch({ type: "removeNotes", trackId: instrumentTrack.id, clipId: clip, ids }, "agent");
        return { ok: true, removed: ids.length, trackId: instrumentTrack.id };
      },
    }),

    defineTool({
      name: "clear_clip",
      description: "Remove every note from a clip (defaults to the selected track / active clip).",
      schema: z.object({ track: z.string().optional(), clip: z.string().optional() }),
      run: ({ track, clip }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        dispatch({ type: "clearClip", trackId: instrumentTrack.id, clipId: clip }, "agent");
        return { ok: true, trackId: instrumentTrack.id };
      },
    }),

    defineTool({
      name: "set_clip_length",
      description: "Set a clip's length in beats (defaults to the selected track / active clip).",
      schema: z.object({
        track: z.string().optional(),
        clip: z.string().optional(),
        lengthBeats: z.number().positive(),
      }),
      run: ({ track, clip, lengthBeats }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        dispatch({ type: "setClipLength", trackId: instrumentTrack.id, clipId: clip, lengthBeats }, "agent");
        return { ok: true, trackId: instrumentTrack.id, lengthBeats };
      },
    }),

    defineTool({
      name: "list_clips",
      description:
        "List a track's clip pool (id, name, author) and which clip is active (defaults to the selected track).",
      schema: z.object({ track: z.string().optional() }),
      run: ({ track }) => {
        const resolved = resolveTrack(track);
        return {
          trackId: resolved.id,
          activeClipId: resolved.activeClipId,
          clips: resolved.clips.map((clip) => ({ id: clip.id, name: clip.name, author: clip.author })),
        };
      },
    }),

    defineTool({
      name: "add_clip",
      description:
        "Add a clip to a track's pool. Empty by default; pass `from` (a clip id) to duplicate it, or `length_beats` for a new empty clip.",
      schema: z.object({
        track: z.string().optional(),
        name: z.string().optional(),
        from: z.string().optional(),
        length_beats: z.number().positive().optional(),
      }),
      run: ({ track, name, from, length_beats }) => {
        const resolved = resolveTrack(track);
        const id = newClipId();
        dispatch(
          {
            type: "addClip",
            trackId: resolved.id,
            id,
            name,
            fromClipId: from,
            empty: from === undefined,
            lengthBeats: length_beats,
          },
          "agent",
        );
        return { ok: true, trackId: resolved.id, clipId: id };
      },
    }),

    defineTool({
      name: "remove_clip",
      description: "Remove a clip from a track's pool by id.",
      schema: z.object({ track: z.string().optional(), clip_id: z.string() }),
      run: ({ track, clip_id }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "removeClip", trackId: resolved.id, clipId: clip_id }, "agent");
        return { ok: true, trackId: resolved.id, clipId: clip_id };
      },
    }),

    defineTool({
      name: "rename_clip",
      description: "Rename a clip in a track's pool.",
      schema: z.object({ track: z.string().optional(), clip_id: z.string(), name: z.string().min(1) }),
      run: ({ track, clip_id, name }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "renameClip", trackId: resolved.id, clipId: clip_id, name }, "agent");
        return { ok: true, trackId: resolved.id, clipId: clip_id, name };
      },
    }),

    defineTool({
      name: "select_clip",
      description: "Make a clip the active clip of its track (the one shown/edited by default).",
      schema: z.object({ track: z.string().optional(), clip_id: z.string() }),
      run: ({ track, clip_id }) => {
        const resolved = resolveTrack(track);
        projectStore.selectClip(resolved.id, clip_id);
        return { ok: true, trackId: resolved.id, clipId: clip_id };
      },
    }),

    defineTool({
      name: "list_placements",
      description:
        "List where a track's clips are laid out on the timeline (placement id, clip id, start/offset/length in beats).",
      schema: z.object({ track: z.string().optional() }),
      run: ({ track }) => {
        const resolved = resolveTrack(track);
        return {
          trackId: resolved.id,
          placements: resolved.placements.map((placement) => ({
            id: placement.id,
            clipId: placement.clipId,
            startBeat: placement.startBeat,
            offset: placement.offset,
            length: placement.length,
          })),
        };
      },
    }),

    defineTool({
      name: "add_placement",
      description:
        "Place a clip on the track's timeline at `start_beat` (defaults to the active clip). `length` in beats is optional.",
      schema: z.object({
        track: z.string().optional(),
        start_beat: z.number().min(0),
        clip: z.string().optional(),
        length: z.number().positive().optional(),
      }),
      run: ({ track, start_beat, clip, length }) => {
        const resolved = resolveTrack(track);
        const id = newPlacementId();
        dispatch(
          { type: "addPlacement", trackId: resolved.id, id, clipId: clip, startBeat: start_beat, length },
          "agent",
        );
        return { ok: true, trackId: resolved.id, placementId: id };
      },
    }),

    defineTool({
      name: "move_placement",
      description: "Move a placement to a new start beat (get placement ids from list_placements).",
      schema: z.object({ track: z.string().optional(), placement_id: z.string(), start_beat: z.number().min(0) }),
      run: ({ track, placement_id, start_beat }) => {
        const resolved = resolveTrack(track);
        dispatch(
          { type: "movePlacement", trackId: resolved.id, placementId: placement_id, startBeat: start_beat },
          "agent",
        );
        return { ok: true, trackId: resolved.id, placementId: placement_id, startBeat: start_beat };
      },
    }),

    defineTool({
      name: "remove_placement",
      description: "Remove a placement from the timeline (the clip stays in the pool).",
      schema: z.object({ track: z.string().optional(), placement_id: z.string() }),
      run: ({ track, placement_id }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "removePlacement", trackId: resolved.id, placementId: placement_id }, "agent");
        return { ok: true, trackId: resolved.id, placementId: placement_id };
      },
    }),

    defineTool({
      name: "launch_clip",
      description: "Launch a clip on a track for session-style looping playback, or pass no clip to stop that track.",
      schema: z.object({ track: z.string().optional(), clip_id: z.string().nullable().optional() }),
      run: ({ track, clip_id }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "launchClip", trackId: resolved.id, clipId: clip_id ?? null }, "agent");
        return { ok: true, trackId: resolved.id, clipId: clip_id ?? null };
      },
    }),

    defineTool({
      name: "stop_all_clips",
      description: "Stop all session-launched clips.",
      schema: z.object({}),
      run: () => {
        dispatch({ type: "stopAllClips" }, "agent");
        return { ok: true };
      },
    }),
  ];
}

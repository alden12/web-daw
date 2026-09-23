/** MCP tools: Clip notes. */
import { z } from "zod";
import type { NoteEvent } from "../../../src/audio/sequencer/types";
import { GRID_DIVISIONS, beatsForGrid, quantizeNotes } from "../../../src/audio/sequencer/quantize";
import { randomId, ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerClipNotesTools({ server, target, trackArg, resolveInstrumentTrack }: ToolContext): void {
  // Note tools edit one clip in the track's pool - the active clip, or `clip` if given.
  const noteShape = {
    pitch: z.number().int().min(0).max(127),
    start: z.number().min(0).describe("onset in beats (4 beats = 1 bar)"),
    length: z.number().min(0).optional().describe("duration in beats (default 1)"),
    velocity: z.number().min(0).max(1).optional(),
  };
  const clipArg = { clip: z.string().optional().describe("clip id (see list_clips); defaults to the active clip") };
  const makeNote = (n: { pitch: number; start: number; length?: number; velocity?: number }): NoteEvent => ({
    id: randomId(),
    pitch: n.pitch,
    start: n.start,
    length: n.length ?? 1,
    velocity: n.velocity ?? 0.8,
  });
  /** Resolve an instrument track + the target clip store (active or `clip`). */
  const resolveClip = (track?: string, clip?: string) => {
    const r = resolveInstrumentTrack(track);
    if ("error" in r) return r;
    const store = target.project.getClipStore(r.id, clip);
    if (!store) return { error: `Unknown clip "${clip}" on ${r.id}.` };
    return { id: r.id, track: r.track, store };
  };

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "Return a clip's notes (id, pitch, start/length in beats, velocity).",
      inputSchema: { ...trackArg, ...clipArg },
    },
    async ({ track, clip }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      return ok(JSON.stringify({ track: r.id, clip: r.store.getClip() }, null, 2));
    },
  );

  server.registerTool(
    "add_note",
    {
      title: "Add note",
      description: "Add one note to a clip. Times in beats. Returns the note id.",
      inputSchema: { ...trackArg, ...clipArg, ...noteShape },
    },
    async ({ track, clip, pitch, start, length, velocity }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      const note = makeNote({ pitch, start, length, velocity });
      if (!target.send({ type: "addNote", trackId: r.id, clipId: clip, note })) return fail("No DAW tab connected.");
      r.store.putNote(note);
      return ok(`Added note ${pitch} at beat ${start} to ${r.id} (id ${note.id}).`);
    },
  );

  server.registerTool(
    "add_notes",
    {
      title: "Add notes",
      description: "Add many notes to a clip at once (write a whole part). Times in beats.",
      inputSchema: { ...trackArg, ...clipArg, notes: z.array(z.object(noteShape)).min(1).max(512) },
    },
    async ({ track, clip, notes }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      // One addNotes message = one feed entry + one undo step (not one per note).
      const made = notes.map(makeNote);
      if (!target.send({ type: "addNotes", trackId: r.id, clipId: clip, notes: made }))
        return fail("No DAW tab connected.");
      for (const note of made) r.store.putNote(note);
      return ok(`Added ${made.length} notes to ${r.id}.`);
    },
  );

  server.registerTool(
    "edit_notes",
    {
      title: "Edit notes",
      description: "Move / resize / re-velocity existing notes in place, by id, in one atomic edit. Times in beats.",
      inputSchema: {
        ...trackArg,
        ...clipArg,
        notes: z
          .array(z.object({ id: z.string(), ...noteShape }))
          .min(1)
          .max(512),
      },
    },
    async ({ track, clip, notes }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      const edited: NoteEvent[] = notes.map((n) => ({ ...makeNote(n), id: n.id }));
      if (!target.send({ type: "editNotes", trackId: r.id, clipId: clip, notes: edited }))
        return fail("No DAW tab connected.");
      for (const note of edited) r.store.putNote(note);
      return ok(`Edited ${edited.length} notes on ${r.id}.`);
    },
  );

  server.registerTool(
    "quantize",
    {
      title: "Quantize",
      description:
        "Pull a clip's note timings toward a grid. Quantizes the given note ids, or the whole clip if none are given. Applied as one atomic edit.",
      inputSchema: {
        ...trackArg,
        ...clipArg,
        grid: z
          .enum(GRID_DIVISIONS.map((division) => division.label) as [string, ...string[]])
          .optional()
          .describe("grid resolution (default 1/16)"),
        strength: z.number().min(0).max(1).optional().describe("0 = no change, 1 = full snap (default 1)"),
        ends: z.boolean().optional().describe("also snap note ends, so lengths land on the grid (default false)"),
        ids: z.array(z.string()).optional().describe("note ids to quantize; omit to quantize the whole clip"),
      },
    },
    async ({ track, clip, grid, strength, ends, ids }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      const all = r.store.getClip().notes;
      const targets = ids?.length ? all.filter((note) => ids.includes(note.id)) : all;
      if (!targets.length) return fail("No notes to quantize.");
      const notes = quantizeNotes(targets, {
        gridBeats: beatsForGrid(grid ?? "1/16"),
        strength: strength ?? 1,
        ends: ends ?? false,
      });
      if (!target.send({ type: "editNotes", trackId: r.id, clipId: clip, notes })) return fail("No DAW tab connected.");
      for (const note of notes) r.store.putNote(note);
      return ok(`Quantized ${notes.length} notes on ${r.id} to ${grid ?? "1/16"}.`);
    },
  );

  server.registerTool(
    "remove_note",
    {
      title: "Remove note",
      description: "Remove a note from a clip by id.",
      inputSchema: { ...trackArg, ...clipArg, id: z.string() },
    },
    async ({ track, clip, id }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "removeNote", trackId: r.id, clipId: clip, id })) return fail("No DAW tab connected.");
      r.store.removeNote(id);
      return ok(`Removed note ${id} from ${r.id}.`);
    },
  );

  server.registerTool(
    "remove_notes",
    {
      title: "Remove notes",
      description: "Remove many notes from a clip by id, in one atomic edit.",
      inputSchema: { ...trackArg, ...clipArg, ids: z.array(z.string()).min(1).max(512) },
    },
    async ({ track, clip, ids }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "removeNotes", trackId: r.id, clipId: clip, ids })) return fail("No DAW tab connected.");
      for (const id of ids) r.store.removeNote(id);
      return ok(`Removed ${ids.length} notes from ${r.id}.`);
    },
  );

  server.registerTool(
    "clear_clip",
    { title: "Clear clip", description: "Remove all notes from a clip.", inputSchema: { ...trackArg, ...clipArg } },
    async ({ track, clip }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "clearClip", trackId: r.id, clipId: clip })) return fail("No DAW tab connected.");
      r.store.clear();
      return ok(`Cleared clip on ${r.id}.`);
    },
  );

  server.registerTool(
    "set_clip_length",
    {
      title: "Set clip length",
      description: "Set a clip's pattern length in beats (clamps notes past the end).",
      inputSchema: { ...trackArg, ...clipArg, lengthBeats: z.number().min(0.25).max(256) },
    },
    async ({ track, clip, lengthBeats }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "setClipLength", trackId: r.id, clipId: clip, lengthBeats }))
        return fail("No DAW tab connected.");
      r.store.setLength(lengthBeats);
      return ok(`Set clip length to ${lengthBeats} beats on ${r.id}.`);
    },
  );
}

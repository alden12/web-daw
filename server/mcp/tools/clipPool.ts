/** MCP tools: Clip pool. */
import { z } from "zod";
import { UNATTRIBUTED_AGENT } from "../../../src/audio/commands/authors";
import { makeClipId, ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerClipPoolTools({
  server,
  target,
  trackArg,
  resolveTrack,
  resolveInstrumentTrack,
}: ToolContext): void {
  // A track owns a pool of note clips (patterns); the active one is edited by the
  // note tools and shown in the roll. Arrange them along time with the placement
  // tools below. Clips you create are tagged as the agent.
  const clipIdArg = { clip_id: z.string().describe("clip id (see list_clips)") };

  server.registerTool(
    "list_clips",
    {
      title: "List clips",
      description: "Return a track's clip pool (id, name, author) and which is active.",
      inputSchema: trackArg,
    },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      return ok(
        JSON.stringify(
          {
            track: r.id,
            activeClipId: r.track.activeClipId,
            clips: r.track.clips.map((c) => ({ id: c.id, name: c.name, author: c.author })),
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    "add_clip",
    {
      title: "Add clip",
      description:
        "Add a note clip to a track and make it active. Defaults to copying `from` (or the active clip); pass `empty` for a fresh clip with no notes. `length_beats` sets the pattern length. Returns the new clip id.",
      inputSchema: {
        ...trackArg,
        name: z.string().optional(),
        from: z.string().optional().describe("clip id to copy; defaults to active"),
        empty: z.boolean().optional().describe("start with no notes instead of copying"),
        length_beats: z.number().positive().optional().describe("pattern length in beats"),
      },
    },
    async ({ track, name, from, empty, length_beats }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      const id = makeClipId();
      const msg = {
        type: "addClip" as const,
        trackId: r.id,
        id,
        name,
        fromClipId: from,
        empty,
        lengthBeats: length_beats,
      };
      if (!target.send(msg)) return fail("No DAW tab connected.");
      // The mirror is this server's read-back copy; the real edit is authored in the tab, which is
      // the only side that knows which user is driving the agent. So the shadow stamp is an agent
      // with no driver recorded rather than a guess at one.
      target.project.addClip(r.id, {
        id,
        name,
        fromClipId: from,
        empty,
        lengthBeats: length_beats,
        author: UNATTRIBUTED_AGENT,
      });
      return ok(`Added clip on ${r.id} (id ${id}); it is now active.`);
    },
  );

  server.registerTool(
    "select_clip",
    {
      title: "Select clip",
      description: "Make a clip active (shown/edited in the roll).",
      inputSchema: { ...trackArg, ...clipIdArg },
    },
    async ({ track, clip_id }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!r.track.clips.some((c) => c.id === clip_id)) return fail(`Unknown clip "${clip_id}" on ${r.id}.`);
      if (!target.send({ type: "selectClip", trackId: r.id, clipId: clip_id })) return fail("No DAW tab connected.");
      target.project.selectClip(r.id, clip_id);
      return ok(`Selected clip ${clip_id} on ${r.id}.`);
    },
  );

  server.registerTool(
    "remove_clip",
    {
      title: "Remove clip",
      description: "Delete a clip and its placements (a track must keep at least one).",
      inputSchema: { ...trackArg, ...clipIdArg },
    },
    async ({ track, clip_id }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (r.track.clips.length <= 1) return fail(`Track ${r.id} has only one clip; cannot remove it.`);
      if (!r.track.clips.some((c) => c.id === clip_id)) return fail(`Unknown clip "${clip_id}" on ${r.id}.`);
      if (!target.send({ type: "removeClip", trackId: r.id, clipId: clip_id })) return fail("No DAW tab connected.");
      target.project.removeClip(r.id, clip_id);
      return ok(`Removed clip ${clip_id} from ${r.id}.`);
    },
  );

  server.registerTool(
    "rename_clip",
    {
      title: "Rename clip",
      description: "Rename a clip.",
      inputSchema: { ...trackArg, ...clipIdArg, name: z.string().min(1) },
    },
    async ({ track, clip_id, name }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!r.track.clips.some((c) => c.id === clip_id)) return fail(`Unknown clip "${clip_id}" on ${r.id}.`);
      if (!target.send({ type: "renameClip", trackId: r.id, clipId: clip_id, name }))
        return fail("No DAW tab connected.");
      target.project.renameClip(r.id, clip_id, name);
      return ok(`Renamed clip ${clip_id} to "${name}" on ${r.id}.`);
    },
  );
}

/** MCP tools: Arrangement placements. */
import { z } from "zod";
import { makePlacementId, ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerPlacementsTools({ server, target, trackArg, resolveTrack }: ToolContext): void {
  server.registerTool(
    "list_placements",
    {
      title: "List placements",
      description: "Return a track's arrangement placements (id, clipId, startBeat, offset, length).",
      inputSchema: trackArg,
    },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      return ok(JSON.stringify({ track: r.id, placements: r.track.placements }, null, 2));
    },
  );

  server.registerTool(
    "add_placement",
    {
      title: "Add placement",
      description:
        "Place a clip on the arrangement at `start_beat` (clip defaults to the active one). Returns the placement id.",
      inputSchema: {
        ...trackArg,
        start_beat: z.number().min(0),
        clip: z.string().optional(),
        length: z.number().min(0.25).optional(),
      },
    },
    async ({ track, start_beat, clip, length }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      const id = makePlacementId();
      const clipId = clip ?? r.track.activeClipId;
      if (!target.send({ type: "addPlacement", trackId: r.id, id, clipId, startBeat: start_beat, length }))
        return fail("No DAW tab connected.");
      target.project.addPlacement(r.id, { id, clipId, startBeat: start_beat, length });
      return ok(`Placed clip ${clipId} at beat ${start_beat} on ${r.id} (id ${id}).`);
    },
  );

  server.registerTool(
    "move_placement",
    {
      title: "Move placement",
      description: "Move a placement to a new start beat.",
      inputSchema: { ...trackArg, placement_id: z.string(), start_beat: z.number().min(0) },
    },
    async ({ track, placement_id, start_beat }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "movePlacement", trackId: r.id, placementId: placement_id, startBeat: start_beat }))
        return fail("No DAW tab connected.");
      target.project.movePlacement(r.id, placement_id, start_beat);
      return ok(`Moved placement ${placement_id} to beat ${start_beat} on ${r.id}.`);
    },
  );

  server.registerTool(
    "remove_placement",
    {
      title: "Remove placement",
      description: "Remove a placement from the arrangement (the clip stays in the pool).",
      inputSchema: { ...trackArg, placement_id: z.string() },
    },
    async ({ track, placement_id }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "removePlacement", trackId: r.id, placementId: placement_id }))
        return fail("No DAW tab connected.");
      target.project.removePlacement(r.id, placement_id);
      return ok(`Removed placement ${placement_id} from ${r.id}.`);
    },
  );

  server.registerTool(
    "split_placement",
    {
      title: "Split placement",
      description: "Split a placement at an absolute beat into two regions over the same clip.",
      inputSchema: { ...trackArg, placement_id: z.string(), at_beat: z.number().min(0) },
    },
    async ({ track, placement_id, at_beat }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      const newId = makePlacementId();
      if (!target.send({ type: "splitPlacement", trackId: r.id, placementId: placement_id, atBeat: at_beat, newId }))
        return fail("No DAW tab connected.");
      target.project.splitPlacement(r.id, placement_id, at_beat, newId);
      return ok(`Split placement ${placement_id} at beat ${at_beat} on ${r.id}.`);
    },
  );

  server.registerTool(
    "launch_clip",
    {
      title: "Launch clip",
      description:
        "Launch a clip on a track: it loops over the transport, overriding the track's arrangement placements, until stopped. Pass clip_id to launch, or omit to stop this track's launched clip. Persisted as part of the composition.",
      inputSchema: { ...trackArg, clip_id: z.string().optional().describe("clip to launch; omit to stop") },
    },
    async ({ track, clip_id }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      const clipId = clip_id ?? null;
      if (!target.send({ type: "launchClip", trackId: r.id, clipId })) return fail("No DAW tab connected.");
      target.project.launchClip(r.id, clipId);
      return ok(
        clipId
          ? `Launched clip ${clipId} on ${r.id} (looping, overrides the arrangement).`
          : `Stopped the launched clip on ${r.id}.`,
      );
    },
  );

  server.registerTool(
    "stop_all_clips",
    {
      title: "Stop all clips",
      description: "Stop every launched clip - the whole project plays its arrangement again.",
      inputSchema: {},
    },
    async () => {
      if (!target.send({ type: "stopAllClips" })) return fail("No DAW tab connected.");
      target.project.stopAllClips();
      return ok("Stopped all launched clips; back to the timeline arrangement.");
    },
  );
}

/** MCP tools: Tracks. */
import { z } from "zod";
import { pickableInstrumentInfos, hasInstrument, instrumentFamily } from "../../../src/audio/instruments/catalog";
import { makeTrackId, ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerTracksTools({
  server,
  target,
  trackArg,
  resolveTrack,
  resolveGroup,
  familyGroup,
}: ToolContext): void {
  server.registerTool(
    "list_tracks",
    {
      title: "List tracks",
      description:
        "List all tracks (id, name, instrument, group, mute, volume, note count), the tempo, and the available instrument types (with their default group family).",
    },
    async () =>
      ok(
        JSON.stringify(
          {
            connected: target.connected(),
            tempoBpm: target.project.tempo,
            timeSignature: target.project.timeSignature,
            lengthBeats: target.project.length,
            selectedTrackId: target.project.selectedId,
            instruments: pickableInstrumentInfos().map((def) => ({
              id: def.type,
              label: def.label,
              family: def.family,
            })),
            tracks: target.project.getTracks().map((t) => ({
              id: t.id,
              name: t.name,
              kind: t.kind,
              instrument: t.kind === "instrument" ? t.instrumentType : undefined,
              group: t.parentId,
              muted: t.muted,
              solo: t.solo,
              volume: t.volume,
              clips: t.clips.length,
              placements: t.placements.length,
            })),
          },
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    "create_track",
    {
      title: "Create track",
      description:
        "Create a track with the given instrument type (see list_tracks for ids). Files it into the given group, or the instrument's default family group (created if needed). Returns the new track id.",
      inputSchema: {
        instrument: z.string(),
        name: z.string().optional(),
        group: z.string().optional().describe("group id to file into; defaults to the instrument's family group"),
      },
    },
    async ({ instrument, name, group }) => {
      if (!hasInstrument(instrument)) {
        return fail(
          `Unknown instrument "${instrument}". Options: ${pickableInstrumentInfos()
            .map((i) => i.type)
            .join(", ")}.`,
        );
      }
      if (!target.connected()) return fail("No DAW tab connected.");
      let groupId: string;
      if (group !== undefined) {
        const g = resolveGroup(group);
        if ("error" in g) return fail(g.error);
        groupId = g.id;
      } else {
        // Librarian: file into the instrument's family group, creating it if absent.
        const fam = familyGroup(instrumentFamily(instrument));
        groupId = fam.id;
        if (fam.created) {
          target.send({ type: "createGroup", id: fam.id, name: fam.name, parentId: null });
          target.project.addGroup({ id: fam.id, name: fam.name, parentId: null });
        }
      }
      const id = makeTrackId();
      target.send({ type: "createTrack", instrumentType: instrument, name, id, groupId });
      target.project.addTrack(instrument, { name, id, groupId });
      return ok(`Created ${instrument} track "${target.project.getTrack(id)?.name}" (id ${id}) in group ${groupId}.`);
    },
  );

  server.registerTool(
    "remove_track",
    { title: "Remove track", description: "Delete a track and its clip.", inputSchema: trackArg },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "removeTrack", trackId: r.id })) return fail("No DAW tab connected.");
      target.project.removeTrack(r.id);
      return ok(`Removed track ${r.id}.`);
    },
  );

  server.registerTool(
    "select_track",
    {
      title: "Select track",
      description: "Make a track the selected/default track.",
      inputSchema: { track: z.string() },
    },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "selectTrack", trackId: r.id })) return fail("No DAW tab connected.");
      target.project.selectTrack(r.id);
      return ok(`Selected track ${r.id}.`);
    },
  );
}

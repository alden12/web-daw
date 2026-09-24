/** MCP tools: Live notes. */
import { z } from "zod";
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerLiveNotesTools({
  server,
  target,
  trackArg,
  resolveInstrumentTrack,
  sequenceTimers,
  clearSequence,
}: ToolContext): void {
  server.registerTool(
    "note_on",
    {
      title: "Note on",
      description: "Start a held note on a track (MIDI 0-127, 60 = middle C).",
      inputSchema: {
        ...trackArg,
        midi: z.number().int().min(0).max(127),
        velocity: z.number().min(0).max(1).optional(),
      },
    },
    async ({ track, midi, velocity }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      return target.send({ type: "noteOn", trackId: r.id, midi, velocity })
        ? ok(`noteOn ${midi} on ${r.id}`)
        : fail("No DAW tab connected.");
    },
  );

  server.registerTool(
    "note_off",
    {
      title: "Note off",
      description: "Release a note on a track by its MIDI number.",
      inputSchema: { ...trackArg, midi: z.number().int().min(0).max(127) },
    },
    async ({ track, midi }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      return target.send({ type: "noteOff", trackId: r.id, midi })
        ? ok(`noteOff ${midi} on ${r.id}`)
        : fail("No DAW tab connected.");
    },
  );

  server.registerTool(
    "play_note",
    {
      title: "Play note",
      description: "Play a note on a track for a duration (ms, default 500).",
      inputSchema: {
        ...trackArg,
        midi: z.number().int().min(0).max(127),
        durationMs: z.number().min(1).max(20000).optional(),
        velocity: z.number().min(0).max(1).optional(),
      },
    },
    async ({ track, midi, durationMs, velocity }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "noteOn", trackId: r.id, midi, velocity })) return fail("No DAW tab connected.");
      const dur = durationMs ?? 500;
      setTimeout(() => target.send({ type: "noteOff", trackId: r.id, midi }), dur);
      return ok(`Played ${midi} for ${dur}ms on ${r.id}.`);
    },
  );

  server.registerTool(
    "play_sequence",
    {
      title: "Play sequence",
      description:
        "Play a monophonic melody on a track ad-hoc (not saved to the clip). For songs to keep, use add_notes + play.",
      inputSchema: {
        ...trackArg,
        notes: z
          .array(z.object({ midi: z.number().int().min(0).max(127), durationMs: z.number().min(1).max(20000) }))
          .min(1)
          .max(512),
        articulationMs: z.number().min(0).max(500).optional(),
      },
    },
    async ({ track, notes, articulationMs }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      if (!target.connected()) return fail("No DAW tab connected.");
      clearSequence();
      const gap = articulationMs ?? 30;
      let t = 0;
      for (const { midi, durationMs } of notes) {
        const start = t;
        sequenceTimers.push(setTimeout(() => target.send({ type: "noteOn", trackId: r.id, midi }), start));
        sequenceTimers.push(
          setTimeout(
            () => target.send({ type: "noteOff", trackId: r.id, midi }),
            start + Math.max(1, durationMs - gap),
          ),
        );
        t += durationMs;
      }
      return ok(`Playing ${notes.length} notes over ${t}ms on ${r.id}.`);
    },
  );
}

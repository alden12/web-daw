/** MCP tools: Transport (project-level). */
import { z } from "zod";
import { GROOVES, grooveById } from "../../../src/audio/grooves/catalog";
import { BUILTIN_SAMPLES, builtinRef, assetRef } from "../../../src/audio/samples/catalog";
import { timeSignatureSchema } from "../../../src/audio/project/schema";
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerTransportTools({ server, target }: ToolContext): void {
  server.registerTool(
    "set_tempo",
    {
      title: "Set tempo",
      description: "Set the project tempo in BPM (20-300).",
      inputSchema: { bpm: z.number().min(20).max(300) },
    },
    async ({ bpm }) => {
      if (!target.send({ type: "setTempo", bpm })) return fail("No DAW tab connected.");
      target.project.setTempo(bpm);
      return ok(`Tempo set to ${bpm} BPM.`);
    },
  );

  server.registerTool(
    "set_time_signature",
    {
      title: "Set time signature",
      description:
        "Set the project time signature: the numerator is the beats per bar; the denominator (a power of two, default 4) is the note that gets one beat - e.g. 3/4, 7/8, 5/16.",
      // Reuse the canonical time-signature schema so the tool's validation can't drift from it.
      inputSchema: {
        numerator: timeSignatureSchema.shape.numerator,
        denominator: timeSignatureSchema.shape.denominator.optional(),
      },
    },
    async ({ numerator, denominator }) => {
      const beatUnit = denominator ?? 4;
      if (!target.send({ type: "setTimeSignature", numerator, denominator: beatUnit }))
        return fail("No DAW tab connected.");
      target.project.setTimeSignature(numerator, beatUnit);
      return ok(`Time signature set to ${numerator}/${beatUnit}.`);
    },
  );

  server.registerTool(
    "set_groove",
    {
      title: "Set groove",
      description:
        "Set the project-wide groove (swing/feel) applied to all instrument tracks at playback, and/or its amount. Non-destructive - notes are untouched. Use list_grooves for ids.",
      inputSchema: {
        groove: z
          .enum(GROOVES.map((g) => g.id) as [string, ...string[]])
          .optional()
          .describe("groove id (see list_grooves); omit to change only the amount"),
        amount: z.number().min(0).max(1).optional().describe("how strongly the groove applies, 0..1 (default 1)"),
      },
    },
    async ({ groove, amount }) => {
      if (groove === undefined && amount === undefined) return fail("Pass a groove and/or an amount.");
      if (!target.send({ type: "setGroove", grooveId: groove, amount })) return fail("No DAW tab connected.");
      target.project.setGroove(groove, amount);
      const g = target.project.getGroove();
      return ok(`Groove: ${grooveById(g.id).name} at ${Math.round(g.amount * 100)}%.`);
    },
  );

  server.registerTool(
    "list_grooves",
    {
      title: "List grooves",
      description: "List the available groove templates (id + name) and the current selection.",
    },
    async () =>
      ok(
        JSON.stringify(
          { grooves: GROOVES.map((g) => ({ id: g.id, name: g.name })), current: target.project.getGroove() },
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    "list_samples",
    {
      title: "List samples",
      description:
        "List samples for the Sampler instrument: the built-in kit plus the project's imported library. Set a Sampler track's sample by calling set_parameter with param \"sampler.sample\" and one of these refs. Importing a new file is done in the app UI (the server can't read local files).",
    },
    async () =>
      ok(
        JSON.stringify(
          {
            builtin: BUILTIN_SAMPLES.map((sample) => ({ ref: builtinRef(sample.id), name: sample.name })),
            project: target.project.getSamples().map((sample) => ({ ref: assetRef(sample.id), name: sample.name })),
          },
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    "set_length",
    {
      title: "Set loop length",
      description: "Set the project loop length in beats (4 beats = 1 bar; 1-256). Clamps notes past the new end.",
      inputSchema: { lengthBeats: z.number().min(1).max(256) },
    },
    async ({ lengthBeats }) => {
      if (!target.send({ type: "setLength", lengthBeats })) return fail("No DAW tab connected.");
      target.project.setLength(lengthBeats);
      return ok(`Loop length set to ${lengthBeats} beats.`);
    },
  );

  server.registerTool(
    "set_loop_start",
    {
      title: "Set loop start",
      description: "Set the loop start in beats; playback loops the region [start, loop length]. 0 loops from the top.",
      inputSchema: { beats: z.number().min(0).max(256) },
    },
    async ({ beats }) => {
      if (!target.send({ type: "setLoopStart", beats })) return fail("No DAW tab connected.");
      target.project.setLoopStart(beats);
      return ok(`Loop start set to ${beats} beats.`);
    },
  );

  server.registerTool("play", { title: "Play", description: "Start playback (loops all tracks)." }, async () =>
    target.send({ type: "transport", action: "play" }) ? ok("Playing.") : fail("No DAW tab connected."),
  );
  server.registerTool("stop", { title: "Stop", description: "Stop playback." }, async () =>
    target.send({ type: "transport", action: "stop" }) ? ok("Stopped.") : fail("No DAW tab connected."),
  );
}

/** MCP tools: Parameters. */
import { z } from "zod";
import { instrumentSchema } from "../../../src/audio/instruments/catalog";
import { validateParam } from "../../../src/audio/params/validate";
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerParametersTools({ server, target, trackArg, resolveInstrumentTrack }: ToolContext): void {
  server.registerTool(
    "list_parameters",
    {
      title: "List parameters",
      description: "List a track instrument's parameters with schema and current values.",
      inputSchema: trackArg,
    },
    async ({ track }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      const params = instrumentSchema(r.track.instrumentType).map((spec) => ({
        ...spec,
        value: r.track.params.get(spec.id),
      }));
      return ok(JSON.stringify({ track: r.id, instrument: r.track.instrumentType, parameters: params }, null, 2));
    },
  );

  server.registerTool(
    "set_parameter",
    {
      title: "Set parameter",
      description: "Set an instrument parameter on a track. Validated against the schema (range/enum).",
      inputSchema: { ...trackArg, id: z.string(), value: z.union([z.number(), z.string(), z.boolean()]) },
    },
    async ({ track, id, value }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      let spec;
      try {
        spec = r.track.params.spec(id);
      } catch {
        return fail(`Unknown parameter "${id}" for instrument "${r.track.instrumentType}".`);
      }
      const err = validateParam(spec, value);
      if (err) return fail(err);
      if (!target.send({ type: "setParam", trackId: r.id, id, value })) return fail("No DAW tab connected.");
      r.track.params.set(id, value);
      return ok(`Set ${id} = ${JSON.stringify(value)} on ${r.id}.`);
    },
  );
}

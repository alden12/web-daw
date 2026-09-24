/** MCP tools: Effects (on a host: a track or a group bus). */
import { z } from "zod";
import { effectInfos, hasEffect, effectSchema } from "../../../src/audio/effects/catalog";
import { validateParam } from "../../../src/audio/params/validate";
import { makeEffectId, ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerEffectsTools({ server, target, trackArg, resolveHost, resolveEffect }: ToolContext): void {
  // Effect tools take an optional `group` to target a group's bus chain instead
  // of a track's; otherwise they act on the resolved/selected track.
  const groupArg = {
    group: z.string().optional().describe("group id; targets the group's bus effect chain instead of a track"),
  };

  server.registerTool(
    "list_effects",
    {
      title: "List effects",
      description:
        "List a host's effect chain (id, type, bypass, in order) and the available effect types. Pass `group` for a group bus, else a track.",
      inputSchema: { ...trackArg, ...groupArg },
    },
    async ({ track, group }) => {
      const r = resolveHost(track, group);
      if ("error" in r) return fail(r.error);
      return ok(
        JSON.stringify(
          {
            host: r.hostId,
            available: effectInfos().map((def) => ({ id: def.type, label: def.label })),
            effects: r.effects.map((fx) => ({ id: fx.id, type: fx.type, bypassed: fx.bypassed })),
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    "add_effect",
    {
      title: "Add effect",
      description:
        "Append an effect to a host's chain (see list_effects for types). Pass `group` for a group bus, else a track. Returns the new effect id.",
      inputSchema: { ...trackArg, ...groupArg, effect: z.string() },
    },
    async ({ track, group, effect }) => {
      const r = resolveHost(track, group);
      if ("error" in r) return fail(r.error);
      if (!hasEffect(effect)) {
        return fail(
          `Unknown effect "${effect}". Options: ${effectInfos()
            .map((e) => e.type)
            .join(", ")}.`,
        );
      }
      const id = makeEffectId();
      if (!target.send({ type: "addEffect", hostId: r.hostId, effectType: effect, id }))
        return fail("No DAW tab connected.");
      target.project.addEffect(r.hostId, effect, id);
      return ok(`Added ${effect} effect to ${r.label} (id ${id}).`);
    },
  );

  server.registerTool(
    "remove_effect",
    {
      title: "Remove effect",
      description: "Remove an effect from a host's chain by id.",
      inputSchema: { ...trackArg, ...groupArg, effect_id: z.string() },
    },
    async ({ track, group, effect_id }) => {
      const r = resolveEffect(track, group, effect_id);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "removeEffect", hostId: r.hostId, effectId: effect_id }))
        return fail("No DAW tab connected.");
      target.project.removeEffect(r.hostId, effect_id);
      return ok(`Removed effect ${effect_id} from ${r.label}.`);
    },
  );

  server.registerTool(
    "move_effect",
    {
      title: "Move effect",
      description: "Reorder an effect within a host's chain (0 = first/earliest in the signal path).",
      inputSchema: { ...trackArg, ...groupArg, effect_id: z.string(), to_index: z.number().int().min(0) },
    },
    async ({ track, group, effect_id, to_index }) => {
      const r = resolveEffect(track, group, effect_id);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "moveEffect", hostId: r.hostId, effectId: effect_id, toIndex: to_index }))
        return fail("No DAW tab connected.");
      target.project.moveEffect(r.hostId, effect_id, to_index);
      return ok(`Moved effect ${effect_id} to index ${to_index} on ${r.label}.`);
    },
  );

  server.registerTool(
    "bypass_effect",
    {
      title: "Bypass effect",
      description: "Enable or bypass an effect (bypassed effects are skipped in the signal path).",
      inputSchema: { ...trackArg, ...groupArg, effect_id: z.string(), bypassed: z.boolean() },
    },
    async ({ track, group, effect_id, bypassed }) => {
      const r = resolveEffect(track, group, effect_id);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "bypassEffect", hostId: r.hostId, effectId: effect_id, bypassed }))
        return fail("No DAW tab connected.");
      target.project.setEffectBypass(r.hostId, effect_id, bypassed);
      return ok(`${bypassed ? "Bypassed" : "Enabled"} effect ${effect_id} on ${r.label}.`);
    },
  );

  server.registerTool(
    "list_effect_parameters",
    {
      title: "List effect parameters",
      description: "List an effect's parameters with schema and current values.",
      inputSchema: { ...trackArg, ...groupArg, effect_id: z.string() },
    },
    async ({ track, group, effect_id }) => {
      const r = resolveEffect(track, group, effect_id);
      if ("error" in r) return fail(r.error);
      const params = effectSchema(r.effect.type).map((spec) => ({ ...spec, value: r.effect.params.get(spec.id) }));
      return ok(
        JSON.stringify({ host: r.hostId, effect: effect_id, type: r.effect.type, parameters: params }, null, 2),
      );
    },
  );

  server.registerTool(
    "set_effect_parameter",
    {
      title: "Set effect parameter",
      description: "Set a parameter on an effect. Validated against the effect's schema (range/enum).",
      inputSchema: {
        ...trackArg,
        ...groupArg,
        effect_id: z.string(),
        id: z.string(),
        value: z.union([z.number(), z.string(), z.boolean()]),
      },
    },
    async ({ track, group, effect_id, id, value }) => {
      const r = resolveEffect(track, group, effect_id);
      if ("error" in r) return fail(r.error);
      let spec;
      try {
        spec = r.effect.params.spec(id);
      } catch {
        return fail(`Unknown parameter "${id}" for effect "${r.effect.type}".`);
      }
      const err = validateParam(spec, value);
      if (err) return fail(err);
      if (!target.send({ type: "setEffectParam", hostId: r.hostId, effectId: effect_id, id, value }))
        return fail("No DAW tab connected.");
      r.effect.params.set(id, value);
      return ok(`Set ${id} = ${JSON.stringify(value)} on effect ${effect_id}.`);
    },
  );
}

/** MCP tools: Custom devices (author declarative instruments/effects, stored in the project). */
import { z } from "zod";
import {
  parseInstrumentDef,
  parseEffectDef,
  instrumentDefInputSchema,
  effectDefInputSchema,
} from "../../../src/audio/graph/zod";
import { makeCustomInstrumentId, makeCustomEffectId, deviceFormatDoc, ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerCustomDevicesTools({ server, target, trackArg, resolveTrack }: ToolContext): void {
  server.registerTool(
    "describe_device_format",
    {
      title: "Describe device format",
      description:
        "The declarative format for custom instruments/effects: node kinds and their parameters, plus connection and binding syntax. Read this before create_instrument / create_effect.",
      inputSchema: {},
    },
    async () => ok(JSON.stringify(deviceFormatDoc(), null, 2)),
  );

  server.registerTool(
    "create_instrument",
    {
      title: "Create custom instrument",
      description:
        "Author a custom instrument from a declarative node graph (see describe_device_format) and store it in the project. Returns its type id; use it with create_track.",
      inputSchema: instrumentDefInputSchema.shape,
    },
    async ({ label, schema, voice }) => {
      const type = makeCustomInstrumentId();
      const result = parseInstrumentDef({ type, label, schema, voice });
      if (!result.ok) return fail(`Invalid instrument: ${result.errors.join("; ")}`);
      if (!target.send({ type: "addCustomInstrument", def: result.def })) return fail("No DAW tab connected.");
      target.project.addCustomInstrument(result.def);
      return ok(`Created instrument "${label ?? type}" (type ${type}). Use create_track with instrument "${type}".`);
    },
  );

  server.registerTool(
    "create_effect",
    {
      title: "Create custom effect",
      description:
        "Author a custom effect from a declarative node graph (see describe_device_format; process from `in` to `wet`, include a `mix` param) and store it in the project. Returns its type id; use it with add_effect.",
      inputSchema: effectDefInputSchema.shape,
    },
    async ({ label, schema, graph }) => {
      const type = makeCustomEffectId();
      const result = parseEffectDef({ type, label, schema, graph });
      if (!result.ok) return fail(`Invalid effect: ${result.errors.join("; ")}`);
      if (!target.send({ type: "addCustomEffect", def: result.def })) return fail("No DAW tab connected.");
      target.project.addCustomEffect(result.def);
      return ok(`Created effect "${label ?? type}" (type ${type}). Use add_effect with effect "${type}".`);
    },
  );

  server.registerTool(
    "update_instrument",
    {
      title: "Edit custom instrument",
      description:
        "Replace a custom instrument's definition, keeping its type id, so every track playing it picks up the change (params it still has keep their values). Pass the whole new definition: read the current one with get_custom_device, change it, send it back. Omit label to keep the current one.",
      inputSchema: { deviceType: z.string(), ...instrumentDefInputSchema.shape },
    },
    async ({ deviceType, label, schema, voice }) => {
      const current = target.project.customInstruments.find((def) => def.type === deviceType);
      if (!current) return fail(`No custom instrument with type "${deviceType}". Use list_custom_devices.`);
      const result = parseInstrumentDef({ type: deviceType, label: label ?? current.label, schema, voice });
      if (!result.ok) return fail(`Invalid instrument: ${result.errors.join("; ")}`);
      if (!target.send({ type: "updateCustomInstrument", def: result.def })) return fail("No DAW tab connected.");
      target.project.addCustomInstrument(result.def);
      return ok(`Updated instrument "${result.def.label ?? deviceType}" (type ${deviceType}).`);
    },
  );

  server.registerTool(
    "update_effect",
    {
      title: "Edit custom effect",
      description:
        "Replace a custom effect's definition, keeping its type id, so every slot holding it picks up the change (params it still has keep their values). Pass the whole new definition: read the current one with get_custom_device, change it, send it back. Omit label to keep the current one.",
      inputSchema: { deviceType: z.string(), ...effectDefInputSchema.shape },
    },
    async ({ deviceType, label, schema, graph }) => {
      const current = target.project.customEffects.find((def) => def.type === deviceType);
      if (!current) return fail(`No custom effect with type "${deviceType}". Use list_custom_devices.`);
      const result = parseEffectDef({ type: deviceType, label: label ?? current.label, schema, graph });
      if (!result.ok) return fail(`Invalid effect: ${result.errors.join("; ")}`);
      if (!target.send({ type: "updateCustomEffect", def: result.def })) return fail("No DAW tab connected.");
      target.project.addCustomEffect(result.def);
      return ok(`Updated effect "${result.def.label ?? deviceType}" (type ${deviceType}).`);
    },
  );

  server.registerTool(
    "get_custom_device",
    {
      title: "Get custom device",
      description:
        "A custom instrument's or effect's full definition (label, schema, and voice or graph), to read before update_instrument / update_effect.",
      inputSchema: { deviceType: z.string() },
    },
    async ({ deviceType }) => {
      const instrument = target.project.customInstruments.find((def) => def.type === deviceType);
      if (instrument) return ok(JSON.stringify({ kind: "instrument", ...instrument }, null, 2));
      const effect = target.project.customEffects.find((def) => def.type === deviceType);
      if (effect) return ok(JSON.stringify({ kind: "effect", ...effect }, null, 2));
      return fail(`No custom device with type "${deviceType}". Use list_custom_devices.`);
    },
  );

  server.registerTool(
    "list_custom_devices",
    {
      title: "List custom devices",
      description:
        "The project's user/AI-authored instruments and effects (declarative devices). `uses` counts the tracks playing an instrument or the slots holding an effect; one at 0 is safe to remove.",
      inputSchema: {},
    },
    async () => {
      const describe = (def: { type: string; label?: string; schema: readonly unknown[] }) => ({
        type: def.type,
        label: def.label ?? def.type,
        params: def.schema.length,
        uses: target.project.customDeviceUses(def.type),
      });
      return ok(
        JSON.stringify(
          {
            instruments: target.project.customInstruments.map(describe),
            effects: target.project.customEffects.map(describe),
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    "remove_custom_device",
    {
      title: "Remove custom device",
      description: "Delete a custom instrument or effect by its type id (see list_custom_devices).",
      inputSchema: { deviceType: z.string() },
    },
    async ({ deviceType }) => {
      if (target.project.customInstruments.some((def) => def.type === deviceType)) {
        if (!target.send({ type: "removeCustomInstrument", deviceType })) return fail("No DAW tab connected.");
        target.project.removeCustomInstrument(deviceType);
        return ok(`Removed custom instrument ${deviceType}.`);
      }
      if (target.project.customEffects.some((def) => def.type === deviceType)) {
        if (!target.send({ type: "removeCustomEffect", deviceType })) return fail("No DAW tab connected.");
        target.project.removeCustomEffect(deviceType);
        return ok(`Removed custom effect ${deviceType}.`);
      }
      return fail(`No custom device with type "${deviceType}". Use list_custom_devices.`);
    },
  );

  server.registerTool(
    "set_track",
    {
      title: "Set track",
      description: "Set a track's mute, solo, volume (0..1), and/or name.",
      inputSchema: {
        ...trackArg,
        muted: z.boolean().optional(),
        solo: z.boolean().optional(),
        volume: z.number().min(0).max(1).optional(),
        name: z.string().optional(),
      },
    },
    async ({ track, muted, solo, volume, name }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "setTrack", trackId: r.id, muted, solo, volume, name }))
        return fail("No DAW tab connected.");
      if (muted !== undefined) target.project.setMuted(r.id, muted);
      if (solo !== undefined) target.project.setSolo(r.id, solo);
      if (volume !== undefined) target.project.setVolume(r.id, volume);
      if (name !== undefined) target.project.renameTrack(r.id, name);
      return ok(`Updated track ${r.id}.`);
    },
  );
}

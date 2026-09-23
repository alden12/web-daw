/** MCP tools: MIDI devices (on an instrument track's note chain). */
import { z } from "zod";
import { midiDeviceInfos, hasMidiDevice, midiDeviceSchema } from "../../../src/audio/midi/device/catalog";
import { validateParam } from "../../../src/audio/params/validate";
import { makeMidiDeviceId, ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerMidiDevicesTools({
  server,
  target,
  trackArg,
  resolveInstrumentTrack,
  resolveMidiDevice,
}: ToolContext): void {
  // MIDI devices transform note events (live + playback) before the instrument.
  // They live only on instrument tracks (no group buses), so these tools take a track.
  server.registerTool(
    "list_midi_devices",
    {
      title: "List MIDI devices",
      description:
        "List an instrument track's MIDI-device chain (id, type, bypass, in order) and the available device types.",
      inputSchema: { ...trackArg },
    },
    async ({ track }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      return ok(
        JSON.stringify(
          {
            track: r.id,
            available: midiDeviceInfos().map((def) => ({ id: def.type, label: def.label })),
            devices: r.track.midiDevices.map((device) => ({
              id: device.id,
              type: device.type,
              bypassed: device.bypassed,
            })),
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    "add_midi_device",
    {
      title: "Add MIDI device",
      description:
        "Append a MIDI device to an instrument track's note chain (see list_midi_devices for types). Returns the new device id.",
      inputSchema: { ...trackArg, device: z.string() },
    },
    async ({ track, device }) => {
      const r = resolveInstrumentTrack(track);
      if ("error" in r) return fail(r.error);
      if (!hasMidiDevice(device)) {
        return fail(
          `Unknown MIDI device "${device}". Options: ${midiDeviceInfos()
            .map((d) => d.type)
            .join(", ")}.`,
        );
      }
      const id = makeMidiDeviceId();
      if (!target.send({ type: "addMidiDevice", trackId: r.id, deviceType: device, id }))
        return fail("No DAW tab connected.");
      target.project.addMidiDevice(r.id, device, id);
      return ok(`Added ${device} MIDI device to track ${r.id} (id ${id}).`);
    },
  );

  server.registerTool(
    "remove_midi_device",
    {
      title: "Remove MIDI device",
      description: "Remove a MIDI device from an instrument track's note chain by id.",
      inputSchema: { ...trackArg, device_id: z.string() },
    },
    async ({ track, device_id }) => {
      const r = resolveMidiDevice(track, device_id);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "removeMidiDevice", trackId: r.trackId, deviceId: device_id }))
        return fail("No DAW tab connected.");
      target.project.removeMidiDevice(r.trackId, device_id);
      return ok(`Removed MIDI device ${device_id} from ${r.label}.`);
    },
  );

  server.registerTool(
    "move_midi_device",
    {
      title: "Move MIDI device",
      description: "Reorder a MIDI device within a track's note chain (0 = first, applied earliest).",
      inputSchema: { ...trackArg, device_id: z.string(), to_index: z.number().int().min(0) },
    },
    async ({ track, device_id, to_index }) => {
      const r = resolveMidiDevice(track, device_id);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "moveMidiDevice", trackId: r.trackId, deviceId: device_id, toIndex: to_index }))
        return fail("No DAW tab connected.");
      target.project.moveMidiDevice(r.trackId, device_id, to_index);
      return ok(`Moved MIDI device ${device_id} to index ${to_index} on ${r.label}.`);
    },
  );

  server.registerTool(
    "bypass_midi_device",
    {
      title: "Bypass MIDI device",
      description: "Enable or bypass a MIDI device (bypassed devices pass notes through untransformed).",
      inputSchema: { ...trackArg, device_id: z.string(), bypassed: z.boolean() },
    },
    async ({ track, device_id, bypassed }) => {
      const r = resolveMidiDevice(track, device_id);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "bypassMidiDevice", trackId: r.trackId, deviceId: device_id, bypassed }))
        return fail("No DAW tab connected.");
      target.project.setMidiDeviceBypass(r.trackId, device_id, bypassed);
      return ok(`${bypassed ? "Bypassed" : "Enabled"} MIDI device ${device_id} on ${r.label}.`);
    },
  );

  server.registerTool(
    "list_midi_device_parameters",
    {
      title: "List MIDI device parameters",
      description: "List a MIDI device's parameters with schema and current values.",
      inputSchema: { ...trackArg, device_id: z.string() },
    },
    async ({ track, device_id }) => {
      const r = resolveMidiDevice(track, device_id);
      if ("error" in r) return fail(r.error);
      const params = midiDeviceSchema(r.device.type).map((spec) => ({ ...spec, value: r.device.params.get(spec.id) }));
      return ok(
        JSON.stringify({ track: r.trackId, device: device_id, type: r.device.type, parameters: params }, null, 2),
      );
    },
  );

  server.registerTool(
    "set_midi_device_parameter",
    {
      title: "Set MIDI device parameter",
      description: "Set a parameter on a MIDI device. Validated against the device's schema (range/enum).",
      inputSchema: {
        ...trackArg,
        device_id: z.string(),
        id: z.string(),
        value: z.union([z.number(), z.string(), z.boolean()]),
      },
    },
    async ({ track, device_id, id, value }) => {
      const r = resolveMidiDevice(track, device_id);
      if ("error" in r) return fail(r.error);
      let spec;
      try {
        spec = r.device.params.spec(id);
      } catch {
        return fail(`Unknown parameter "${id}" for MIDI device "${r.device.type}".`);
      }
      const err = validateParam(spec, value);
      if (err) return fail(err);
      if (!target.send({ type: "setMidiDeviceParam", trackId: r.trackId, deviceId: device_id, id, value }))
        return fail("No DAW tab connected.");
      r.device.params.set(id, value);
      return ok(`Set ${id} = ${JSON.stringify(value)} on MIDI device ${device_id}.`);
    },
  );
}

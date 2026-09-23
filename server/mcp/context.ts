/**
 * The per-server context every tool group registers against: the MCP server, the target the tools
 * read and edit through, and the resolvers that turn a tool's optional ids into real objects.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  Track,
  InstrumentTrack,
  EffectInstance,
  MidiDeviceInstance,
  Group,
} from "../../src/audio/project/projectStore";
import { makeGroupId } from "./shared";
import type { DawTarget } from "./target";

/**
 * Where tools get registered. Only `registerTool` is used, so the hosted server can hand in a wrapper
 * that adds a `project` argument to every tool and opens that project before the tool runs.
 */
export type ToolHost = Pick<McpServer, "registerTool">;

export function makeToolContext(server: ToolHost, target: DawTarget) {
  const trackArg = { track: z.string().optional().describe("track id; defaults to the selected track") };

  /** Resolve a track id (explicit, else selected). */
  function resolveTrack(track?: string): { id: string; track: Track } | { error: string } {
    const id = track ?? target.project.selectedId ?? undefined;
    if (!id) return { error: "No track specified and no track is selected. Use list_tracks / create_track." };
    const t = target.project.getTrack(id);
    if (!t) return { error: `Unknown track "${id}". Use list_tracks to see valid ids.` };
    return { id, track: t };
  }

  /** Resolve a track that must be an instrument track (params/notes tools). */
  function resolveInstrumentTrack(track?: string): { id: string; track: InstrumentTrack } | { error: string } {
    const r = resolveTrack(track);
    if ("error" in r) return r;
    if (r.track.kind !== "instrument") {
      return { error: `Track ${r.id} is an audio track; this tool needs an instrument track.` };
    }
    return { id: r.id, track: r.track };
  }

  /** Resolve a group id. */
  function resolveGroup(group: string): { id: string; group: Group } | { error: string } {
    const g = target.project.getGroup(group);
    if (!g) return { error: `Unknown group "${group}". Use list_groups to see valid ids.` };
    return { id: group, group: g };
  }

  /** Resolve an effect host: an explicit group, else the resolved/selected track. */
  function resolveHost(
    track: string | undefined,
    group: string | undefined,
  ): { hostId: string; label: string; effects: EffectInstance[] } | { error: string } {
    if (group !== undefined) {
      const r = resolveGroup(group);
      if ("error" in r) return { error: r.error };
      return { hostId: r.id, label: `group ${r.id}`, effects: r.group.effects };
    }
    const r = resolveTrack(track);
    if ("error" in r) return { error: r.error };
    return { hostId: r.id, label: `track ${r.id}`, effects: r.track.effects };
  }

  /** Resolve a host (group/track) and one of its effects by id. */
  function resolveEffect(
    track: string | undefined,
    group: string | undefined,
    effectId: string,
  ): { hostId: string; label: string; effect: EffectInstance } | { error: string } {
    const h = resolveHost(track, group);
    if ("error" in h) return { error: h.error };
    const effect = h.effects.find((fx) => fx.id === effectId);
    if (!effect) return { error: `Unknown effect "${effectId}" on ${h.label}. Use list_effects.` };
    return { hostId: h.hostId, label: h.label, effect };
  }

  /** Resolve an instrument track and one of its MIDI devices by id. */
  function resolveMidiDevice(
    track: string | undefined,
    deviceId: string,
  ): { trackId: string; label: string; device: MidiDeviceInstance } | { error: string } {
    const r = resolveInstrumentTrack(track);
    if ("error" in r) return { error: r.error };
    const device = r.track.midiDevices.find((d) => d.id === deviceId);
    if (!device) return { error: `Unknown MIDI device "${deviceId}" on track ${r.id}. Use list_midi_devices.` };
    return { trackId: r.id, label: `track ${r.id}`, device };
  }

  /** The top-level group for an instrument family, creating one (id only) if absent. */
  function familyGroup(family: string): { id: string; name: string; created: boolean } {
    const existing = target.project.getGroups().find((g) => g.parentId === null && g.name === family);
    return existing
      ? { id: existing.id, name: existing.name, created: false }
      : { id: makeGroupId(), name: family, created: true };
  }

  // A play_sequence in flight, so a second one (or closing) can cancel the rest of it.
  const sequenceTimers: ReturnType<typeof setTimeout>[] = [];
  const clearSequence = () => {
    for (const timer of sequenceTimers) clearTimeout(timer);
    sequenceTimers.length = 0;
  };

  return {
    server,
    target,
    trackArg,
    resolveTrack,
    resolveInstrumentTrack,
    resolveGroup,
    resolveHost,
    resolveEffect,
    resolveMidiDevice,
    familyGroup,
    sequenceTimers,
    clearSequence,
  };
}

export type ToolContext = ReturnType<typeof makeToolContext>;

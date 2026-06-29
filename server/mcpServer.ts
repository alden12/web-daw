/**
 * The Node-hosted MCP server. A control-plane over the project model, never an
 * audio path: tools mirror the same ProjectStore/ParamStore/ClipStore the UI
 * uses, validate against each instrument's schema, and forward edits over a
 * WebSocket to the open DAW tab. Everything is track-addressed; `track` defaults
 * to the selected track when omitted.
 *
 * `createDawMcp` returns the McpServer plus a close fn so it can be driven by a
 * stdio transport in production and an in-memory transport in tests.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { ProjectStore } from "../src/audio/project/projectStore";
import type { Track, InstrumentTrack, EffectInstance, Group } from "../src/audio/project/projectStore";
import { instrumentInfos, hasInstrument, instrumentSchema, instrumentFamily } from "../src/audio/instruments/catalog";
import { effectInfos, hasEffect, effectSchema } from "../src/audio/effects/catalog";
import { validateParam } from "../src/audio/params/validate";
import type { NoteEvent } from "../src/audio/sequencer/types";
import { GRID_DIVISIONS, beatsForGrid, quantizeNotes } from "../src/audio/sequencer/quantize";
import { GROOVES, grooveById } from "../src/audio/grooves/catalog";
import { DEFAULT_WS_PORT } from "../src/audio/mcp/protocol";
import type { BrowserToServer, HistoryMethod, PatchMethod, ServerToBrowser } from "../src/audio/mcp/protocol";

const randomId = () => crypto.randomUUID();
const makeTrackId = () => `t-${randomId().slice(0, 8)}`;
const makeGroupId = () => `g-${randomId().slice(0, 8)}`;
const makeEffectId = () => `fx-${randomId().slice(0, 8)}`;
const makeClipId = () => `c-${randomId().slice(0, 8)}`;
const makePlacementId = () => `p-${randomId().slice(0, 8)}`;

export interface DawMcp {
  server: McpServer;
  close(): Promise<void>;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export function createDawMcp(options: { port?: number; onError?: (err: NodeJS.ErrnoException) => void } = {}): DawMcp {
  const port = options.port ?? DEFAULT_WS_PORT;

  // The server's mirror of the tab's project, kept current by the sync messages.
  const mirror = new ProjectStore(false);

  // Pending version-history RPCs, keyed by correlation id (see requestTab).
  type Reply = { ok: boolean; result?: unknown; error?: string };
  const pending = new Map<string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  let nextReqId = 0;

  // One handler per inbound sync message (map dispatch, not if/else). Mapped type
  // makes leaving a message type unhandled a compile error.
  type Inbound = { [K in BrowserToServer["type"]]: (msg: Extract<BrowserToServer, { type: K }>) => void };
  const inbound: Inbound = {
    projectSnapshot: (msg) => mirror.load(msg.project),
    projectStructure: (msg) => mirror.load(msg.project),
    paramChanged: (msg) => {
      const t = mirror.getTrack(msg.trackId);
      if (t?.kind === "instrument") t.params.set(msg.id, msg.value);
    },
    clipSnapshot: (msg) => mirror.getClipStore(msg.trackId, msg.clipId)?.load(msg.clip),
    effectParamChanged: (msg) => mirror.getEffect(msg.hostId, msg.effectId)?.params.set(msg.id, msg.value),
    historyReply: (msg) => resolvePending(msg),
    patchReply: (msg) => resolvePending(msg),
  };

  // Both RPC paths (history, patches) correlate by a shared id and resolve here.
  const resolvePending = (msg: { id: string; ok: boolean; result?: unknown; error?: string }) => {
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.delete(msg.id);
    waiting.resolve({ ok: msg.ok, result: msg.result, error: msg.error });
  };

  let tab: WebSocket | null = null;
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });

  wss.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[web-daw] WebSocket server error: ${err.message}`);
    options.onError?.(err);
  });

  wss.on("connection", (socket) => {
    tab = socket;
    socket.on("message", (raw: RawData) => {
      let msg: BrowserToServer;
      try {
        msg = JSON.parse(raw.toString()) as BrowserToServer;
      } catch {
        return;
      }
      (inbound[msg.type] as (m: BrowserToServer) => void)?.(msg);
    });
    socket.on("close", () => {
      if (tab === socket) tab = null;
    });
  });

  const connected = () => tab !== null && tab.readyState === WebSocket.OPEN;
  const sendToTab = (msg: ServerToBrowser): boolean => {
    if (!connected()) return false;
    tab!.send(JSON.stringify(msg));
    return true;
  };

  /**
   * Round-trip a version-history RPC to the tab and await its reply. The DAG lives
   * in the tab (OPFS), so these tools can't read the mirror - they ask the tab.
   * Rejects if no tab is connected or the reply doesn't arrive in time.
   */
  const awaitReply = (sendRequest: (id: string) => boolean): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const id = `rq-${nextReqId++}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The DAW tab did not respond in time."));
      }, 5000);
      pending.set(id, { resolve, timer });
      if (!sendRequest(id)) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error("No DAW tab connected."));
      }
    });

  const requestTab = (method: HistoryMethod, params?: Record<string, unknown>): Promise<Reply> =>
    awaitReply((id) => sendToTab({ type: "historyRequest", id, method, params }));

  /** Round-trip a patch-library RPC to the tab (patches live in its localStorage). */
  const requestPatch = (method: PatchMethod, params?: Record<string, unknown>): Promise<Reply> =>
    awaitReply((id) => sendToTab({ type: "patchRequest", id, method, params }));

  /** Resolve a track id (explicit, else selected). */
  function resolveTrack(track?: string): { id: string; track: Track } | { error: string } {
    const id = track ?? mirror.selectedId ?? undefined;
    if (!id) return { error: "No track specified and no track is selected. Use list_tracks / create_track." };
    const t = mirror.getTrack(id);
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
    const g = mirror.getGroup(group);
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

  /** The top-level group for an instrument family, creating one (id only) if absent. */
  function familyGroup(family: string): { id: string; name: string; created: boolean } {
    const existing = mirror.getGroups().find((g) => g.parentId === null && g.name === family);
    return existing
      ? { id: existing.id, name: existing.name, created: false }
      : { id: makeGroupId(), name: family, created: true };
  }

  let sequenceTimers: ReturnType<typeof setTimeout>[] = [];
  const clearSequence = () => {
    for (const t of sequenceTimers) clearTimeout(t);
    sequenceTimers = [];
  };

  const server = new McpServer({ name: "web-daw", version: "0.1.0" });
  const trackArg = { track: z.string().optional().describe("track id; defaults to the selected track") };

  // --- Tracks ---------------------------------------------------------------
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
            connected: connected(),
            tempoBpm: mirror.tempo,
            lengthBeats: mirror.length,
            selectedTrackId: mirror.selectedId,
            instruments: instrumentInfos().map((def) => ({ id: def.type, label: def.label, family: def.family })),
            tracks: mirror.getTracks().map((t) => ({
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
          `Unknown instrument "${instrument}". Options: ${instrumentInfos()
            .map((i) => i.type)
            .join(", ")}.`,
        );
      }
      if (!connected()) return fail("No DAW tab connected.");
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
          sendToTab({ type: "createGroup", id: fam.id, name: fam.name, parentId: null });
          mirror.addGroup({ id: fam.id, name: fam.name, parentId: null });
        }
      }
      const id = makeTrackId();
      sendToTab({ type: "createTrack", instrumentType: instrument, name, id, groupId });
      mirror.addTrack(instrument, { name, id, groupId });
      return ok(`Created ${instrument} track "${mirror.getTrack(id)?.name}" (id ${id}) in group ${groupId}.`);
    },
  );

  server.registerTool(
    "remove_track",
    { title: "Remove track", description: "Delete a track and its clip.", inputSchema: trackArg },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!sendToTab({ type: "removeTrack", trackId: r.id })) return fail("No DAW tab connected.");
      mirror.removeTrack(r.id);
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
      if (!sendToTab({ type: "selectTrack", trackId: r.id })) return fail("No DAW tab connected.");
      mirror.selectTrack(r.id);
      return ok(`Selected track ${r.id}.`);
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
      if (!sendToTab({ type: "setTrack", trackId: r.id, muted, solo, volume, name }))
        return fail("No DAW tab connected.");
      if (muted !== undefined) mirror.setMuted(r.id, muted);
      if (solo !== undefined) mirror.setSolo(r.id, solo);
      if (volume !== undefined) mirror.setVolume(r.id, volume);
      if (name !== undefined) mirror.renameTrack(r.id, name);
      return ok(`Updated track ${r.id}.`);
    },
  );

  // --- Groups (bus tree) ----------------------------------------------------
  server.registerTool(
    "list_groups",
    {
      title: "List groups",
      description:
        "List the project's groups (bus tree): id, name, parent (null = top-level/master), mute, volume, collapsed, effect count, and the tracks filed in each.",
    },
    async () =>
      ok(
        JSON.stringify(
          {
            groups: mirror.getGroups().map((g) => ({
              id: g.id,
              name: g.name,
              parent: g.parentId,
              muted: g.muted,
              solo: g.solo,
              volume: g.volume,
              collapsed: g.collapsed,
              effects: g.effects.length,
              tracks: mirror
                .getTracks()
                .filter((t) => t.parentId === g.id)
                .map((t) => t.id),
            })),
          },
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    "create_group",
    {
      title: "Create group",
      description:
        "Create a group (bus). Nest it under `parent`, or omit for a top-level group routed to master. Returns the new group id.",
      inputSchema: {
        name: z.string().optional(),
        parent: z.string().optional().describe("parent group id; omit for top-level"),
      },
    },
    async ({ name, parent }) => {
      if (!connected()) return fail("No DAW tab connected.");
      if (parent !== undefined && "error" in resolveGroup(parent)) {
        return fail(`Unknown parent group "${parent}". Use list_groups.`);
      }
      const id = makeGroupId();
      const parentId = parent ?? null;
      sendToTab({ type: "createGroup", id, name, parentId });
      mirror.addGroup({ id, name, parentId });
      return ok(`Created group "${mirror.getGroup(id)?.name}" (id ${id}).`);
    },
  );

  server.registerTool(
    "remove_group",
    {
      title: "Remove group",
      description:
        "Remove a group AND everything inside it (its tracks, their clips, and any subgroups). Move tracks out first to keep them.",
      inputSchema: { group: z.string() },
    },
    async ({ group }) => {
      const r = resolveGroup(group);
      if ("error" in r) return fail(r.error);
      if (!sendToTab({ type: "removeGroup", groupId: r.id })) return fail("No DAW tab connected.");
      mirror.removeGroup(r.id);
      return ok(`Removed group ${r.id} and its contents.`);
    },
  );

  server.registerTool(
    "set_group",
    {
      title: "Set group",
      description:
        "Set a group's name, mute, solo, volume (0..1), and/or collapsed state. Muting a group silences everything routed through it.",
      inputSchema: {
        group: z.string(),
        name: z.string().optional(),
        muted: z.boolean().optional(),
        solo: z.boolean().optional(),
        volume: z.number().min(0).max(1).optional(),
        collapsed: z.boolean().optional(),
      },
    },
    async ({ group, name, muted, solo, volume, collapsed }) => {
      const r = resolveGroup(group);
      if ("error" in r) return fail(r.error);
      if (!sendToTab({ type: "setGroup", groupId: r.id, name, muted, solo, volume, collapsed }))
        return fail("No DAW tab connected.");
      if (name !== undefined) mirror.renameGroup(r.id, name);
      if (muted !== undefined) mirror.setGroupMuted(r.id, muted);
      if (solo !== undefined) mirror.setGroupSolo(r.id, solo);
      if (volume !== undefined) mirror.setGroupVolume(r.id, volume);
      if (collapsed !== undefined) mirror.setGroupCollapsed(r.id, collapsed);
      return ok(`Updated group ${r.id}.`);
    },
  );

  server.registerTool(
    "move_track",
    {
      title: "Move track",
      description: "Move a track into another group.",
      inputSchema: { ...trackArg, group: z.string() },
    },
    async ({ track, group }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      const g = resolveGroup(group);
      if ("error" in g) return fail(g.error);
      if (!sendToTab({ type: "moveTrack", trackId: r.id, groupId: g.id })) return fail("No DAW tab connected.");
      mirror.moveTrack(r.id, g.id);
      return ok(`Moved track ${r.id} into group ${g.id}.`);
    },
  );

  server.registerTool(
    "move_group",
    {
      title: "Move group",
      description: "Reparent a group under another group, or to top-level (omit `parent`). Rejects cycles.",
      inputSchema: {
        group: z.string(),
        parent: z.string().optional().describe("new parent group id; omit for top-level"),
      },
    },
    async ({ group, parent }) => {
      const r = resolveGroup(group);
      if ("error" in r) return fail(r.error);
      if (parent !== undefined && "error" in resolveGroup(parent))
        return fail(`Unknown parent group "${parent}". Use list_groups.`);
      const parentId = parent ?? null;
      if (!sendToTab({ type: "moveGroup", groupId: r.id, parentId })) return fail("No DAW tab connected.");
      mirror.moveGroup(r.id, parentId);
      return ok(`Moved group ${r.id} under ${parentId ?? "master"}.`);
    },
  );

  // --- Parameters -----------------------------------------------------------
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
      if (!sendToTab({ type: "setParam", trackId: r.id, id, value })) return fail("No DAW tab connected.");
      r.track.params.set(id, value);
      return ok(`Set ${id} = ${JSON.stringify(value)} on ${r.id}.`);
    },
  );

  // --- Effects (on a host: a track or a group bus) --------------------------
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
      if (!sendToTab({ type: "addEffect", hostId: r.hostId, effectType: effect, id }))
        return fail("No DAW tab connected.");
      mirror.addEffect(r.hostId, effect, id);
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
      if (!sendToTab({ type: "removeEffect", hostId: r.hostId, effectId: effect_id }))
        return fail("No DAW tab connected.");
      mirror.removeEffect(r.hostId, effect_id);
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
      if (!sendToTab({ type: "moveEffect", hostId: r.hostId, effectId: effect_id, toIndex: to_index }))
        return fail("No DAW tab connected.");
      mirror.moveEffect(r.hostId, effect_id, to_index);
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
      if (!sendToTab({ type: "bypassEffect", hostId: r.hostId, effectId: effect_id, bypassed }))
        return fail("No DAW tab connected.");
      mirror.setEffectBypass(r.hostId, effect_id, bypassed);
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
      if (!sendToTab({ type: "setEffectParam", hostId: r.hostId, effectId: effect_id, id, value }))
        return fail("No DAW tab connected.");
      r.effect.params.set(id, value);
      return ok(`Set ${id} = ${JSON.stringify(value)} on effect ${effect_id}.`);
    },
  );

  // --- Clip notes -----------------------------------------------------------
  // Note tools edit one clip in the track's pool - the active clip, or `clip` if given.
  const noteShape = {
    pitch: z.number().int().min(0).max(127),
    start: z.number().min(0).describe("onset in beats (4 beats = 1 bar)"),
    length: z.number().min(0).optional().describe("duration in beats (default 1)"),
    velocity: z.number().min(0).max(1).optional(),
  };
  const clipArg = { clip: z.string().optional().describe("clip id (see list_clips); defaults to the active clip") };
  const makeNote = (n: { pitch: number; start: number; length?: number; velocity?: number }): NoteEvent => ({
    id: randomId(),
    pitch: n.pitch,
    start: n.start,
    length: n.length ?? 1,
    velocity: n.velocity ?? 0.8,
  });
  /** Resolve an instrument track + the target clip store (active or `clip`). */
  const resolveClip = (track?: string, clip?: string) => {
    const r = resolveInstrumentTrack(track);
    if ("error" in r) return r;
    const store = mirror.getClipStore(r.id, clip);
    if (!store) return { error: `Unknown clip "${clip}" on ${r.id}.` };
    return { id: r.id, track: r.track, store };
  };

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "Return a clip's notes (id, pitch, start/length in beats, velocity).",
      inputSchema: { ...trackArg, ...clipArg },
    },
    async ({ track, clip }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      return ok(JSON.stringify({ track: r.id, clip: r.store.getClip() }, null, 2));
    },
  );

  server.registerTool(
    "add_note",
    {
      title: "Add note",
      description: "Add one note to a clip. Times in beats. Returns the note id.",
      inputSchema: { ...trackArg, ...clipArg, ...noteShape },
    },
    async ({ track, clip, pitch, start, length, velocity }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      const note = makeNote({ pitch, start, length, velocity });
      if (!sendToTab({ type: "addNote", trackId: r.id, clipId: clip, note })) return fail("No DAW tab connected.");
      r.store.putNote(note);
      return ok(`Added note ${pitch} at beat ${start} to ${r.id} (id ${note.id}).`);
    },
  );

  server.registerTool(
    "add_notes",
    {
      title: "Add notes",
      description: "Add many notes to a clip at once (write a whole part). Times in beats.",
      inputSchema: { ...trackArg, ...clipArg, notes: z.array(z.object(noteShape)).min(1).max(512) },
    },
    async ({ track, clip, notes }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      // One addNotes message = one feed entry + one undo step (not one per note).
      const made = notes.map(makeNote);
      if (!sendToTab({ type: "addNotes", trackId: r.id, clipId: clip, notes: made }))
        return fail("No DAW tab connected.");
      for (const note of made) r.store.putNote(note);
      return ok(`Added ${made.length} notes to ${r.id}.`);
    },
  );

  server.registerTool(
    "edit_notes",
    {
      title: "Edit notes",
      description: "Move / resize / re-velocity existing notes in place, by id, in one atomic edit. Times in beats.",
      inputSchema: {
        ...trackArg,
        ...clipArg,
        notes: z
          .array(z.object({ id: z.string(), ...noteShape }))
          .min(1)
          .max(512),
      },
    },
    async ({ track, clip, notes }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      const edited: NoteEvent[] = notes.map((n) => ({ ...makeNote(n), id: n.id }));
      if (!sendToTab({ type: "editNotes", trackId: r.id, clipId: clip, notes: edited }))
        return fail("No DAW tab connected.");
      for (const note of edited) r.store.putNote(note);
      return ok(`Edited ${edited.length} notes on ${r.id}.`);
    },
  );

  server.registerTool(
    "quantize",
    {
      title: "Quantize",
      description:
        "Pull a clip's note timings toward a grid. Quantizes the given note ids, or the whole clip if none are given. Applied as one atomic edit.",
      inputSchema: {
        ...trackArg,
        ...clipArg,
        grid: z
          .enum(GRID_DIVISIONS.map((division) => division.label) as [string, ...string[]])
          .optional()
          .describe("grid resolution (default 1/16)"),
        strength: z.number().min(0).max(1).optional().describe("0 = no change, 1 = full snap (default 1)"),
        ends: z.boolean().optional().describe("also snap note ends, so lengths land on the grid (default false)"),
        ids: z.array(z.string()).optional().describe("note ids to quantize; omit to quantize the whole clip"),
      },
    },
    async ({ track, clip, grid, strength, ends, ids }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      const all = r.store.getClip().notes;
      const targets = ids?.length ? all.filter((note) => ids.includes(note.id)) : all;
      if (!targets.length) return fail("No notes to quantize.");
      const notes = quantizeNotes(targets, {
        gridBeats: beatsForGrid(grid ?? "1/16"),
        strength: strength ?? 1,
        ends: ends ?? false,
      });
      if (!sendToTab({ type: "editNotes", trackId: r.id, clipId: clip, notes })) return fail("No DAW tab connected.");
      for (const note of notes) r.store.putNote(note);
      return ok(`Quantized ${notes.length} notes on ${r.id} to ${grid ?? "1/16"}.`);
    },
  );

  server.registerTool(
    "remove_note",
    {
      title: "Remove note",
      description: "Remove a note from a clip by id.",
      inputSchema: { ...trackArg, ...clipArg, id: z.string() },
    },
    async ({ track, clip, id }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      if (!sendToTab({ type: "removeNote", trackId: r.id, clipId: clip, id })) return fail("No DAW tab connected.");
      r.store.removeNote(id);
      return ok(`Removed note ${id} from ${r.id}.`);
    },
  );

  server.registerTool(
    "remove_notes",
    {
      title: "Remove notes",
      description: "Remove many notes from a clip by id, in one atomic edit.",
      inputSchema: { ...trackArg, ...clipArg, ids: z.array(z.string()).min(1).max(512) },
    },
    async ({ track, clip, ids }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      if (!sendToTab({ type: "removeNotes", trackId: r.id, clipId: clip, ids })) return fail("No DAW tab connected.");
      for (const id of ids) r.store.removeNote(id);
      return ok(`Removed ${ids.length} notes from ${r.id}.`);
    },
  );

  server.registerTool(
    "clear_clip",
    { title: "Clear clip", description: "Remove all notes from a clip.", inputSchema: { ...trackArg, ...clipArg } },
    async ({ track, clip }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      if (!sendToTab({ type: "clearClip", trackId: r.id, clipId: clip })) return fail("No DAW tab connected.");
      r.store.clear();
      return ok(`Cleared clip on ${r.id}.`);
    },
  );

  server.registerTool(
    "set_clip_length",
    {
      title: "Set clip length",
      description: "Set a clip's pattern length in beats (clamps notes past the end).",
      inputSchema: { ...trackArg, ...clipArg, lengthBeats: z.number().min(0.25).max(256) },
    },
    async ({ track, clip, lengthBeats }) => {
      const r = resolveClip(track, clip);
      if ("error" in r) return fail(r.error);
      if (!sendToTab({ type: "setClipLength", trackId: r.id, clipId: clip, lengthBeats }))
        return fail("No DAW tab connected.");
      r.store.setLength(lengthBeats);
      return ok(`Set clip length to ${lengthBeats} beats on ${r.id}.`);
    },
  );

  // --- Clip pool ------------------------------------------------------------
  // A track owns a pool of note clips (patterns); the active one is edited by the
  // note tools and shown in the roll. Arrange them along time with the placement
  // tools below. Clips you create are tagged 'claude'.
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
      if (!sendToTab(msg)) return fail("No DAW tab connected.");
      mirror.addClip(r.id, { id, name, fromClipId: from, empty, lengthBeats: length_beats, author: "claude" });
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
      if (!sendToTab({ type: "selectClip", trackId: r.id, clipId: clip_id })) return fail("No DAW tab connected.");
      mirror.selectClip(r.id, clip_id);
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
      if (!sendToTab({ type: "removeClip", trackId: r.id, clipId: clip_id })) return fail("No DAW tab connected.");
      mirror.removeClip(r.id, clip_id);
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
      if (!sendToTab({ type: "renameClip", trackId: r.id, clipId: clip_id, name }))
        return fail("No DAW tab connected.");
      mirror.renameClip(r.id, clip_id, name);
      return ok(`Renamed clip ${clip_id} to "${name}" on ${r.id}.`);
    },
  );

  // --- Arrangement placements -----------------------------------------------
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
      if (!sendToTab({ type: "addPlacement", trackId: r.id, id, clipId, startBeat: start_beat, length }))
        return fail("No DAW tab connected.");
      mirror.addPlacement(r.id, { id, clipId, startBeat: start_beat, length });
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
      if (!sendToTab({ type: "movePlacement", trackId: r.id, placementId: placement_id, startBeat: start_beat }))
        return fail("No DAW tab connected.");
      mirror.movePlacement(r.id, placement_id, start_beat);
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
      if (!sendToTab({ type: "removePlacement", trackId: r.id, placementId: placement_id }))
        return fail("No DAW tab connected.");
      mirror.removePlacement(r.id, placement_id);
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
      if (!sendToTab({ type: "splitPlacement", trackId: r.id, placementId: placement_id, atBeat: at_beat, newId }))
        return fail("No DAW tab connected.");
      mirror.splitPlacement(r.id, placement_id, at_beat, newId);
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
      if (!sendToTab({ type: "launchClip", trackId: r.id, clipId })) return fail("No DAW tab connected.");
      mirror.launchClip(r.id, clipId);
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
      if (!sendToTab({ type: "stopAllClips" })) return fail("No DAW tab connected.");
      mirror.stopAllClips();
      return ok("Stopped all launched clips; back to the timeline arrangement.");
    },
  );

  // --- Transport (project-level) -------------------------------------------
  server.registerTool(
    "set_tempo",
    {
      title: "Set tempo",
      description: "Set the project tempo in BPM (20-300).",
      inputSchema: { bpm: z.number().min(20).max(300) },
    },
    async ({ bpm }) => {
      if (!sendToTab({ type: "setTempo", bpm })) return fail("No DAW tab connected.");
      mirror.setTempo(bpm);
      return ok(`Tempo set to ${bpm} BPM.`);
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
      if (!sendToTab({ type: "setGroove", grooveId: groove, amount })) return fail("No DAW tab connected.");
      mirror.setGroove(groove, amount);
      const g = mirror.getGroove();
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
          { grooves: GROOVES.map((g) => ({ id: g.id, name: g.name })), current: mirror.getGroove() },
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
      if (!sendToTab({ type: "setLength", lengthBeats })) return fail("No DAW tab connected.");
      mirror.setLength(lengthBeats);
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
      if (!sendToTab({ type: "setLoopStart", beats })) return fail("No DAW tab connected.");
      mirror.setLoopStart(beats);
      return ok(`Loop start set to ${beats} beats.`);
    },
  );

  server.registerTool("play", { title: "Play", description: "Start playback (loops all tracks)." }, async () =>
    sendToTab({ type: "transport", action: "play" }) ? ok("Playing.") : fail("No DAW tab connected."),
  );
  server.registerTool("stop", { title: "Stop", description: "Stop playback." }, async () =>
    sendToTab({ type: "transport", action: "stop" }) ? ok("Stopped.") : fail("No DAW tab connected."),
  );

  // --- Version history (commit DAG; lives in the tab, queried over RPC) -------
  // A commit is a durable, named snapshot of the whole project. The history is a
  // DAG: list_history walks it newest-first, diff reads the musical changes
  // between two commits, commit stamps a new version, revert_to rolls back
  // (append-only, git-revert style). Claude's commits/reverts are authored coral.
  type HistoryEntry = { id: string; message: string; author: string; time: number; auto: boolean; entryCount: number };

  /** Run a history RPC; map transport/tab errors to a tool failure. */
  const runHistory = async (
    method: HistoryMethod,
    params?: Record<string, unknown>,
  ): Promise<Reply | { tabError: string }> => {
    try {
      return await requestTab(method, params);
    } catch (err) {
      return { tabError: err instanceof Error ? err.message : String(err) };
    }
  };

  server.registerTool(
    "commit",
    {
      title: "Commit version",
      description:
        "Stamp a named version (checkpoint) of the whole project, capturing every change since the last commit. Returns the new commit id, or notes there was nothing to commit.",
      inputSchema: { message: z.string().min(1).describe("a short, human-readable description of this version") },
    },
    async ({ message }) => {
      const r = await runHistory("commit", { message });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Commit failed.");
      const summary = r.result as HistoryEntry | null;
      return summary
        ? ok(`Committed "${summary.message}" (id ${summary.id}).`)
        : ok("Nothing to commit - no changes since the last version.");
    },
  );

  server.registerTool(
    "list_history",
    {
      title: "List history",
      description:
        "List the project version history (commits) newest-first: id, message, author, auto/named, and change count.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("max commits to return (default 100)"),
      },
    },
    async ({ limit }) => {
      const r = await runHistory("history", { limit });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not read history.");
      return ok(JSON.stringify(r.result, null, 2));
    },
  );

  server.registerTool(
    "diff",
    {
      title: "Diff versions",
      description:
        "Show the readable musical changes for a commit (vs its parent), or between two commits if `from` is given. Ids come from list_history.",
      inputSchema: {
        to: z.string().describe("the commit to inspect (its id from list_history)"),
        from: z.string().optional().describe("compare against this commit instead of the parent"),
      },
    },
    async ({ to, from }) => {
      const r = await runHistory("diff", { toId: to, fromId: from });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not diff.");
      const changes = (r.result as string[]) ?? [];
      return ok(changes.length ? changes.join("\n") : "No musical changes between these versions.");
    },
  );

  server.registerTool(
    "revert_to",
    {
      title: "Revert to version",
      description:
        "Roll the project back to a past commit. Append-only (git-revert style): it records a new version restoring the old state, so nothing is lost. Id comes from list_history.",
      inputSchema: { commit: z.string().describe("the commit id to restore (from list_history)") },
    },
    async ({ commit }) => {
      const r = await runHistory("revert", { commitId: commit });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Revert failed.");
      const summary = r.result as HistoryEntry | null;
      return summary ? ok(`Reverted: "${summary.message}" (id ${summary.id}).`) : fail(`Unknown commit "${commit}".`);
    },
  );

  // --- Patches (saved instrument presets, in the tab's localStorage) --------
  const runPatch = async (
    method: PatchMethod,
    params?: Record<string, unknown>,
  ): Promise<Reply | { tabError: string }> => {
    try {
      return await requestPatch(method, params);
    } catch (err) {
      return { tabError: err instanceof Error ? err.message : String(err) };
    }
  };

  server.registerTool(
    "list_patches",
    {
      title: "List patches",
      description:
        "List the saved instrument patches (presets) in the user library: id, name, author, instrument type, and effect types. Patches are global (shared across projects).",
      inputSchema: {},
    },
    async () => {
      const r = await runPatch("list");
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not read patches.");
      return ok(JSON.stringify(r.result, null, 2));
    },
  );

  server.registerTool(
    "save_patch",
    {
      title: "Save patch",
      description:
        "Save an instrument track's sound (its instrument + parameter values + effect chain) as a named, reusable patch in the user library. Defaults to the selected track.",
      inputSchema: {
        name: z.string().min(1).max(60).describe("name for the saved patch"),
        track: z.string().optional().describe("instrument track id (default: the selected track)"),
      },
    },
    async ({ name, track }) => {
      const r = await runPatch("save", { name, trackId: track });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not save the patch.");
      const saved = r.result as { id: string; name: string };
      return ok(`Saved patch "${saved.name}" (id ${saved.id}).`);
    },
  );

  server.registerTool(
    "apply_patch",
    {
      title: "Apply patch",
      description:
        "Add a new instrument track from a saved patch (by name or id from list_patches). One undoable edit; the track files into the instrument family group.",
      inputSchema: {
        patch: z.string().min(1).describe("patch name or id (from list_patches)"),
        name: z.string().optional().describe("name for the new track (default: the patch name)"),
      },
    },
    async ({ patch, name }) => {
      const r = await runPatch("apply", { patch, name });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not apply the patch.");
      const added = r.result as { trackId: string; name: string };
      return ok(`Added "${added.name}" from the patch library (track ${added.trackId}).`);
    },
  );

  // --- Activity feed annotation ---------------------------------------------
  server.registerTool(
    "note",
    {
      title: "Note in the activity feed",
      description:
        'Post a short line of narration to the activity feed describing what you are about to do or why (e.g. "building a dreamy pad for the chorus"). Purely a feed annotation - it changes nothing and is not undoable. Use it to give the user context as you work.',
      inputSchema: { text: z.string().min(1).max(200) },
    },
    async ({ text }) => (sendToTab({ type: "note", text }) ? ok("Noted in the feed.") : fail("No DAW tab connected.")),
  );

  // --- Live notes -----------------------------------------------------------
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
      return sendToTab({ type: "noteOn", trackId: r.id, midi, velocity })
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
      return sendToTab({ type: "noteOff", trackId: r.id, midi })
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
      if (!sendToTab({ type: "noteOn", trackId: r.id, midi, velocity })) return fail("No DAW tab connected.");
      const dur = durationMs ?? 500;
      setTimeout(() => sendToTab({ type: "noteOff", trackId: r.id, midi }), dur);
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
      if (!connected()) return fail("No DAW tab connected.");
      clearSequence();
      const gap = articulationMs ?? 30;
      let t = 0;
      for (const { midi, durationMs } of notes) {
        const start = t;
        sequenceTimers.push(setTimeout(() => sendToTab({ type: "noteOn", trackId: r.id, midi }), start));
        sequenceTimers.push(
          setTimeout(() => sendToTab({ type: "noteOff", trackId: r.id, midi }), start + Math.max(1, durationMs - gap)),
        );
        t += durationMs;
      }
      return ok(`Playing ${notes.length} notes over ${t}ms on ${r.id}.`);
    },
  );

  const close = async () => {
    clearSequence();
    for (const { timer } of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const client of wss.clients) client.terminate();
    tab = null;
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await server.close().catch(() => undefined);
  };

  return { server, close };
}

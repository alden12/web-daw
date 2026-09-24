/**
 * The browser end of the MCP bridge. Makes the tab a client of the SAME project
 * model the UI uses: inbound commands edit the ProjectStore (structure), each
 * track's ParamStore/ClipStore, or drive instruments/scheduler; local changes
 * (structure, per-track params, per-track clips) are mirrored back to the server.
 */
import type { ProjectStore } from "../project/projectStore";
import type { AudioEngine } from "../engine/AudioEngine";
import type { Scheduler } from "../sequencer/scheduler";
import type { EditLog } from "../commands/editLog";
import type { EditCommand } from "../commands/types";
import type { VersionStore } from "../commands/history";
import { savePatch, newPatchId } from "../patches/library";
import { listPatchSummaries, patchDetails, patchTrackCommand } from "../patches/patchTools";
import { DEFAULT_WS_PORT } from "./protocol";
import type { BrowserToServer, HistoryMethod, PatchMethod, ServerToBrowser } from "./protocol";

export type McpStatus = "connecting" | "connected" | "disconnected";

export interface McpBridgeDeps {
  projectStore: ProjectStore;
  engine: AudioEngine;
  scheduler: Scheduler;
  editLog: EditLog;
  versionStore: VersionStore;
}

export interface McpBridgeOptions {
  url?: string;
  onStatus?: (status: McpStatus) => void;
}

export interface McpBridgeHandle {
  dispose(): void;
}

/**
 * Whether this page could reach the local MCP server at all. It listens on the laptop running
 * Claude Code, at `localhost`, so only a page served from that same machine can talk to it. The
 * hosted app (or a phone on the LAN) would only fail to connect and retry forever, filling the
 * console with refused connections - its agents use the hosted `/mcp` instead.
 */
export const localBridgeReachable = (hostname: string = location.hostname): boolean =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);

export function connectMcpBridge(deps: McpBridgeDeps, options: McpBridgeOptions = {}): McpBridgeHandle {
  const { projectStore, engine, scheduler, editLog, versionStore } = deps;
  const url = options.url ?? `ws://localhost:${DEFAULT_WS_PORT}`;
  const setStatus = (s: McpStatus) => options.onStatus?.(s);

  let ws: WebSocket | null = null;
  let structureUnsub: (() => void) | null = null;
  let trackUnsubs: (() => void)[] = [];
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 500;
  let disposed = false;

  const send = (msg: BrowserToServer) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  // Inbound from the MCP server. Durable edits route through the shared edit log as the AGENT,
  // authored for the user driving it (`editLog.agentAuthor`, see commands/authors.ts), so they are
  // logged, undoable by that person, and coloured as the agent voice - via the same applyEdit path
  // the UI uses. Navigation / live notes / transport are not edits and are applied directly. The
  // mapped type keeps the live set exhaustive.
  type LiveType = "selectTrack" | "selectClip" | "noteOn" | "noteOff" | "allNotesOff" | "transport" | "note";
  type LiveHandlers = { [K in LiveType]: (msg: Extract<ServerToBrowser, { type: K }>) => void };
  const live: LiveHandlers = {
    selectTrack: (msg) => projectStore.selectTrack(msg.trackId),
    selectClip: (msg) => projectStore.selectClip(msg.trackId, msg.clipId),
    noteOn: (msg) => engine.getNoteTarget(msg.trackId)?.noteOn(msg.midi, msg.velocity ?? 1),
    noteOff: (msg) => engine.getNoteTarget(msg.trackId)?.noteOff(msg.midi),
    allNotesOff: () => projectStore.getTracks().forEach((track) => engine.getNoteTarget(track.id)?.allNotesOff()),
    transport: (msg) => (msg.action === "play" ? scheduler.play() : scheduler.stop()),
    // Feed annotation from the agent: a line of intent narration in the activity feed.
    note: (msg) => editLog.note(msg.text, editLog.agentAuthor),
  };
  const liveTypes = new Set<string>([
    "selectTrack",
    "selectClip",
    "noteOn",
    "noteOff",
    "allNotesOff",
    "transport",
    "note",
  ]);

  // Version-history RPC. Each method maps to a VersionStore call; the agent's commits and reverts
  // are authored as the agent, for the user driving it. `diff` defaults `fromId` to the commit's
  // parent ("what changed in this version"). Results are sent back as historyReply.
  const p = (params: Record<string, unknown> | undefined) => params ?? {};
  const historyMethods: { [K in HistoryMethod]: (params: Record<string, unknown>) => Promise<unknown> } = {
    commit: (params) => versionStore.commit(params.message as string | undefined, editLog.agentAuthor),
    revert: (params) => versionStore.revertTo(params.commitId as string, editLog.agentAuthor),
    history: (params) => versionStore.history(params.limit as number | undefined),
    state: async () => versionStore.getState(),
    diff: async (params) => {
      const toId = params.toId as string;
      let fromId = params.fromId as string | undefined;
      if (!fromId) fromId = (await versionStore.getCommit(toId))?.parent ?? toId;
      return versionStore.diff(fromId, toId);
    },
  };

  const handleHistoryRequest = async (msg: Extract<ServerToBrowser, { type: "historyRequest" }>) => {
    const fn = historyMethods[msg.method];
    if (!fn) return send({ type: "historyReply", id: msg.id, ok: false, error: `Unknown method ${msg.method}` });
    try {
      send({ type: "historyReply", id: msg.id, ok: true, result: await fn(p(msg.params)) });
    } catch (err) {
      send({ type: "historyReply", id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Patch-library RPC. Patches live in this tab (localStorage), so the server can
  // only reach them through us. `save` captures a track's live sound; `apply`
  // dispatches a createTrackFromPatch edit authored as the agent (violet, undoable by the user
  // driving it, replayable - effect ids minted here and carried in the command).
  const patchMethods: { [K in PatchMethod]: (params: Record<string, unknown>) => unknown } = {
    list: () => listPatchSummaries(),
    // Full specifics of one patch (param values + per-effect params), for inspecting or
    // promoting a user patch into the factory bank. Searches factory + user by id/name.
    get: (params) => patchDetails(String(params.patch ?? "")),
    save: (params) => {
      const trackId = (params.trackId as string | undefined) ?? projectStore.selectedId ?? undefined;
      const track = trackId ? projectStore.getTrack(trackId) : undefined;
      if (!track) throw new Error("No track specified and none selected.");
      if (track.kind !== "instrument")
        throw new Error(`Track ${track.id} is an audio track; patches need an instrument track.`);
      const patch = {
        id: newPatchId(),
        name: (params.name as string | undefined)?.trim() || track.name,
        author: editLog.agentAuthor,
        instrumentType: track.instrumentType,
        params: track.params.snapshot(),
        midiDevices: track.midiDevices.map((device) => ({
          type: device.type,
          bypassed: device.bypassed,
          params: device.params.snapshot(),
        })),
        effects: track.effects.map((fx) => ({ type: fx.type, bypassed: fx.bypassed, params: fx.params.snapshot() })),
        createdAt: Date.now(),
      };
      savePatch(patch);
      return { id: patch.id, name: patch.name };
    },
    apply: (params) => {
      const command = patchTrackCommand(String(params.patch ?? ""), params.name as string | undefined);
      editLog.dispatchAsAgent(command);
      return { trackId: command.id, name: command.name };
    },
  };

  const handlePatchRequest = (msg: Extract<ServerToBrowser, { type: "patchRequest" }>) => {
    const fn = patchMethods[msg.method];
    if (!fn) return send({ type: "patchReply", id: msg.id, ok: false, error: `Unknown method ${msg.method}` });
    try {
      send({ type: "patchReply", id: msg.id, ok: true, result: fn(p(msg.params)) });
    } catch (err) {
      send({ type: "patchReply", id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const handle = (msg: ServerToBrowser) => {
    if (msg.type === "historyRequest") void handleHistoryRequest(msg);
    else if (msg.type === "patchRequest") handlePatchRequest(msg);
    else if (liveTypes.has(msg.type)) (live[msg.type as LiveType] as (m: ServerToBrowser) => void)(msg);
    else editLog.dispatchAsAgent(msg as EditCommand);
  };

  // Per-track/group param/clip subscriptions, rebuilt whenever structure changes.
  // Effects are host-addressed (the host is the track or group that owns them).
  const resubscribeTracks = () => {
    for (const unsub of trackUnsubs) unsub();
    trackUnsubs = [
      ...projectStore.getTracks().flatMap((track) => [
        ...(track.kind === "instrument"
          ? [
              track.params.subscribe((id, value) => send({ type: "paramChanged", trackId: track.id, id, value })),
              // One subscription per clip in the pool; the snapshot carries the clip id.
              ...track.clips.map((clip) =>
                clip.store.subscribe(() =>
                  send({ type: "clipSnapshot", trackId: track.id, clipId: clip.id, clip: clip.store.snapshot() }),
                ),
              ),
              ...track.midiDevices.map((device) =>
                device.params.subscribe((id, value) =>
                  send({ type: "midiDeviceParamChanged", trackId: track.id, deviceId: device.id, id, value }),
                ),
              ),
            ]
          : []),
        ...track.effects.map((effect) =>
          effect.params.subscribe((id, value) =>
            send({ type: "effectParamChanged", hostId: track.id, effectId: effect.id, id, value }),
          ),
        ),
      ]),
      ...projectStore
        .getGroups()
        .flatMap((group) =>
          group.effects.map((effect) =>
            effect.params.subscribe((id, value) =>
              send({ type: "effectParamChanged", hostId: group.id, effectId: effect.id, id, value }),
            ),
          ),
        ),
    ];
  };

  const wireOutbound = () => {
    send({ type: "projectSnapshot", project: projectStore.snapshot() });
    structureUnsub = projectStore.subscribe(() => {
      resubscribeTracks();
      send({ type: "projectStructure", project: projectStore.snapshot() });
    });
    resubscribeTracks();
  };

  const teardownOutbound = () => {
    structureUnsub?.();
    structureUnsub = null;
    for (const unsub of trackUnsubs) unsub();
    trackUnsubs = [];
  };

  const connect = () => {
    if (disposed) return;
    setStatus("connecting");
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      backoff = 500;
      setStatus("connected");
      wireOutbound();
    };

    socket.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data as string) as ServerToBrowser);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      teardownOutbound();
      ws = null;
      if (disposed) return;
      setStatus("disconnected");
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 8000);
    };

    socket.onerror = () => socket.close();
  };

  connect();

  return {
    dispose() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      teardownOutbound();
      ws?.close();
      ws = null;
    },
  };
}

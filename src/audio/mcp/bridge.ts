/**
 * The browser end of the MCP bridge. Makes the tab a client of the SAME project
 * model the UI uses: inbound commands edit the ProjectStore (structure), each
 * track's ParamStore/ClipStore, or drive instruments/scheduler; local changes
 * (structure, per-track params, per-track clips) are mirrored back to the server.
 */
import type { ProjectStore } from '../project/projectStore';
import type { AudioEngine } from '../engine/AudioEngine';
import type { Scheduler } from '../sequencer/scheduler';
import type { EditLog } from '../commands/editLog';
import type { EditCommand } from '../commands/types';
import type { VersionStore } from '../commands/history';
import { newEffectId, newTrackId } from '../commands/ids';
import { listPatches, savePatch, newPatchId } from '../patches/library';
import { DEFAULT_WS_PORT } from './protocol';
import type { BrowserToServer, HistoryMethod, PatchMethod, ServerToBrowser } from './protocol';

export type McpStatus = 'connecting' | 'connected' | 'disconnected';

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

  // Inbound from the server (Claude). Durable edits route through the shared edit
  // log authored 'claude' (so they are logged, undoable, two-voice) via the same
  // applyEdit path the UI uses. Navigation / live notes / transport are not edits
  // and are applied directly. The mapped type keeps the live set exhaustive.
  type LiveType = 'selectTrack' | 'selectClip' | 'noteOn' | 'noteOff' | 'allNotesOff' | 'transport' | 'note';
  type LiveHandlers = { [K in LiveType]: (msg: Extract<ServerToBrowser, { type: K }>) => void };
  const live: LiveHandlers = {
    selectTrack: (msg) => projectStore.selectTrack(msg.trackId),
    selectClip: (msg) => projectStore.selectClip(msg.trackId, msg.clipId),
    noteOn: (msg) => engine.getInstrument(msg.trackId)?.noteOn(msg.midi, msg.velocity ?? 1),
    noteOff: (msg) => engine.getInstrument(msg.trackId)?.noteOff(msg.midi),
    allNotesOff: () => projectStore.getTracks().forEach((t) => engine.getInstrument(t.id)?.allNotesOff()),
    transport: (msg) => (msg.action === 'play' ? scheduler.play() : scheduler.stop()),
    // Feed annotation from Claude: a line of intent narration in the activity feed.
    note: (msg) => editLog.note(msg.text, 'claude'),
  };
  const liveTypes = new Set<string>(['selectTrack', 'selectClip', 'noteOn', 'noteOff', 'allNotesOff', 'transport', 'note']);

  // Version-history RPC. Each method maps to a VersionStore call; Claude's commits
  // and reverts are authored 'claude'. `diff` defaults `fromId` to the commit's
  // parent ("what changed in this version"). Results are sent back as historyReply.
  const p = (params: Record<string, unknown> | undefined) => params ?? {};
  const historyMethods: { [K in HistoryMethod]: (params: Record<string, unknown>) => Promise<unknown> } = {
    commit: (params) => versionStore.commit(params.message as string | undefined, 'claude'),
    revert: (params) => versionStore.revertTo(params.commitId as string, 'claude'),
    history: (params) => versionStore.history(params.limit as number | undefined),
    state: async () => versionStore.getState(),
    diff: async (params) => {
      const toId = params.toId as string;
      let fromId = params.fromId as string | undefined;
      if (!fromId) fromId = (await versionStore.getCommit(toId))?.parent ?? toId;
      return versionStore.diff(fromId, toId);
    },
  };

  const handleHistoryRequest = async (msg: Extract<ServerToBrowser, { type: 'historyRequest' }>) => {
    const fn = historyMethods[msg.method];
    if (!fn) return send({ type: 'historyReply', id: msg.id, ok: false, error: `Unknown method ${msg.method}` });
    try {
      send({ type: 'historyReply', id: msg.id, ok: true, result: await fn(p(msg.params)) });
    } catch (err) {
      send({ type: 'historyReply', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Patch-library RPC. Patches live in this tab (localStorage), so the server can
  // only reach them through us. `save` captures a track's live sound; `apply`
  // dispatches a createTrackFromPatch edit authored 'claude' (coral, undoable,
  // replayable - effect ids minted here and carried in the command).
  const patchMethods: { [K in PatchMethod]: (params: Record<string, unknown>) => unknown } = {
    list: () =>
      listPatches().map((pt) => ({
        id: pt.id,
        name: pt.name,
        author: pt.author,
        instrument: pt.instrumentType,
        effects: pt.effects.map((fx) => fx.type),
      })),
    save: (params) => {
      const trackId = (params.trackId as string | undefined) ?? projectStore.selectedId ?? undefined;
      const track = trackId ? projectStore.getTrack(trackId) : undefined;
      if (!track) throw new Error('No track specified and none selected.');
      if (track.kind !== 'instrument') throw new Error(`Track ${track.id} is an audio track; patches need an instrument track.`);
      const patch = {
        id: newPatchId(),
        name: (params.name as string | undefined)?.trim() || track.name,
        author: 'claude' as const,
        instrumentType: track.instrumentType,
        params: track.params.snapshot(),
        effects: track.effects.map((fx) => ({ type: fx.type, bypassed: fx.bypassed, params: fx.params.snapshot() })),
        createdAt: Date.now(),
      };
      savePatch(patch);
      return { id: patch.id, name: patch.name };
    },
    apply: (params) => {
      const query = String(params.patch ?? '').trim();
      const all = listPatches();
      const patch = all.find((pt) => pt.id === query) ?? all.find((pt) => pt.name.toLowerCase() === query.toLowerCase());
      if (!patch) throw new Error(`No patch matching "${query}". Use list_patches.`);
      const command: EditCommand = {
        type: 'createTrackFromPatch',
        id: newTrackId(),
        name: (params.name as string | undefined)?.trim() || patch.name,
        instrumentType: patch.instrumentType,
        params: patch.params,
        effects: patch.effects.map((fx) => ({ id: newEffectId(), type: fx.type, bypassed: fx.bypassed, params: fx.params })),
      };
      editLog.dispatch(command, 'claude');
      return { trackId: command.id, name: command.name };
    },
  };

  const handlePatchRequest = (msg: Extract<ServerToBrowser, { type: 'patchRequest' }>) => {
    const fn = patchMethods[msg.method];
    if (!fn) return send({ type: 'patchReply', id: msg.id, ok: false, error: `Unknown method ${msg.method}` });
    try {
      send({ type: 'patchReply', id: msg.id, ok: true, result: fn(p(msg.params)) });
    } catch (err) {
      send({ type: 'patchReply', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const handle = (msg: ServerToBrowser) => {
    if (msg.type === 'historyRequest') void handleHistoryRequest(msg);
    else if (msg.type === 'patchRequest') handlePatchRequest(msg);
    else if (liveTypes.has(msg.type)) (live[msg.type as LiveType] as (m: ServerToBrowser) => void)(msg);
    else editLog.dispatch(msg as EditCommand, 'claude');
  };

  // Per-track/group param/clip subscriptions, rebuilt whenever structure changes.
  // Effects are host-addressed (the host is the track or group that owns them).
  const resubscribeTracks = () => {
    for (const u of trackUnsubs) u();
    trackUnsubs = [
      ...projectStore.getTracks().flatMap((t) => [
        ...(t.kind === 'instrument'
          ? [
              t.params.subscribe((id, value) => send({ type: 'paramChanged', trackId: t.id, id, value })),
              // One subscription per clip in the pool; the snapshot carries the clip id.
              ...t.clips.map((c) =>
                c.store.subscribe(() => send({ type: 'clipSnapshot', trackId: t.id, clipId: c.id, clip: c.store.snapshot() })),
              ),
            ]
          : []),
        ...t.effects.map((fx) =>
          fx.params.subscribe((id, value) => send({ type: 'effectParamChanged', hostId: t.id, effectId: fx.id, id, value })),
        ),
      ]),
      ...projectStore.getGroups().flatMap((g) =>
        g.effects.map((fx) =>
          fx.params.subscribe((id, value) => send({ type: 'effectParamChanged', hostId: g.id, effectId: fx.id, id, value })),
        ),
      ),
    ];
  };

  const wireOutbound = () => {
    send({ type: 'projectSnapshot', project: projectStore.snapshot() });
    structureUnsub = projectStore.subscribe(() => {
      resubscribeTracks();
      send({ type: 'projectStructure', project: projectStore.snapshot() });
    });
    resubscribeTracks();
  };

  const teardownOutbound = () => {
    structureUnsub?.();
    structureUnsub = null;
    for (const u of trackUnsubs) u();
    trackUnsubs = [];
  };

  const connect = () => {
    if (disposed) return;
    setStatus('connecting');
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      backoff = 500;
      setStatus('connected');
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
      setStatus('disconnected');
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

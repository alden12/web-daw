/**
 * The browser end of the MCP bridge. Makes the tab a client of the SAME project
 * model the UI uses: inbound commands edit the ProjectStore (structure), each
 * track's ParamStore/ClipStore, or drive instruments/scheduler; local changes
 * (structure, per-track params, per-track clips) are mirrored back to the server.
 */
import type { ProjectStore } from '../project/projectStore';
import type { AudioEngine } from '../engine/AudioEngine';
import type { Scheduler } from '../sequencer/scheduler';
import { DEFAULT_WS_PORT } from './protocol';
import type { BrowserToServer, ServerToBrowser } from './protocol';

export type McpStatus = 'connecting' | 'connected' | 'disconnected';

export interface McpBridgeDeps {
  projectStore: ProjectStore;
  engine: AudioEngine;
  scheduler: Scheduler;
}

export interface McpBridgeOptions {
  url?: string;
  onStatus?: (status: McpStatus) => void;
}

export interface McpBridgeHandle {
  dispose(): void;
}

export function connectMcpBridge(deps: McpBridgeDeps, options: McpBridgeOptions = {}): McpBridgeHandle {
  const { projectStore, engine, scheduler } = deps;
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

  // One handler per inbound message type (map dispatch, not switch). The mapped
  // type makes it a compile error to leave a message type unhandled.
  type Handlers = { [K in ServerToBrowser['type']]: (msg: Extract<ServerToBrowser, { type: K }>) => void };
  const handlers: Handlers = {
    createTrack: (msg) => void projectStore.addTrack(msg.instrumentType, msg.name, msg.id),
    removeTrack: (msg) => projectStore.removeTrack(msg.trackId),
    selectTrack: (msg) => projectStore.selectTrack(msg.trackId),
    setTrack: (msg) => {
      if (msg.muted !== undefined) projectStore.setMuted(msg.trackId, msg.muted);
      if (msg.volume !== undefined) projectStore.setVolume(msg.trackId, msg.volume);
      if (msg.name !== undefined) projectStore.renameTrack(msg.trackId, msg.name);
    },
    setParam: (msg) => projectStore.getTrack(msg.trackId)?.params.set(msg.id, msg.value),
    addEffect: (msg) => void projectStore.addEffect(msg.trackId, msg.effectType, msg.id),
    removeEffect: (msg) => projectStore.removeEffect(msg.trackId, msg.effectId),
    moveEffect: (msg) => projectStore.moveEffect(msg.trackId, msg.effectId, msg.toIndex),
    bypassEffect: (msg) => projectStore.setEffectBypass(msg.trackId, msg.effectId, msg.bypassed),
    setEffectParam: (msg) => projectStore.getEffect(msg.trackId, msg.effectId)?.params.set(msg.id, msg.value),
    addNote: (msg) => projectStore.getTrack(msg.trackId)?.clip.putNote(msg.note),
    removeNote: (msg) => projectStore.getTrack(msg.trackId)?.clip.removeNote(msg.id),
    clearClip: (msg) => projectStore.getTrack(msg.trackId)?.clip.clear(),
    noteOn: (msg) => engine.getInstrument(msg.trackId)?.noteOn(msg.midi, msg.velocity ?? 1),
    noteOff: (msg) => engine.getInstrument(msg.trackId)?.noteOff(msg.midi),
    allNotesOff: () => projectStore.getTracks().forEach((t) => engine.getInstrument(t.id)?.allNotesOff()),
    setTempo: (msg) => projectStore.setTempo(msg.bpm),
    transport: (msg) => (msg.action === 'play' ? scheduler.play() : scheduler.stop()),
  };

  const handle = (msg: ServerToBrowser) => (handlers[msg.type] as (m: ServerToBrowser) => void)?.(msg);

  // Per-track param/clip subscriptions, rebuilt whenever the track set changes.
  const resubscribeTracks = () => {
    for (const u of trackUnsubs) u();
    trackUnsubs = projectStore.getTracks().flatMap((t) => [
      t.params.subscribe((id, value) => send({ type: 'paramChanged', trackId: t.id, id, value })),
      t.clip.subscribe(() => send({ type: 'clipSnapshot', trackId: t.id, clip: t.clip.snapshot() })),
      ...t.effects.map((fx) =>
        fx.params.subscribe((id, value) =>
          send({ type: 'effectParamChanged', trackId: t.id, effectId: fx.id, id, value }),
        ),
      ),
    ]);
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

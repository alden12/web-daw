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

  const handle = (msg: ServerToBrowser) => {
    switch (msg.type) {
      case 'createTrack':
        projectStore.addTrack(msg.instrumentType, msg.name, msg.id);
        break;
      case 'removeTrack':
        projectStore.removeTrack(msg.trackId);
        break;
      case 'selectTrack':
        projectStore.selectTrack(msg.trackId);
        break;
      case 'setTrack':
        if (msg.muted !== undefined) projectStore.setMuted(msg.trackId, msg.muted);
        if (msg.volume !== undefined) projectStore.setVolume(msg.trackId, msg.volume);
        if (msg.name !== undefined) projectStore.renameTrack(msg.trackId, msg.name);
        break;
      case 'setParam':
        projectStore.getTrack(msg.trackId)?.params.set(msg.id, msg.value);
        break;
      case 'addNote':
        projectStore.getTrack(msg.trackId)?.clip.putNote(msg.note);
        break;
      case 'removeNote':
        projectStore.getTrack(msg.trackId)?.clip.removeNote(msg.id);
        break;
      case 'clearClip':
        projectStore.getTrack(msg.trackId)?.clip.clear();
        break;
      case 'noteOn':
        engine.getInstrument(msg.trackId)?.noteOn(msg.midi, msg.velocity ?? 1);
        break;
      case 'noteOff':
        engine.getInstrument(msg.trackId)?.noteOff(msg.midi);
        break;
      case 'allNotesOff':
        for (const t of projectStore.getTracks()) engine.getInstrument(t.id)?.allNotesOff();
        break;
      case 'setTempo':
        projectStore.setTempo(msg.bpm);
        break;
      case 'transport':
        if (msg.action === 'play') scheduler.play();
        else scheduler.stop();
        break;
    }
  };

  // Per-track param/clip subscriptions, rebuilt whenever the track set changes.
  const resubscribeTracks = () => {
    for (const u of trackUnsubs) u();
    trackUnsubs = projectStore.getTracks().flatMap((t) => [
      t.params.subscribe((id, value) => send({ type: 'paramChanged', trackId: t.id, id, value })),
      t.clip.subscribe(() => send({ type: 'clipSnapshot', trackId: t.id, clip: t.clip.snapshot() })),
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

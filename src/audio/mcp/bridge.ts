/**
 * The browser end of the MCP bridge. Connects to the Node MCP server's
 * WebSocket and makes the tab a client of the SAME stores the UI uses: inbound
 * param/clip writes go through ParamStore/ClipStore (so validation and the UI
 * stay consistent), note + transport messages drive the Synth and Scheduler,
 * and local store changes are mirrored back to the server.
 *
 * No audio-engine changes beyond consuming the existing store/synth/scheduler API.
 */
import type { ParamStore } from '../params/store';
import type { Synth } from '../synth/Synth';
import type { ClipStore } from '../sequencer/clipStore';
import type { Scheduler } from '../sequencer/scheduler';
import { DEFAULT_WS_PORT } from './protocol';
import type { BrowserToServer, ServerToBrowser } from './protocol';

export type McpStatus = 'connecting' | 'connected' | 'disconnected';

export interface McpBridgeDeps {
  paramStore: ParamStore;
  clipStore: ClipStore;
  synth: Synth;
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
  const { paramStore, clipStore, synth, scheduler } = deps;
  const url = options.url ?? `ws://localhost:${DEFAULT_WS_PORT}`;
  const setStatus = (s: McpStatus) => options.onStatus?.(s);

  let ws: WebSocket | null = null;
  let unsubs: (() => void)[] = [];
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 500;
  let disposed = false;

  const send = (msg: BrowserToServer) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const handle = (msg: ServerToBrowser) => {
    switch (msg.type) {
      case 'setParam':
        paramStore.set(msg.id, msg.value);
        break;
      case 'noteOn':
        synth.noteOn(msg.midi, msg.velocity ?? 1);
        break;
      case 'noteOff':
        synth.noteOff(msg.midi);
        break;
      case 'allNotesOff':
        synth.allNotesOff();
        break;
      case 'addNote':
        clipStore.putNote(msg.note);
        break;
      case 'removeNote':
        clipStore.removeNote(msg.id);
        break;
      case 'clearClip':
        clipStore.clear();
        break;
      case 'setTempo':
        clipStore.setTempo(msg.bpm);
        break;
      case 'transport':
        if (msg.action === 'play') scheduler.play();
        else scheduler.stop();
        break;
    }
  };

  const connect = () => {
    if (disposed) return;
    setStatus('connecting');
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      backoff = 500;
      setStatus('connected');
      // Send full current state, then mirror future local changes to the server.
      send({ type: 'snapshot', values: paramStore.snapshot() });
      send({ type: 'clipSnapshot', clip: clipStore.snapshot() });
      unsubs.push(
        paramStore.subscribe((id, value) => send({ type: 'paramChanged', id, value })),
        clipStore.subscribe(() => send({ type: 'clipSnapshot', clip: clipStore.snapshot() })),
      );
    };

    socket.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data as string) as ServerToBrowser);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      for (const u of unsubs) u();
      unsubs = [];
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
      for (const u of unsubs) u();
      unsubs = [];
      ws?.close();
      ws = null;
    },
  };
}

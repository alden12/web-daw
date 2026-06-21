/**
 * The browser end of the MCP bridge. Connects to the Node MCP server's
 * WebSocket and makes the tab a client of the SAME ParamStore the UI uses:
 * inbound setParam writes go through the store (so smoothing/validation are
 * shared), and local store changes are mirrored back to the server. Note
 * messages are forwarded straight to the Synth engine.
 *
 * No audio-engine changes: this only consumes the existing store and Synth API.
 */
import type { ParamStore } from '../params/store';
import type { Synth } from '../synth/Synth';
import { DEFAULT_WS_PORT } from './protocol';
import type { BrowserToServer, ServerToBrowser } from './protocol';

export type McpStatus = 'connecting' | 'connected' | 'disconnected';

export interface McpBridgeOptions {
  url?: string;
  onStatus?: (status: McpStatus) => void;
}

export interface McpBridgeHandle {
  dispose(): void;
}

export function connectMcpBridge(
  store: ParamStore,
  synth: Synth,
  options: McpBridgeOptions = {},
): McpBridgeHandle {
  const url = options.url ?? `ws://localhost:${DEFAULT_WS_PORT}`;
  const setStatus = (s: McpStatus) => options.onStatus?.(s);

  let ws: WebSocket | null = null;
  let unsubscribe: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 500;
  let disposed = false;

  const send = (msg: BrowserToServer) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const handle = (msg: ServerToBrowser) => {
    switch (msg.type) {
      case 'setParam':
        store.set(msg.id, msg.value);
        break;
      case 'noteOn':
        synth.noteOn(msg.midi);
        break;
      case 'noteOff':
        synth.noteOff();
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
      send({ type: 'snapshot', values: store.snapshot() });
      unsubscribe = store.subscribe((id, value) => send({ type: 'paramChanged', id, value }));
    };

    socket.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data as string) as ServerToBrowser);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      unsubscribe?.();
      unsubscribe = null;
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
      unsubscribe?.();
      ws?.close();
      ws = null;
    },
  };
}

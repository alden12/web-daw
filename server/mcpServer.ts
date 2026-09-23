/**
 * The local MCP server: the tools over a WebSocket to the open DAW tab. A control-plane over the
 * project model, never an audio path: tools read a mirror of the tab's project, validate against each
 * instrument's schema, and forward edits to the tab, which applies them as the agent. Everything is
 * track-addressed; `track` defaults to the selected track when omitted.
 *
 * The tools themselves live in `mcp/tools/`, registered against a `DawTarget`; this file is the
 * target that is a browser tab. `createDawMcp` returns the McpServer plus a close fn so it can be
 * driven by a stdio transport in production and an in-memory transport in tests.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { ProjectStore } from "../src/audio/project/projectStore";
import { DEFAULT_WS_PORT } from "../src/audio/mcp/protocol";
import type { BrowserToServer, HistoryMethod, PatchMethod, ServerToBrowser } from "../src/audio/mcp/protocol";
import type { DawTarget, Reply } from "./mcp/target";
import { makeToolContext } from "./mcp/context";
import { registerDawTools } from "./mcp/tools";

export interface DawMcp {
  server: McpServer;
  close(): Promise<void>;
}

export function createDawMcp(options: { port?: number; onError?: (err: NodeJS.ErrnoException) => void } = {}): DawMcp {
  const port = options.port ?? DEFAULT_WS_PORT;

  // The server's mirror of the tab's project, kept current by the sync messages.
  const mirror = new ProjectStore(false);

  // Pending version-history RPCs, keyed by correlation id (see requestTab).
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
    midiDeviceParamChanged: (msg) => mirror.getMidiDevice(msg.trackId, msg.deviceId)?.params.set(msg.id, msg.value),
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
    console.error(`[corrente] WebSocket server error: ${err.message}`);
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

  const target: DawTarget = {
    project: mirror,
    send: sendToTab,
    connected,
    requestHistory: requestTab,
    requestPatch,
  };
  const server = new McpServer({ name: "corrente", version: "0.1.0" });
  const context = makeToolContext(server, target);
  registerDawTools(context);

  const close = async () => {
    context.clearSequence();
    for (const { timer } of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const client of wss.clients) client.terminate();
    tab = null;
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await server.close().catch(() => undefined);
  };

  return { server, close };
}

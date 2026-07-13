/**
 * The realtime WebSocket endpoint (path from `channels.main`, i.e. `/ws`), attached to the same Node
 * HTTP server that serves the Hono app so the socket shares the API origin. Each connection subscribes
 * to one project and then streams edits; the ordering/apply/persist/broadcast logic lives in the
 * `Room` authority (rooms.ts) - this file is only the transport glue (parse frames, route to the room,
 * clean up on close).
 *
 * Auth: a browser `WebSocket` cannot set an Authorization header, so the shared token (when set) is
 * read from the `?token=` query at the upgrade - mirroring the HTTP bearer gate. Owner is the stubbed
 * single principal for now.
 */
import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "node:http";
import type { EditCommand } from "../../src/audio/commands/types";
import { channels, parseClientMessage } from "../../src/contract/ws";
import type { Db } from "../db/types";
import { RoomRegistry, type RoomClient } from "./rooms";

export interface WsOptions {
  db: Db;
  /** Shared bearer token; empty/unset = open (local dev). */
  token?: string;
  /** The principal every connection maps to (stubbed single owner until real auth). */
  ownerId?: string;
  /** Trace connection lifecycle + each message to the console. On in dev, off in prod. */
  log?: boolean;
}

/** Attach the multiplayer socket server to an existing HTTP server. Returns it for lifecycle control. */
export function attachWsServer(server: Server, options: WsOptions): WebSocketServer {
  const token = options.token ?? "";
  const ownerId = options.ownerId ?? "local";
  const registry = new RoomRegistry(options.db);
  const wss = new WebSocketServer({ server, path: channels.main.path });
  const log = options.log ? (message: string) => console.log(`[web-daw ws] ${message}`) : () => {};

  wss.on("connection", (socket, request) => {
    const provided = new URL(request.url ?? "", "http://localhost").searchParams.get("token") ?? undefined;
    if (token && provided !== token) {
      log("connection rejected (unauthorized)");
      socket.close(1008, "unauthorized");
      return;
    }
    log("connection opened");
    const client: RoomClient = {
      send: (message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    // A connection is scoped to one project (its room), fixed by the first `subscribe`.
    let projectId: string | null = null;

    socket.on("message", async (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        client.send({ type: "error", message: "invalid JSON" });
        return;
      }
      const parsed = parseClientMessage(raw);
      if (!parsed.success) {
        log("dropped an unrecognised message");
        client.send({ type: "error", message: "unrecognised message" });
        return;
      }
      const message = parsed.data;
      if (message.type === "ping") {
        client.send({ type: "pong" });
        return;
      }
      if (message.type === "subscribe") {
        projectId = message.projectId;
        const room = await registry.get(ownerId, projectId);
        await room.subscribe(client);
        log(`subscribe ${projectId} (now ${room.connectionCount} peer(s))`);
        return;
      }
      // edit: must be for the subscribed project.
      if (projectId !== message.projectId) {
        client.send({ type: "error", message: "subscribe to the project before editing it" });
        return;
      }
      const room = await registry.get(ownerId, message.projectId);
      const applied = await room.applyIncoming({
        command: message.command as EditCommand,
        opId: message.opId,
        author: message.author,
      });
      if (applied.type === "editApplied")
        log(`edit ${message.projectId} seq=${applied.seq} ${message.command.type} by ${applied.author}`);
    });

    socket.on("close", () => {
      if (projectId) {
        registry.leave(projectId, client);
        log(`connection closed (${projectId})`);
      } else {
        log("connection closed");
      }
    });
  });

  return wss;
}

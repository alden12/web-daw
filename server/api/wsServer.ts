/**
 * The realtime WebSocket endpoint (path from `channels.main`, i.e. `/ws`), attached to the same Node
 * HTTP server that serves the Hono app so the socket shares the API origin. Each connection subscribes
 * to one project and then streams edits; the ordering/apply/persist/broadcast logic lives in the
 * `Room` authority (rooms.ts) - this file is only the transport glue (parse frames, route to the room,
 * clean up on close).
 *
 * Auth: a browser `WebSocket` cannot set an Authorization header, so the token is read from the `?token=`
 * query at the upgrade - mirroring the HTTP bearer gate. That establishes *authentication* (who); the
 * room registry then does per-project *authorization* (may this user open this project?) - a subscribe to
 * a project the principal neither owns nor is a member of is refused.
 */
import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "node:http";
import type { EditCommand } from "../../src/audio/commands/types";
import { channels, parseClientMessage } from "../../src/contract/ws";
import type { Db } from "../db/types";
import { RoomRegistry, type RoomClient } from "./rooms";
import { makeDevResolver, makeJwtResolver, type AuthConfig, type ResolvePrincipal } from "./principal";

export interface WsOptions {
  db: Db;
  /** Real auth: verify a Supabase/OIDC JWT (from `?token=`) against this JWKS/issuer. When set the
   *  principal is the token's user; when unset, dev-stub mode (the single `ownerId` below, open). */
  auth?: AuthConfig;
  /** Inject a pre-built principal resolver (tests). Takes precedence over `auth`/`ownerId`. */
  resolvePrincipal?: ResolvePrincipal;
  /** Dev-stub: the single principal every connection maps to (local dev / tests; default "local"). */
  ownerId?: string;
  /** Trace connection lifecycle + each message to the console. On in dev, off in prod. */
  log?: boolean;
}

/** Attach the multiplayer socket server to an existing HTTP server. Returns it for lifecycle control. */
export function attachWsServer(server: Server, options: WsOptions): WebSocketServer {
  // Same principal seam as the HTTP layer (see app.ts): injected resolver > JWT verification > dev-stub.
  const resolvePrincipal =
    options.resolvePrincipal ??
    (options.auth
      ? makeJwtResolver(options.db, options.auth)
      : makeDevResolver(options.db, { devUserId: options.ownerId }));
  const registry = new RoomRegistry(options.db);
  const wss = new WebSocketServer({ server, path: channels.main.path });
  const log = options.log ? (message: string) => console.log(`[web-daw ws] ${message}`) : () => {};

  wss.on("connection", (socket, request) => {
    // Verify identity at the upgrade (a browser WebSocket can't set headers, so the credential rides
    // `?token=`, mirroring the HTTP bearer gate). Resolution is async; the message handler awaits it, so
    // an early `subscribe` is held rather than dropped. On failure we close 1008. This establishes
    // *authentication* (who) only; per-project *authorization* (may this user open this project?) is
    // enforced per message below, where each `subscribe`/edit passes through `registry.get` (owner-or-member).
    const credential = new URL(request.url ?? "", "http://localhost").searchParams.get("token") ?? undefined;
    const principalPromise = resolvePrincipal(credential);
    void principalPromise.then((resolved) => {
      if (resolved) {
        log("connection opened");
      } else {
        log("connection rejected (unauthorized)");
        socket.close(1008, "unauthorized");
      }
    });

    const client: RoomClient = {
      send: (message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    // A connection is scoped to one project (its room), fixed by the first `subscribe`.
    let projectId: string | null = null;

    socket.on("message", async (data) => {
      const principal = await principalPromise;
      if (!principal) return; // unauthorized; the socket is closing
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
        const room = await registry.get(message.projectId, principal);
        if (!room) {
          log(`subscribe ${message.projectId} refused (forbidden)`);
          client.send({ type: "error", message: "not authorized for this project" });
          socket.close(1008, "forbidden");
          return;
        }
        projectId = message.projectId;
        await room.subscribe(client);
        log(`subscribe ${projectId} (now ${room.connectionCount} peer(s))`);
        return;
      }
      // edit: must be for the subscribed project.
      if (projectId !== message.projectId) {
        client.send({ type: "error", message: "subscribe to the project before editing it" });
        return;
      }
      const room = await registry.get(message.projectId, principal);
      if (!room) {
        client.send({ type: "error", message: "not authorized for this project" });
        return;
      }
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

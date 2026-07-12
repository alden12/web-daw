/**
 * The WebSocket surface of the API, as plain data. Unlike HTTP (many request/response
 * routes), a socket is a bidirectional message bus, so the contract is two zod
 * discriminated-unions - what the client may send, and what the server may send - plus a
 * thin `channels` descriptor naming the endpoint and binding a union to each direction.
 * The message payloads reference the canonical project schema, so the wire, the disk, and
 * the client types are single-sourced.
 *
 * This is the realtime foundation: the destination is multiplayer editing (sync + live
 * play/record), which rides these messages over a socket. The message set here is minimal
 * and PROVISIONAL - ping/pong proves the bidirectional typed pipe, and one payload pair
 * (edit -> editApplied) shows messages carrying schema-typed payloads. Presence, cursors,
 * subscribe/resync, and the like are designed alongside the conflict-resolution (CRDT)
 * work, when the live socket server is stood up (it is deferred until then; today the
 * server implements only the HTTP surface). Keep new messages small and intent-based.
 *
 * Pure zod, DOM/Node-free - the server imports this.
 */
import { z } from "zod";
import { editCommandSchema } from "../audio/project/schema";

/** Messages the client sends to the server. Discriminated on `type`. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("edit"), projectId: z.string(), command: editCommandSchema }),
]);

/** Messages the server sends to the client. Discriminated on `type`. */
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pong") }),
  z.object({
    type: z.literal("editApplied"),
    projectId: z.string(),
    seq: z.number(),
    command: editCommandSchema,
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Validate an inbound client frame (server side). */
export const parseClientMessage = (raw: unknown) => clientMessageSchema.safeParse(raw);
/** Validate an inbound server frame (client side). */
export const parseServerMessage = (raw: unknown) => serverMessageSchema.safeParse(raw);

/** The socket channels: endpoint + which message union flows each way. */
export const channels = {
  main: {
    path: "/ws",
    client: clientMessageSchema,
    server: serverMessageSchema,
  },
} as const;

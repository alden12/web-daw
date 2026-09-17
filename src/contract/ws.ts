/**
 * The WebSocket surface of the API, as plain data. Unlike HTTP (many request/response
 * routes), a socket is a bidirectional message bus, so the contract is two zod
 * discriminated-unions - what the client may send, and what the server may send - plus a
 * thin `channels` descriptor naming the endpoint and binding a union to each direction.
 * The message payloads reference the canonical project schema, so the wire, the disk, and
 * the client types are single-sourced.
 *
 * This is the realtime foundation: the destination is multiplayer editing (sync + live
 * play/record), which rides these messages over a socket. The model (see docs/DESIGN.md,
 * sync-service roadmap) is a server-authoritative per-project authority: a client `subscribe`s,
 * gets a `snapshot`, then sends `edit`s (applied optimistically locally) that the authority
 * orders by assigning `seq`, applies, persists, and echoes back as `editApplied` to every peer.
 * The originator matches its `editApplied` by `opId` (retire the optimistic op + adopt the seq);
 * a peer's `editApplied` (an opId not its own) triggers a rebase. `baseSeq` tells the authority
 * the last seq the client had seen. Presence/cursors/live-MIDI are a later phase. Keep new
 * messages small and intent-based.
 *
 * Pure zod, DOM/Node-free - the server imports this.
 */
import { z } from "zod";
import { authorSchema, editCommandSchema, editEntrySchema } from "../audio/project/schema";

/** Messages the client sends to the server. Discriminated on `type`. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  /** Join a project's room; the server replies with a `snapshot`. */
  z.object({ type: z.literal("subscribe"), projectId: z.string() }),
  /** An optimistically-applied local edit. `opId` (client uuid) matches the echo and dedups a
   *  resend; `baseSeq` is the last authoritative seq the client had; `author` defaults to "you". */
  z.object({
    type: z.literal("edit"),
    projectId: z.string(),
    command: editCommandSchema,
    opId: z.string(),
    baseSeq: z.number(),
    author: authorSchema.optional(),
  }),
]);

/** Messages the server sends to the client. Discriminated on `type`. */
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pong") }),
  /** Catch-up on subscribe: the authoritative head and the recent edit stream to rebuild from. */
  z.object({
    type: z.literal("snapshot"),
    projectId: z.string(),
    headSeq: z.number(),
    entries: z.array(editEntrySchema),
  }),
  /** An edit the authority ordered + applied. Broadcast to every peer; the originator recognises
   *  it by `opId`. `seq` is the assigned order; `author` is who made it. */
  z.object({
    type: z.literal("editApplied"),
    projectId: z.string(),
    seq: z.number(),
    command: editCommandSchema,
    author: authorSchema,
    opId: z.string(),
  }),
  /** The authority refused an edit (e.g. not the owner); the client drops the optimistic op. */
  z.object({ type: z.literal("editRejected"), opId: z.string(), reason: z.string() }),
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

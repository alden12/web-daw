/**
 * The browser client derived from the contract: `createApiClient` turns the HTTP route
 * descriptors into typed methods, and `createWsClient` gives a typed send/receive wrapper
 * over the message unions. This is the only part of the contract that touches DOM globals
 * (`fetch`, `WebSocket`), so it is imported by client code only - never by the server
 * (which imports the pure ./http, ./ws, ./errors definitions).
 *
 * The two JSON control routes are typed straight from their `response` schemas. The three
 * file routes move raw bytes, so they get explicit methods (`readText`/`readBlob`/
 * `writeFile`/`fileExists`) that faithfully surface the PUT status contract as a result
 * value - the caller (RemoteBundleStore) applies the DAW's 409-idempotent policy.
 */
import type { z } from "zod";
import { routes } from "./http";
import { channels, parseServerMessage, type ClientMessage, type ServerMessage } from "./ws";
import type { ErrorBody } from "./errors";
import { IdleController } from "./idleController";

type ProjectList = z.infer<(typeof routes.listProjects)["response"]>;
/** One project in the library listing (id + name + modifiedAt + the caller's role). */
export type ProjectListing = ProjectList["projects"][number];
/** One member as returned by the Share panel. */
export type MemberEntry = z.infer<(typeof routes.listMembers)["response"]>["members"][number];

/** The bearer credential: either a fixed string, or a getter re-read per request/reconnect (so a
 *  refreshed auth token takes effect without rebuilding the client). Evaluated lazily via `resolveToken`. */
export type TokenSource = string | (() => string | undefined);
const resolveToken = (token: TokenSource | undefined): string | undefined =>
  typeof token === "function" ? token() : token;

/** An authored edit as carried over the wire (the structural contract shape). */
export type WireEditEntry = z.infer<(typeof routes.getEdits)["response"]>["entries"][number];

/** The outcome of a file write: ok, or a failure carrying the server's status + code. */
export type WriteOutcome = { ok: true } | { ok: false; status: number; error: string };

export interface ApiClient {
  /** The caller's accessible projects (owned + shared), each with the caller's role. */
  listProjects(): Promise<ProjectListing[]>;
  deleteProject(id: string): Promise<void>;
  readText(id: string, path: string): Promise<string | null>;
  readBlob(id: string, path: string): Promise<ArrayBuffer | null>;
  writeFile(id: string, path: string, body: BodyInit, contentType: string): Promise<WriteOutcome>;
  fileExists(id: string, path: string): Promise<boolean>;
  /** Append authored edits to the log; returns the project's current max seq. */
  appendEdits(id: string, entries: WireEditEntry[]): Promise<number>;
  /** Fetch edits with `seq > since` (from the start if omitted), oldest first. `limit` caps to the
   *  most recent N (bounded feed window). */
  getEdits(id: string, since?: number, limit?: number): Promise<WireEditEntry[]>;
  /** List a project's members (owner-only; throws 403 for a non-owner). */
  getMembers(id: string): Promise<MemberEntry[]>;
  /** Share a project with someone by email (owner-only). */
  addMember(id: string, email: string, role?: "editor"): Promise<void>;
  /** Revoke a member's access by email (owner-only). */
  removeMember(id: string, email: string): Promise<void>;
}

export function createApiClient(config: { baseUrl: string; token?: TokenSource }): ApiClient {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  // Re-evaluated per request, so a refreshed token is used without rebuilding the client.
  const authHeaders = (): Record<string, string> => {
    const token = resolveToken(config.token);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Path with each segment encoded but the separators preserved (matches the `:path{.+}` route).
  const fileUrl = (id: string, path: string): string => {
    const encoded = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${baseUrl}/projects/${encodeURIComponent(id)}/files/${encoded}`;
  };

  const getFile = async (id: string, path: string): Promise<Response | null> => {
    const res = await fetch(fileUrl(id, path), { headers: authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`sync: read ${path} failed (${res.status})`);
    return res;
  };

  return {
    async listProjects() {
      const res = await fetch(`${baseUrl}${routes.listProjects.path}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`sync: list projects failed (${res.status})`);
      const body = (await res.json()) as ProjectList;
      return body.projects;
    },

    async deleteProject(id) {
      const url = `${baseUrl}${routes.deleteProject.path.replace(":id", encodeURIComponent(id))}`;
      const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error(`sync: delete ${id} failed (${res.status})`);
    },

    async readText(id, path) {
      const res = await getFile(id, path);
      return res ? res.text() : null;
    },

    async readBlob(id, path) {
      const res = await getFile(id, path);
      return res ? res.arrayBuffer() : null;
    },

    async writeFile(id, path, body, contentType) {
      const headers = { ...authHeaders(), "Content-Type": contentType };
      const res = await fetch(fileUrl(id, path), { method: "PUT", headers, body });
      if (res.ok) return { ok: true };
      let error = res.statusText;
      try {
        error = ((await res.json()) as ErrorBody).error ?? error;
      } catch {
        /* non-JSON error body; keep the status text */
      }
      return { ok: false, status: res.status, error };
    },

    async fileExists(id, path) {
      const res = await fetch(fileUrl(id, path), { method: "HEAD", headers: authHeaders() });
      return res.ok;
    },

    async appendEdits(id, entries) {
      const url = `${baseUrl}${routes.appendEdits.path.replace(":id", encodeURIComponent(id))}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error(`sync: append edits to ${id} failed (${res.status})`);
      const body = (await res.json()) as z.infer<(typeof routes.appendEdits)["response"]>;
      return body.maxSeq;
    },

    async getEdits(id, since, limit) {
      const path = routes.getEdits.path.replace(":id", encodeURIComponent(id));
      const params = new URLSearchParams();
      if (since != null) params.set("since", String(since));
      if (limit != null) params.set("limit", String(limit));
      const query = params.toString();
      const url = query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`sync: get edits for ${id} failed (${res.status})`);
      const body = (await res.json()) as z.infer<(typeof routes.getEdits)["response"]>;
      return body.entries;
    },

    async getMembers(id) {
      const url = `${baseUrl}/projects/${encodeURIComponent(id)}/members`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`sync: list members of ${id} failed (${res.status})`);
      const body = (await res.json()) as z.infer<(typeof routes.listMembers)["response"]>;
      return body.members;
    },

    async addMember(id, email, role) {
      const url = `${baseUrl}/projects/${encodeURIComponent(id)}/members`;
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(role ? { email, role } : { email }),
      });
      if (!res.ok) {
        let error = res.statusText;
        try {
          error = ((await res.json()) as ErrorBody).error ?? error;
        } catch {
          /* non-JSON error body; keep the status text */
        }
        throw new Error(`sync: share ${id} with ${email} failed (${res.status}: ${error})`);
      }
    },

    async removeMember(id, email) {
      const url = `${baseUrl}/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(email)}`;
      const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error(`sync: remove ${email} from ${id} failed (${res.status})`);
    },
  };
}

/** Derive the WebSocket origin from the HTTP API base URL (they share host/port; the socket lives at
 *  `channels.main.path`). `http(s)` -> `ws(s)`; a bare host defaults to `ws://`. */
export function wsBaseFromApiUrl(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/$/, "");
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  return `ws://${trimmed}`;
}

/** A typed WebSocket wrapper: `send` only buffers/sends `ClientMessage`s (queuing until the socket
 *  opens), `onMessage` delivers validated `ServerMessage`s, and `onOpen` fires on every (re)connect.
 *  It reconnects automatically with capped exponential backoff after an unexpected drop, so a brief
 *  network blip or an API restart self-heals; `onOpen` is the session's cue to re-subscribe and re-send
 *  its unconfirmed edits. Thin transport glue over the contract's message unions. The token rides the
 *  query string because a browser `WebSocket` cannot set an Authorization header (the server reads
 *  `?token=` at the upgrade, mirroring the HTTP bearer gate). */
export function createWsClient(config: {
  baseUrl: string;
  token?: TokenSource;
  /** Override the idle / hidden-grace suspend thresholds (defaults live in `idleController.ts`). */
  idleMs?: number;
  hiddenGraceMs?: number;
}): {
  send(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): void;
  onOpen(handler: () => void): void;
  close(): void;
} {
  const base = `${config.baseUrl.replace(/\/$/, "")}${channels.main.path}`;
  const RECONNECT_BASE_MS = 500;
  const RECONNECT_MAX_MS = 10_000;

  // Handlers registered once, re-bound onto each socket instance across reconnects.
  const messageHandlers: Array<(message: ServerMessage) => void> = [];
  const openHandlers: Array<() => void> = [];
  // Sends made while the socket is not open queue here and flush once it opens (after the open handlers,
  // so a re-subscribe always precedes any queued edit).
  const backlog: ClientMessage[] = [];
  let socket: WebSocket;
  let closed = false;
  let retries = 0;

  // Suspend the socket when the session goes idle or the tab is hidden, so an open connection does not
  // pin the scale-to-zero server awake. `onWake` reopens; the open handler re-runs `resync`, so a
  // suspend/resume is just a short-lived disconnect the session already self-heals from.
  const idle = new IdleController({
    idleMs: config.idleMs,
    hiddenGraceMs: config.hiddenGraceMs,
    onSuspend: () => socket?.close(),
    onWake: () => {
      retries = 0;
      connect();
    },
  });

  const connect = (): void => {
    // Rebuild the URL per (re)connect so a refreshed token is picked up (the reconnect from slice 76
    // is also what re-applies it after a token rotation).
    const token = resolveToken(config.token);
    const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      retries = 0;
      idle.onOpen(); // fresh idle countdown per connection
      for (const handler of openHandlers) handler();
      for (const message of backlog) socket.send(JSON.stringify(message));
      backlog.length = 0;
    });
    socket.addEventListener("message", (event) => {
      const parsed = parseServerMessage(JSON.parse(String(event.data)));
      if (parsed.success) for (const handler of messageHandlers) handler(parsed.data);
    });
    socket.addEventListener("close", () => {
      if (closed) return; // deliberate close(): do not reconnect
      if (!idle.shouldReconnectAfterClose()) return; // suspended (idle) or hidden: wake on activity/visible
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** retries);
      retries += 1;
      setTimeout(connect, delay);
    });
  };
  connect();

  return {
    send(message) {
      idle.activity(); // reset the idle countdown; reopens the socket first if it was suspended
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      else backlog.push(message);
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onOpen(handler) {
      openHandlers.push(handler);
    },
    close() {
      closed = true;
      idle.dispose();
      socket.close();
    },
  };
}

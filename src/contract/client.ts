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

type ProjectList = z.infer<(typeof routes.listProjects)["response"]>;

/** An authored edit as carried over the wire (the structural contract shape). */
export type WireEditEntry = z.infer<(typeof routes.getEdits)["response"]>["entries"][number];

/** The outcome of a file write: ok, or a failure carrying the server's status + code. */
export type WriteOutcome = { ok: true } | { ok: false; status: number; error: string };

export interface ApiClient {
  listProjects(): Promise<string[]>;
  deleteProject(id: string): Promise<void>;
  readText(id: string, path: string): Promise<string | null>;
  readBlob(id: string, path: string): Promise<ArrayBuffer | null>;
  writeFile(id: string, path: string, body: BodyInit, contentType: string): Promise<WriteOutcome>;
  fileExists(id: string, path: string): Promise<boolean>;
  /** Append authored edits to the log; returns the project's current max seq. */
  appendEdits(id: string, entries: WireEditEntry[]): Promise<number>;
  /** Fetch edits with `seq > since` (from the start if omitted), oldest first. */
  getEdits(id: string, since?: number): Promise<WireEditEntry[]>;
}

export function createApiClient(config: { baseUrl: string; token?: string }): ApiClient {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const authHeaders: Record<string, string> = config.token ? { Authorization: `Bearer ${config.token}` } : {};

  // Path with each segment encoded but the separators preserved (matches the `:path{.+}` route).
  const fileUrl = (id: string, path: string): string => {
    const encoded = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${baseUrl}/projects/${encodeURIComponent(id)}/files/${encoded}`;
  };

  const getFile = async (id: string, path: string): Promise<Response | null> => {
    const res = await fetch(fileUrl(id, path), { headers: authHeaders });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`sync: read ${path} failed (${res.status})`);
    return res;
  };

  return {
    async listProjects() {
      const res = await fetch(`${baseUrl}${routes.listProjects.path}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`sync: list projects failed (${res.status})`);
      const body = (await res.json()) as ProjectList;
      return body.ids;
    },

    async deleteProject(id) {
      const url = `${baseUrl}${routes.deleteProject.path.replace(":id", encodeURIComponent(id))}`;
      const res = await fetch(url, { method: "DELETE", headers: authHeaders });
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
      const headers = { ...authHeaders, "Content-Type": contentType };
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
      const res = await fetch(fileUrl(id, path), { method: "HEAD", headers: authHeaders });
      return res.ok;
    },

    async appendEdits(id, entries) {
      const url = `${baseUrl}${routes.appendEdits.path.replace(":id", encodeURIComponent(id))}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error(`sync: append edits to ${id} failed (${res.status})`);
      const body = (await res.json()) as z.infer<(typeof routes.appendEdits)["response"]>;
      return body.maxSeq;
    },

    async getEdits(id, since) {
      const path = routes.getEdits.path.replace(":id", encodeURIComponent(id));
      const url = since != null ? `${baseUrl}${path}?since=${since}` : `${baseUrl}${path}`;
      const res = await fetch(url, { headers: authHeaders });
      if (!res.ok) throw new Error(`sync: get edits for ${id} failed (${res.status})`);
      const body = (await res.json()) as z.infer<(typeof routes.getEdits)["response"]>;
      return body.entries;
    },
  };
}

/** A typed WebSocket wrapper: `send` only accepts `ClientMessage`s, and `onMessage`
 *  delivers validated `ServerMessage`s. Thin transport glue over the contract's message
 *  unions - the live socket server it talks to arrives with the multiplayer work. */
export function createWsClient(baseUrl: string): {
  send(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): void;
  close(): void;
} {
  const url = `${baseUrl.replace(/\/$/, "")}${channels.main.path}`;
  const socket = new WebSocket(url);
  return {
    send(message) {
      socket.send(JSON.stringify(message));
    },
    onMessage(handler) {
      socket.addEventListener("message", (event) => {
        const parsed = parseServerMessage(JSON.parse(String(event.data)));
        if (parsed.success) handler(parsed.data);
      });
    },
    close() {
      socket.close();
    },
  };
}

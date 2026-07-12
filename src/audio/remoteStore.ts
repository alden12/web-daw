/**
 * The remote project storage backend: the sync server (server/api) behind the same
 * `BundleStore`/`ProjectStorage` seam as OPFS. Selected by `getProjectStorage()` when
 * `VITE_DAW_API_URL` is set, so nothing above the seam (repository, library, autosave)
 * changes - it just reads/writes bundle files over HTTP instead of to OPFS.
 *
 * Types: the JSON control routes (list/delete) go through Hono's typed RPC client
 * (`hc<AppType>`) - `AppType` is a type-only import from the server, fully erased at
 * runtime (no Node/postgres reaches the browser bundle). The file routes move raw bytes,
 * so `RemoteBundleStore` uses plain `fetch` (text/arrayBuffer/blob) for those.
 */
import { hc } from "hono/client";
import type { AppType } from "../../server/api/app";
import type { BundleStore, ProjectStorage } from "./bundleStore";

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** One project's bundle over the sync API, rooted at `projects/<id>/files/`. */
export class RemoteBundleStore implements BundleStore {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly projectId: string;

  constructor(baseUrl: string, token: string | undefined, projectId: string) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.projectId = projectId;
  }

  private fileUrl(path: string): string {
    const encoded = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${this.baseUrl}/projects/${encodeURIComponent(this.projectId)}/files/${encoded}`;
  }

  private async get(path: string): Promise<Response | null> {
    const res = await fetch(this.fileUrl(path), { headers: authHeaders(this.token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`sync: read ${path} failed (${res.status})`);
    return res;
  }

  async readText(path: string): Promise<string | null> {
    const res = await this.get(path);
    return res ? res.text() : null;
  }

  async readBlob(path: string): Promise<ArrayBuffer | null> {
    const res = await this.get(path);
    return res ? res.arrayBuffer() : null;
  }

  private async put(path: string, body: BodyInit, contentType: string): Promise<void> {
    const headers = { ...authHeaders(this.token), "Content-Type": contentType };
    const res = await fetch(this.fileUrl(path), { method: "PUT", headers, body });
    // 409 = a write-once commit already stored: same id means same content, so idempotent.
    if (res.status === 409) return;
    if (!res.ok) throw new Error(`sync: write ${path} failed (${res.status})`);
  }

  // The content-type tells the server how to store it: JSON text entries as queryable jsonb,
  // binary (samples) as bytea. `writeText` always carries JSON in our bundle format.
  async writeText(path: string, text: string): Promise<void> {
    await this.put(path, text, "application/json");
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    await this.put(path, blob, "application/octet-stream");
  }

  async exists(path: string): Promise<boolean> {
    const res = await fetch(this.fileUrl(path), { method: "HEAD", headers: authHeaders(this.token) });
    return res.ok;
  }
}

/** The multi-project root over the sync API: lists/deletes projects, hands out bundles. */
export class RemoteProjectStorage implements ProjectStorage {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly client: ReturnType<typeof hc<AppType>>;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.client = hc<AppType>(this.baseUrl, { headers: authHeaders(token) });
  }

  bundle(projectId: string): BundleStore {
    return new RemoteBundleStore(this.baseUrl, this.token, projectId);
  }

  async listProjectIds(): Promise<string[]> {
    const res = await this.client.projects.$get();
    if (!res.ok) throw new Error(`sync: list projects failed (${res.status})`);
    return (await res.json()).ids;
  }

  async deleteProject(projectId: string): Promise<void> {
    const res = await this.client.projects[":id"].$delete({ param: { id: projectId } });
    if (!res.ok) throw new Error(`sync: delete ${projectId} failed (${res.status})`);
  }
}

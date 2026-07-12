/**
 * The remote project storage backend: the sync server (server/api) behind the same
 * `BundleStore`/`ProjectStorage` seam as OPFS. Selected by `getProjectStorage()` when
 * `VITE_DAW_API_URL` is set, so nothing above the seam (repository, library, autosave)
 * changes - it just reads/writes bundle files over HTTP instead of to OPFS.
 *
 * These are thin adapters over `createApiClient` (src/contract/client.ts), the typed
 * client derived from the shared contract. The 409-as-idempotent behaviour for write-once
 * commits is the DAW's policy, applied here rather than in the transport.
 */
import { createApiClient, type ApiClient } from "../contract/client";
import type { BundleStore, ProjectStorage } from "./bundleStore";

/** One project's bundle over the sync API, rooted at `projects/<id>/files/`. */
export class RemoteBundleStore implements BundleStore {
  private readonly client: ApiClient;
  private readonly projectId: string;

  constructor(client: ApiClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }

  readText(path: string): Promise<string | null> {
    return this.client.readText(this.projectId, path);
  }

  readBlob(path: string): Promise<ArrayBuffer | null> {
    return this.client.readBlob(this.projectId, path);
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.write(path, text, "application/json");
  }

  async writeBlob(path: string, blob: Blob): Promise<void> {
    await this.write(path, blob, "application/octet-stream");
  }

  exists(path: string): Promise<boolean> {
    return this.client.fileExists(this.projectId, path);
  }

  // The content-type tells the server how to store it: JSON text entries as queryable jsonb,
  // binary (samples) as bytea. 409 = a write-once commit already stored: same id means same
  // content, so the write is idempotent - swallow it rather than fail.
  private async write(path: string, body: BodyInit, contentType: string): Promise<void> {
    const result = await this.client.writeFile(this.projectId, path, body, contentType);
    if (!result.ok && result.status !== 409) {
      throw new Error(`sync: write ${path} failed (${result.status})`);
    }
  }
}

/** The multi-project root over the sync API: lists/deletes projects, hands out bundles. */
export class RemoteProjectStorage implements ProjectStorage {
  private readonly client: ApiClient;

  constructor(baseUrl: string, token?: string) {
    this.client = createApiClient({ baseUrl, token });
  }

  bundle(projectId: string): BundleStore {
    return new RemoteBundleStore(this.client, projectId);
  }

  listProjectIds(): Promise<string[]> {
    return this.client.listProjects();
  }

  deleteProject(projectId: string): Promise<void> {
    return this.client.deleteProject(projectId);
  }
}

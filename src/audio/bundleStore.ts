/**
 * Low-level storage driver for a project *bundle* - a small folder of named
 * entries (text + binary), addressed by relative path (`manifest.json`,
 * `project.json`, `samples/<hash>`). The bundle layout lives one level up in
 * `projectRepository.ts`; this seam only knows how to read/write paths, so the
 * same repository logic runs over OPFS today and a real disk folder or a remote
 * later (see docs/DESIGN.md sections 8, 10). Everything is async, because OPFS is.
 *
 * Multi-project: every project is its own bundle under `projects/<id>/`. A
 * `ProjectStorage` hands out a rooted `BundleStore` per project id and can
 * enumerate/delete them; the repository singleton points at the current project.
 */
import { RemoteProjectStorage } from "./remoteStore";
import { CachedProjectStorage } from "./cachedStore";
import { getAccessToken } from "../auth/session";
import type { EditEntry } from "./commands/types";

export interface BundleStore {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBlob(path: string): Promise<ArrayBuffer | null>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Append authored edits to the bundle's edit log (append-only, idempotent by `seq`). */
  appendEdits(entries: EditEntry[]): Promise<void>;
  /** Read the edit log entries with `seq > sinceSeq` (all if `sinceSeq < 0`), oldest first. `limit`
   *  caps to the most recent N (a bounded feed window); omit for the full tail. */
  readEdits(sinceSeq: number, limit?: number): Promise<EditEntry[]>;
}

/** The parent directory (under the OPFS root) that holds every project bundle. */
const PROJECTS_DIR = "projects";

/** Where the remote-mode read-through cache mirrors bundles it has seen (a sibling of `projects/`, so a
 *  cached remote copy never collides with a locally-authored project of the same id). */
const REMOTE_CACHE_DIR = "remote-cache";

/**
 * The file-backed authored stream (used by the OPFS / in-memory stores): the one seq-ordered log of
 * edits AND feed notes lives in the bundle's `edits.json`, read-concat-written. Cheap locally; the
 * remote store overrides both methods with the append/fetch endpoints (backed by the `edits` table).
 * This is the single home for the feed since the unification - there is no separate `log.json`/
 * `notes.json`. Append is idempotent by `seq` so a re-append is a no-op.
 */
const EDIT_LOG_PATH = "edits.json";

async function readEditsFromFile(store: BundleStore, sinceSeq: number, limit?: number): Promise<EditEntry[]> {
  const raw = await store.readText(EDIT_LOG_PATH);
  const all = raw ? (JSON.parse(raw) as EditEntry[]) : [];
  const matching = all.filter((entry) => entry.seq > sinceSeq);
  return limit != null ? matching.slice(-limit) : matching;
}

/** Concat new entries onto the existing log, dropping any whose `seq` is already present (idempotent). */
function mergeEdits(existingRaw: string | null, entries: EditEntry[]): EditEntry[] {
  const all = existingRaw ? (JSON.parse(existingRaw) as EditEntry[]) : [];
  const seen = new Set(all.map((entry) => entry.seq));
  return all.concat(entries.filter((entry) => !seen.has(entry.seq)));
}

async function appendEditsToFile(store: BundleStore, entries: EditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const merged = mergeEdits(await store.readText(EDIT_LOG_PATH), entries);
  await store.writeText(EDIT_LOG_PATH, JSON.stringify(merged));
}

/**
 * Serialize OPFS writes to the SAME file, keyed by absolute path and shared across every
 * `OpfsBundleStore` instance. OPFS `createWritable` is copy-on-write: two overlapping writes to one file
 * each branch from the current contents and swap their own version in on `close()`, so the *last to
 * finish* wins - which is NOT the last one issued. A rapid burst (the offline pending-queue saves a
 * growing array on every op during a note drag) could therefore leave a stale, shorter snapshot on disk,
 * and an offline reload would then replay the pre-drop state and re-send it as authoritative. Chaining
 * each write behind the previous one for its path makes issue-order == write-order, so the newest state
 * always lands last. The map is module-level (not per-instance) because two `OpfsBundleStore`s can point
 * at the same file - e.g. the read-through cache and the offline mirror both touching a project's
 * `edits.json`. It is bounded by the file set per project.
 */
const opfsWriteChains = new Map<string, Promise<unknown>>();

/** Run `op` after any in-flight write to `absPath` completes, and record it as the new tail of that
 *  path's chain (swallowing errors so one failed write doesn't wedge the path). Exported for tests. */
export function serializeOpfsWrite<T>(absPath: string, op: () => Promise<T>): Promise<T> {
  const run = (opfsWriteChains.get(absPath) ?? Promise.resolve()).then(op, op);
  opfsWriteChains.set(
    absPath,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

/** Origin Private File System backend: the bundle is a real directory tree rooted at `root`. Writes to a
 *  given file serialize (see `serializeOpfsWrite`); reads don't - OPFS `getFile()` returns a whole-file
 *  snapshot, so a concurrent read sees either the old or the new complete contents, both valid. */
export class OpfsBundleStore implements BundleStore {
  private readonly root: string[];
  constructor(root: string[]) {
    this.root = root;
  }

  /** Absolute OPFS path (root + relative), the serialization key so writes across instances to the same
   *  underlying file share one chain. */
  private absPath(path: string): string {
    return [...this.root, path].join("/");
  }

  /** Walk (optionally creating) the directory chain for `parts` under the bundle root. */
  private async dirFor(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      let dir = await navigator.storage.getDirectory();
      for (const part of [...this.root, ...parts]) dir = await dir.getDirectoryHandle(part, { create });
      return dir;
    } catch {
      return null; // a missing dir on a read is "not there", not an error
    }
  }

  private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const parts = path.split("/");
    const name = parts.pop()!;
    const dir = await this.dirFor(parts, create);
    if (!dir) return null;
    try {
      return await dir.getFileHandle(name, { create });
    } catch {
      return null;
    }
  }

  async readText(path: string): Promise<string | null> {
    const h = await this.fileHandle(path, false);
    if (!h) return null;
    try {
      return await (await h.getFile()).text();
    } catch {
      return null;
    }
  }

  writeText(path: string, text: string): Promise<void> {
    return serializeOpfsWrite(this.absPath(path), () => this.rawWrite(path, text));
  }

  async readBlob(path: string): Promise<ArrayBuffer | null> {
    const h = await this.fileHandle(path, false);
    if (!h) return null;
    try {
      return await (await h.getFile()).arrayBuffer();
    } catch {
      return null;
    }
  }

  writeBlob(path: string, blob: Blob): Promise<void> {
    return serializeOpfsWrite(this.absPath(path), () => this.rawWrite(path, blob));
  }

  /** The actual OPFS write, un-serialized: callers reach it only through the per-path chain above (and
   *  `appendEdits`, which is itself already inside the chain), so writes to one file never overlap. */
  private async rawWrite(path: string, data: string | Blob): Promise<void> {
    const h = await this.fileHandle(path, true);
    if (!h) throw new Error(`bundle: cannot write ${path}`);
    const w = await h.createWritable();
    await w.write(data);
    await w.close();
  }

  async exists(path: string): Promise<boolean> {
    return (await this.fileHandle(path, false)) !== null;
  }

  /** Read-concat-write as one unit under the log path's chain, so concurrent appends (a burst of
   *  confirmed edits, or the cache mirroring in parallel) can't lose each other's entries. */
  appendEdits(entries: EditEntry[]): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    return serializeOpfsWrite(this.absPath(EDIT_LOG_PATH), async () => {
      const merged = mergeEdits(await this.readText(EDIT_LOG_PATH), entries);
      await this.rawWrite(EDIT_LOG_PATH, JSON.stringify(merged));
    });
  }
  readEdits(sinceSeq: number, limit?: number): Promise<EditEntry[]> {
    return readEditsFromFile(this, sinceSeq, limit);
  }
}

/** In-memory backend used by unit tests and as a no-OPFS fallback (not durable). */
export class MemoryBundleStore implements BundleStore {
  private text = new Map<string, string>();
  private blob = new Map<string, ArrayBuffer>();

  async readText(path: string): Promise<string | null> {
    return this.text.get(path) ?? null;
  }
  async writeText(path: string, text: string): Promise<void> {
    this.text.set(path, text);
  }
  async readBlob(path: string): Promise<ArrayBuffer | null> {
    return this.blob.get(path) ?? null;
  }
  async writeBlob(path: string, blob: Blob): Promise<void> {
    this.blob.set(path, await blob.arrayBuffer());
  }
  async exists(path: string): Promise<boolean> {
    return this.text.has(path) || this.blob.has(path);
  }
  appendEdits(entries: EditEntry[]): Promise<void> {
    return appendEditsToFile(this, entries);
  }
  readEdits(sinceSeq: number, limit?: number): Promise<EditEntry[]> {
    return readEditsFromFile(this, sinceSeq, limit);
  }
}

/** The caller's role on a listed project: their own, or one shared with them. Local backends have no
 *  sharing, so everything they list is "owner"; the remote backend fills it from the server. */
export type ProjectRole = "owner" | "editor";

/** A project as surfaced to the library list: id + display metadata (mirrors the bundle's meta.json, so
 *  the list needs no extra per-bundle read on the remote backend) + the caller's role. */
export interface ProjectListing {
  id: string;
  name: string;
  /** ISO timestamp of the last save; "" if never written. */
  modifiedAt: string;
  role: ProjectRole;
}

/**
 * The multi-project root: hands out a per-project bundle store and can list/delete
 * projects. One instance backs the whole app (OPFS in the browser, shared in-memory
 * for tests / no-OPFS).
 */
export interface ProjectStorage {
  bundle(projectId: string): BundleStore;
  /** The caller's projects with display metadata + role (owned + shared on the remote backend). */
  listProjects(): Promise<ProjectListing[]>;
  deleteProject(projectId: string): Promise<void>;
}

/** Read a bundle's `meta.json` into a listing (role "owner" - local backends have no sharing). Falls
 *  back to the id as the name when meta.json is missing or malformed. */
async function readBundleListing(store: BundleStore, id: string): Promise<ProjectListing> {
  const raw = await store.readText("meta.json");
  try {
    const meta = JSON.parse(raw ?? "") as { name?: string; modifiedAt?: string };
    return { id, name: meta.name || id, modifiedAt: meta.modifiedAt ?? "", role: "owner" };
  } catch {
    return { id, name: id, modifiedAt: "", role: "owner" };
  }
}

class OpfsProjectStorage implements ProjectStorage {
  /** The directory (under the OPFS root) that holds this instance's bundles. Defaults to the primary
   *  `projects/` tree; the remote-mode read-through cache points a second instance at its own dir so a
   *  cached mirror never collides with locally-authored projects. */
  private readonly rootDir: string;
  constructor(rootDir: string = PROJECTS_DIR) {
    this.rootDir = rootDir;
  }
  bundle(projectId: string): BundleStore {
    return new OpfsBundleStore([this.rootDir, projectId]);
  }
  async listProjects(): Promise<ProjectListing[]> {
    let ids: string[] = [];
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(this.rootDir, { create: false });
      // `entries()` is an async iterator on the directory handle (FileSystem Access API);
      // the DOM lib doesn't type it, so reach it through a narrow cast.
      const entries = (dir as unknown as { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
      for await (const [name, handle] of entries) {
        if (handle.kind === "directory") ids.push(name);
      }
    } catch {
      ids = [];
    }
    return Promise.all(ids.map((id) => readBundleListing(this.bundle(id), id)));
  }
  async deleteProject(projectId: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(this.rootDir, { create: false });
      await dir.removeEntry(projectId, { recursive: true });
    } catch {
      // nothing to delete
    }
  }
}

/** A rooted view over shared in-memory maps, so many project bundles share one FS. */
class RootedMemoryStore implements BundleStore {
  private readonly text: Map<string, string>;
  private readonly blob: Map<string, ArrayBuffer>;
  private readonly prefix: string;
  constructor(text: Map<string, string>, blob: Map<string, ArrayBuffer>, prefix: string) {
    this.text = text;
    this.blob = blob;
    this.prefix = prefix;
  }
  private key(path: string) {
    return this.prefix + path;
  }
  async readText(path: string) {
    return this.text.get(this.key(path)) ?? null;
  }
  async writeText(path: string, text: string) {
    this.text.set(this.key(path), text);
  }
  async readBlob(path: string) {
    return this.blob.get(this.key(path)) ?? null;
  }
  async writeBlob(path: string, blob: Blob) {
    this.blob.set(this.key(path), await blob.arrayBuffer());
  }
  async exists(path: string) {
    return this.text.has(this.key(path)) || this.blob.has(this.key(path));
  }
  appendEdits(entries: EditEntry[]): Promise<void> {
    return appendEditsToFile(this, entries);
  }
  readEdits(sinceSeq: number, limit?: number): Promise<EditEntry[]> {
    return readEditsFromFile(this, sinceSeq, limit);
  }
}

export class MemoryProjectStorage implements ProjectStorage {
  private readonly text = new Map<string, string>();
  private readonly blob = new Map<string, ArrayBuffer>();
  private prefix(projectId: string) {
    return `${PROJECTS_DIR}/${projectId}/`;
  }
  bundle(projectId: string): BundleStore {
    return new RootedMemoryStore(this.text, this.blob, this.prefix(projectId));
  }
  async listProjects(): Promise<ProjectListing[]> {
    const ids = new Set<string>();
    const head = `${PROJECTS_DIR}/`;
    for (const key of [...this.text.keys(), ...this.blob.keys()]) {
      if (key.startsWith(head)) ids.add(key.slice(head.length).split("/")[0]);
    }
    return Promise.all([...ids].map((id) => readBundleListing(this.bundle(id), id)));
  }
  async deleteProject(projectId: string): Promise<void> {
    const head = this.prefix(projectId);
    for (const key of [...this.text.keys()]) if (key.startsWith(head)) this.text.delete(key);
    for (const key of [...this.blob.keys()]) if (key.startsWith(head)) this.blob.delete(key);
  }
}

let storageSingleton: ProjectStorage | null = null;

/**
 * The app-wide project storage. Precedence: the remote sync server when
 * `VITE_DAW_API_URL` is set (the durable, deployable backend), else OPFS in the browser,
 * else shared in-memory (tests / no-OPFS). The seam is identical, so callers don't care.
 */
export function getProjectStorage(): ProjectStorage {
  if (!storageSingleton) {
    const apiUrl = import.meta.env?.VITE_DAW_API_URL;
    const hasOpfs = typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
    if (apiUrl) {
      // Pass the token *getter* (not a snapshot) so a live Supabase session token is read per request;
      // it yields undefined when auth is off (the dev-stub server is open).
      const remote = new RemoteProjectStorage(apiUrl, getAccessToken);
      // Front the remote with an OPFS read-through cache so a seen project loads / renders offline. With
      // no OPFS (old browser) fall back to remote-only, exactly as before.
      storageSingleton = hasOpfs ? new CachedProjectStorage(remote, new OpfsProjectStorage(REMOTE_CACHE_DIR)) : remote;
    } else if (hasOpfs) {
      storageSingleton = new OpfsProjectStorage();
    } else {
      storageSingleton = new MemoryProjectStorage();
    }
  }
  return storageSingleton;
}

/** Replace the app-wide project storage. For tests (swap in a fresh in-memory store). */
export function setProjectStorage(storage: ProjectStorage): void {
  storageSingleton = storage;
}

/**
 * The OPFS mirror bundle for one project, for **cache-only** offline-durability writes - the pending
 * write-queue and the confirmed edit stream - that must NOT round-trip to the server (it owns its own
 * keyframes). Points at the same `remote-cache/<id>` tree the read-through cache mirrors into, so the
 * confirmed stream lands in the one local edit log an offline reload replays. Null unless in remote +
 * OPFS mode (local mode already persists to OPFS directly; no-OPFS has nowhere durable to mirror).
 */
export function getLocalCacheBundle(projectId: string): BundleStore | null {
  const apiUrl = import.meta.env?.VITE_DAW_API_URL;
  const hasOpfs = typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
  if (!apiUrl || !hasOpfs) return null;
  // A distinct instance from the read-through cache's bundle for this project, but writes to the same
  // underlying files (pending.json, edits.json) still serialize: `OpfsBundleStore` keys its write chain
  // by absolute OPFS path, shared module-wide, so both instances share one chain per file.
  return new OpfsBundleStore([REMOTE_CACHE_DIR, projectId]);
}

/**
 * Ask the browser to make OPFS / IndexedDB persistent, so the offline cache + write-queue are not
 * evicted under storage pressure (Safari/iOS evict aggressively). Best-effort and idempotent; resolves
 * to whether persistence is in effect. A no-op (false) where the Storage API is unavailable.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

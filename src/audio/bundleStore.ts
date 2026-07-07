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

export interface BundleStore {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBlob(path: string): Promise<ArrayBuffer | null>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** The parent directory (under the OPFS root) that holds every project bundle. */
const PROJECTS_DIR = "projects";

/** Origin Private File System backend: the bundle is a real directory tree rooted at `root`. */
export class OpfsBundleStore implements BundleStore {
  private readonly root: string[];
  constructor(root: string[]) {
    this.root = root;
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

  async writeText(path: string, text: string): Promise<void> {
    const h = await this.fileHandle(path, true);
    if (!h) throw new Error(`bundle: cannot write ${path}`);
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
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

  async writeBlob(path: string, blob: Blob): Promise<void> {
    const h = await this.fileHandle(path, true);
    if (!h) throw new Error(`bundle: cannot write ${path}`);
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
  }

  async exists(path: string): Promise<boolean> {
    return (await this.fileHandle(path, false)) !== null;
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
}

/**
 * The multi-project root: hands out a per-project bundle store and can list/delete
 * projects. One instance backs the whole app (OPFS in the browser, shared in-memory
 * for tests / no-OPFS).
 */
export interface ProjectStorage {
  bundle(projectId: string): BundleStore;
  listProjectIds(): Promise<string[]>;
  deleteProject(projectId: string): Promise<void>;
}

class OpfsProjectStorage implements ProjectStorage {
  bundle(projectId: string): BundleStore {
    return new OpfsBundleStore([PROJECTS_DIR, projectId]);
  }
  async listProjectIds(): Promise<string[]> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(PROJECTS_DIR, { create: false });
      const ids: string[] = [];
      // `entries()` is an async iterator on the directory handle (FileSystem Access API);
      // the DOM lib doesn't type it, so reach it through a narrow cast.
      const entries = (dir as unknown as { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
      for await (const [name, handle] of entries) {
        if (handle.kind === "directory") ids.push(name);
      }
      return ids;
    } catch {
      return [];
    }
  }
  async deleteProject(projectId: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(PROJECTS_DIR, { create: false });
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
  async listProjectIds(): Promise<string[]> {
    const ids = new Set<string>();
    const head = `${PROJECTS_DIR}/`;
    for (const key of [...this.text.keys(), ...this.blob.keys()]) {
      if (key.startsWith(head)) ids.add(key.slice(head.length).split("/")[0]);
    }
    return [...ids];
  }
  async deleteProject(projectId: string): Promise<void> {
    const head = this.prefix(projectId);
    for (const key of [...this.text.keys()]) if (key.startsWith(head)) this.text.delete(key);
    for (const key of [...this.blob.keys()]) if (key.startsWith(head)) this.blob.delete(key);
  }
}

let storageSingleton: ProjectStorage | null = null;

/** The app-wide project storage (OPFS in the browser, shared in-memory otherwise). */
export function getProjectStorage(): ProjectStorage {
  if (!storageSingleton) {
    storageSingleton =
      typeof navigator !== "undefined" && !!navigator.storage?.getDirectory
        ? new OpfsProjectStorage()
        : new MemoryProjectStorage();
  }
  return storageSingleton;
}

/** Replace the app-wide project storage. For tests (swap in a fresh in-memory store). */
export function setProjectStorage(storage: ProjectStorage): void {
  storageSingleton = storage;
}

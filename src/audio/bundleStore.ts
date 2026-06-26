/**
 * Low-level storage driver for a project *bundle* - a small folder of named
 * entries (text + binary), addressed by relative path (`manifest.json`,
 * `project.json`, `samples/<hash>`). The bundle layout lives one level up in
 * `projectRepository.ts`; this seam only knows how to read/write paths, so the
 * same repository logic runs over OPFS today and a real disk folder or a remote
 * later (see docs/DESIGN.md sections 8, 10). Everything is async, because OPFS is.
 */

export interface BundleStore {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBlob(path: string): Promise<ArrayBuffer | null>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** The single bundle's root directory name within OPFS. Multi-project is later. */
const BUNDLE_DIR = "project.daw";

/** OPFS when available (browser), else an in-memory store (Node tests / no OPFS). */
export function createBundleStore(): BundleStore {
  if (typeof navigator !== "undefined" && !!navigator.storage?.getDirectory) return new OpfsBundleStore();
  return new MemoryBundleStore();
}

/** Origin Private File System backend: the bundle is a real directory tree. */
export class OpfsBundleStore implements BundleStore {
  /** Walk (optionally creating) the directory chain for `parts` under the bundle root. */
  private async dirFor(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      let dir = await navigator.storage.getDirectory();
      dir = await dir.getDirectoryHandle(BUNDLE_DIR, { create });
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
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

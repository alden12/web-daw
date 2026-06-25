/**
 * The project repository: the one seam the app uses to load/save the project
 * document and its audio samples. It reads/writes a *bundle* (see `bundleStore.ts`)
 * with this layout - the v1 of the on-disk format in docs/DESIGN.md section 10:
 *
 *   project.daw/
 *     manifest.json     formatVersion, project id, project-schema version
 *     project.json      the materialized ProjectData snapshot (working state)
 *     log.json          the persisted authored edit log (drives the activity feed)
 *     notes.json        the persisted feed notes (intent narration; parallel to log)
 *     meta.json         human-facing name + modified time
 *     samples/<sha256>  audio sample bytes, content-addressed (dedup + integrity)
 *     history/          the commit DAG: refs.json + commits/<id>.json (keyframe + delta)
 *
 * Samples are content-addressed: `putSample` hashes the bytes and stores them under
 * that hash, so the same file imported twice is stored once and a clip's `fileId`
 * doubles as an integrity check.
 */
import type { ProjectData } from "./project/types";
import type { Author, EditEntry } from "./commands/types";
import type { FeedNote, UndoState } from "./commands/editLog";
import { type BundleStore, createBundleStore } from "./bundleStore";

const FORMAT_VERSION = 1;
/** Schema version of `project.json`. We do not support older shapes (single-user app). */
const PROJECT_SCHEMA = 7;
/** Bound the persisted log (commands are tiny); deeper history is slice 15B. */
const MAX_PERSISTED_ENTRIES = 2000;

export interface StoredProject {
  project: ProjectData;
  log: EditEntry[];
  /** Feed notes (intent narration); empty for bundles written before notes were persisted. */
  notes: FeedNote[];
}

/** A bundle as a flat path -> bytes map (what gets zipped into a `.daw.zip`). */
export type BundleFiles = Record<string, Uint8Array>;

/**
 * One node in the version-history DAG: the authored edits it bundles and a pointer
 * to its parent. Storage is **keyframe + delta** (like video): most commits store
 * only their `entries` (the semantic delta) and reconstruct on demand by replaying
 * forward from the nearest ancestor that carries a `snapshot` (a keyframe). A
 * keyframe is written for the root, every Nth commit, a revert (a discontinuity),
 * and any commit containing undo/redo entries (which can't be replayed forward) -
 * so every delta commit is pure-forward and replays exactly. The DAG is the durable
 * source of truth; `project.json` is the working-state cache of where HEAD is.
 */
export interface Commit {
  id: string;
  parent: string | null;
  author: Author;
  message: string;
  time: number;
  /** A system auto-checkpoint vs a user/Claude-named version. */
  auto: boolean;
  entryCount: number;
  /** Present only on keyframes; delta commits omit it and replay forward (materialize). */
  snapshot?: ProjectData;
  entries: EditEntry[];
  /** Feed notes swept into this commit (intent narration). Omitted when none. */
  notes?: FeedNote[];
  /** Highest edit seq this commit includes (so reload knows where history ends). */
  lastSeq: number;
}

/** Branch tips + the current branch (HEAD). Linear for now; branches are 15C. */
export interface Refs {
  head: string;
  branches: Record<string, string | null>;
}

interface Manifest {
  formatVersion: number;
  projectId: string;
  projectSchema: number;
}

export class ProjectRepository {
  private projectId: string | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly store: BundleStore;

  constructor(store: BundleStore) {
    this.store = store;
  }

  /** Load the working snapshot + log; null if no bundle has been written yet. */
  async load(): Promise<StoredProject | null> {
    const manifestRaw = await this.store.readText("manifest.json");
    if (!manifestRaw) return null;
    const manifest = JSON.parse(manifestRaw) as Manifest;
    this.projectId = manifest.projectId;
    const projectRaw = await this.store.readText("project.json");
    if (!projectRaw) return null;
    const project = JSON.parse(projectRaw) as ProjectData;
    const logRaw = await this.store.readText("log.json");
    const notesRaw = await this.store.readText("notes.json");
    return {
      project,
      log: logRaw ? (JSON.parse(logRaw) as EditEntry[]) : [],
      notes: notesRaw ? (JSON.parse(notesRaw) as FeedNote[]) : [],
    };
  }

  /** Persist the working snapshot + log + feed notes. Writes are serialized so they never overlap. */
  save(project: ProjectData, log: EditEntry[], notes: FeedNote[] = []): Promise<void> {
    const run = () => this.writeAll(project, log, notes);
    this.saveChain = this.saveChain.then(run, run);
    return this.saveChain;
  }

  private async writeAll(project: ProjectData, log: EditEntry[], notes: FeedNote[]): Promise<void> {
    if (!this.projectId) this.projectId = `p-${crypto.randomUUID().slice(0, 8)}`;
    const manifest: Manifest = {
      formatVersion: FORMAT_VERSION,
      projectId: this.projectId,
      projectSchema: PROJECT_SCHEMA,
    };
    await this.store.writeText("manifest.json", JSON.stringify(manifest));
    await this.store.writeText("project.json", JSON.stringify(project));
    await this.store.writeText("log.json", JSON.stringify(log.slice(-MAX_PERSISTED_ENTRIES)));
    await this.store.writeText("notes.json", JSON.stringify(notes.slice(-MAX_PERSISTED_ENTRIES)));
    await this.store.writeText("meta.json", JSON.stringify({ name: "Untitled", modifiedAt: new Date().toISOString() }));
  }

  /** Store an audio sample, returning its content hash (its `fileId`). Dedups. */
  async putSample(blob: Blob): Promise<string> {
    const hash = await sha256hex(await blob.arrayBuffer());
    const path = `samples/${hash}`;
    if (!(await this.store.exists(path))) await this.store.writeBlob(path, blob);
    return hash;
  }

  /** Read an audio sample by its content hash (ready for decodeAudioData). */
  async getSample(id: string): Promise<ArrayBuffer> {
    const buf = await this.store.readBlob(`samples/${id}`);
    if (!buf) throw new Error(`sample not found: ${id}`);
    return buf;
  }

  hasSample(id: string): Promise<boolean> {
    return this.store.exists(`samples/${id}`);
  }

  /**
   * The current project as a readable bundle (path -> bytes): pretty-printed
   * manifest / project / log / notes / meta JSON plus the referenced samples as
   * real `.wav` bytes. The UI zips this into a portable `.daw.zip`. This is the same
   * shape the disk-folder backend (15D) will write uncompressed, so export and
   * on-disk are one format. Pass the live snapshot + log + notes so it is always current.
   */
  async exportBundle(project: ProjectData, log: EditEntry[], notes: FeedNote[] = []): Promise<BundleFiles> {
    if (!this.projectId) this.projectId = `p-${crypto.randomUUID().slice(0, 8)}`;
    const manifest: Manifest = {
      formatVersion: FORMAT_VERSION,
      projectId: this.projectId,
      projectSchema: PROJECT_SCHEMA,
    };
    const files: BundleFiles = {
      "manifest.json": json(manifest),
      "project.json": json(project),
      "log.json": json(log),
      "notes.json": json(notes),
      "meta.json": json({ name: "Untitled", modifiedAt: new Date().toISOString() }),
    };
    for (const id of referencedSampleIds(project)) {
      const buf = await this.store.readBlob(`samples/${id}`);
      if (buf) files[`samples/${id}.wav`] = new Uint8Array(buf);
    }
    return files;
  }

  /** Load a bundle file map (from an unzipped `.daw.zip`), replacing the project. */
  async importBundle(files: BundleFiles): Promise<StoredProject> {
    const project = JSON.parse(text(files["project.json"])) as ProjectData;
    if (!project?.tracks) throw new Error("bundle: missing project.json");
    const log = files["log.json"] ? (JSON.parse(text(files["log.json"])) as EditEntry[]) : [];
    const notes = files["notes.json"] ? (JSON.parse(text(files["notes.json"])) as FeedNote[]) : [];
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith("samples/")) continue;
      const id = path.slice("samples/".length).replace(/\.[^.]*$/, ""); // strip dir + extension -> content hash
      if (id && !(await this.store.exists(`samples/${id}`)))
        await this.store.writeBlob(`samples/${id}`, new Blob([bytes as BlobPart]));
    }
    try {
      this.projectId = (JSON.parse(text(files["manifest.json"])) as Manifest).projectId;
    } catch {
      this.projectId = null;
    }
    await this.save(project, log, notes);
    return { project, log, notes };
  }

  // ---- undo/redo (session checkpoints, persisted so undo survives a reload) ----

  writeUndo(state: UndoState): Promise<void> {
    return this.store.writeText("undo.json", JSON.stringify(state));
  }

  async readUndo(): Promise<UndoState | null> {
    const raw = await this.store.readText("undo.json");
    return raw ? (JSON.parse(raw) as UndoState) : null;
  }

  // ---- version history (the commit DAG, under history/) ----

  writeCommit(commit: Commit): Promise<void> {
    // Minified: commits are internal storage, not the readable export artifact
    // (that is project.json / the .daw.zip), and delta commits are tiny.
    return this.store.writeText(`history/commits/${commit.id}.json`, JSON.stringify(commit));
  }

  async readCommit(id: string): Promise<Commit | null> {
    const raw = await this.store.readText(`history/commits/${id}.json`);
    return raw ? (JSON.parse(raw) as Commit) : null;
  }

  async readRefs(): Promise<Refs | null> {
    const raw = await this.store.readText("history/refs.json");
    return raw ? (JSON.parse(raw) as Refs) : null;
  }

  writeRefs(refs: Refs): Promise<void> {
    return this.store.writeText("history/refs.json", JSON.stringify(refs, null, 2));
  }
}

/** Content hashes of every sample the project's audio clips reference. */
function referencedSampleIds(project: ProjectData): string[] {
  const ids = new Set<string>();
  for (const t of project.tracks) {
    if (t.kind !== "audio") continue;
    for (const c of t.clips ?? []) if (c.fileId) ids.add(c.fileId);
  }
  return [...ids];
}

/** Pretty-printed JSON as bytes (readable inside the zip). */
function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

function text(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder().decode(bytes) : "";
}

async function sha256hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let singleton: ProjectRepository | null = null;

/** The app-wide repository (OPFS-backed in the browser). Samples + project share it. */
export function getRepository(): ProjectRepository {
  if (!singleton) singleton = new ProjectRepository(createBundleStore());
  return singleton;
}

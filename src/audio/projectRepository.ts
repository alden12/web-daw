/**
 * The project repository: the one seam the app uses to load/save the project
 * document and its audio samples. It reads/writes a *bundle* (see `bundleStore.ts`)
 * with this layout - the v1 of the on-disk format in docs/DESIGN.md section 10:
 *
 *   project.daw/
 *     manifest.json     formatVersion, project id, project-schema version
 *     project.json      the materialized ProjectData snapshot (working state) + headSeq marker
 *     edits.json        the unified authored stream: edits + feed notes, seq-ordered (the feed)
 *     meta.json         human-facing name + modified time
 *     samples/<sha256>  audio sample bytes, content-addressed (dedup + integrity)
 *     history/          the commit DAG: refs.json + commits/<id>.json (keyframe + delta)
 *
 * Samples are content-addressed: `putSample` hashes the bytes and stores them under
 * that hash, so the same file imported twice is stored once and a clip's `fileId`
 * doubles as an integrity check.
 */
import type { ProjectData } from "./project/types";
import type { Author, EditCommand, EditEntry } from "./commands/types";
import type { FeedNote, UndoState } from "./commands/editLog";
import { type BundleStore, getProjectStorage } from "./bundleStore";
import { migrateDocument, PROJECT_SCHEMA } from "./project/documentMigration";
import { ProjectStore } from "./project/projectStore";
import { applyEdit } from "./commands/applyEdit";

/** `project.json` carries this keyframe marker: the edit `seq` the snapshot reflects, so load
 *  knows which log tail to replay on top. A persistence detail (the domain ignores it); the
 *  server's non-strict `projectDataSchema` tolerates the extra key. */
type PersistedProject = ProjectData & { headSeq?: number };

/** Fold the edit log's high-water seq (edits + feed notes share the counter). */
const highWaterSeq = (log: { seq: number }[], notes: { seq: number }[]): number =>
  Math.max(-1, ...log.map((entry) => entry.seq), ...notes.map((note) => note.seq));

/* -- The unified authored stream: edits and feed notes are one seq-ordered log. A note is encoded as
      a kind:"note" entry carrying its text on the command (structural; skipped by forward replay), so
      the delta stream (edits.json / the `edits` table) is the single home for both - no parallel
      notes.json/log.json. `toStream`/`fromStream` convert at the persistence boundary; the in-memory
      EditLog keeps edits and notes as separate lists (its API is unchanged). ------------------------ */

/** Encode a feed note as a stream entry. */
const noteToEntry = (note: FeedNote): EditEntry => ({
  seq: note.seq,
  // Not a real EditCommand (replay never applies it); the wire/schema treat command structurally.
  command: { type: "note", text: note.text } as unknown as EditCommand,
  author: note.author,
  time: note.time,
  kind: "note",
});

/** Merge edits + notes into the single stream, seq-ordered. */
const toStream = (entries: EditEntry[], notes: FeedNote[]): EditEntry[] =>
  [...entries, ...notes.map(noteToEntry)].sort((a, b) => a.seq - b.seq);

/** Dedup entries by seq (later arrays win on conflict) and sort ascending. */
const mergeBySeq = (...streams: EditEntry[][]): EditEntry[] => {
  const bySeq = new Map<number, EditEntry>();
  for (const stream of streams) for (const entry of stream) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
};

/** Split a stream back into edits (incl. undo/redo) and feed notes. */
const fromStream = (stream: EditEntry[]): { entries: EditEntry[]; notes: FeedNote[] } => {
  const entries: EditEntry[] = [];
  const notes: FeedNote[] = [];
  for (const entry of stream) {
    if (entry.kind === "note") {
      const text = (entry.command as { text?: unknown }).text;
      notes.push({
        seq: entry.seq,
        text: typeof text === "string" ? text : "",
        author: entry.author,
        time: entry.time,
      });
    } else {
      entries.push(entry);
    }
  }
  return { entries, notes };
};

/** Whether a stream entry is replayed forward through `applyEdit` (edits only; notes and the
 *  undo/redo reflog markers are not). Absent kind = a legacy edit. */
const isReplayable = (entry: EditEntry): boolean => entry.kind === undefined || entry.kind === "edit";

const FORMAT_VERSION = 1;
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
  private name = "Untitled";
  private saveChain: Promise<void> = Promise.resolve();
  private readonly store: BundleStore;
  /** Highest SEALED edit seq already synced (entries below are immutable; the last, still-coalescing
   *  entry sits above it and is re-sent each append so its final value lands). */
  private syncedThroughSeq = -1;
  /** Edit seq the last-written `project.json` keyframe reflects (the replay floor). */
  private lastKeyframeSeq = -1;

  constructor(store: BundleStore, projectId: string | null = null) {
    this.store = store;
    this.projectId = projectId;
  }

  /** Seq the last keyframe reflects; drives the autosave keyframe cadence. -1 = never keyframed. */
  keyframeSeq(): number {
    return this.lastKeyframeSeq;
  }

  /** The project's display name (from meta.json; "Untitled" until loaded/renamed). */
  getName(): string {
    return this.name;
  }

  /** meta.json body (name + a fresh modified-time) - the library's queryable index. */
  private metaJson(): string {
    return JSON.stringify({ name: this.name, modifiedAt: new Date().toISOString() });
  }

  /** Rename the project: update the in-memory name and persist meta.json immediately. */
  async setName(name: string): Promise<void> {
    this.name = name;
    await this.store.writeText("meta.json", this.metaJson());
  }

  /** Rewrite meta.json (bumps modifiedAt) without a full keyframe - used by the page-hide flush so
   *  the library's modified-time is current after a short session. Serialized with the other writes. */
  touchMeta(): Promise<void> {
    const run = () => this.store.writeText("meta.json", this.metaJson());
    this.saveChain = this.saveChain.then(run, run);
    return this.saveChain;
  }

  /** Load the working snapshot + log; null if no bundle has been written yet. */
  async load(): Promise<StoredProject | null> {
    const manifestRaw = await this.store.readText("manifest.json");
    if (!manifestRaw) return null;
    const manifest = JSON.parse(manifestRaw) as Manifest;
    this.projectId = manifest.projectId;
    const projectRaw = await this.store.readText("project.json");
    if (!projectRaw) return null;
    const migrated = (await this.upcast(JSON.parse(projectRaw), manifest)) as PersistedProject;
    const { headSeq, ...base } = migrated;
    const baseProject = base as ProjectData;
    const metaRaw = await this.store.readText("meta.json");
    if (metaRaw) {
      try {
        this.name = (JSON.parse(metaRaw) as { name?: string }).name ?? this.name;
      } catch {
        // keep the default name
      }
    }
    // Read the unified authored stream (edits + notes), bounded to a recent window for the feed.
    let stream = await this.store.readEdits(-1, MAX_PERSISTED_ENTRIES);
    // Guard: if the capped window did not reach back to the keyframe, read the full tail so replay is
    // complete (only fires with > MAX_PERSISTED_ENTRIES edits since the last keyframe - shouldn't
    // happen in normal use, where a keyframe lands every KEYFRAME_EDIT_INTERVAL edits).
    if (headSeq != null && stream.length > 0 && stream[0].seq > headSeq + 1) {
      stream = mergeBySeq(await this.store.readEdits(headSeq), stream);
    }
    const { entries, notes } = fromStream(stream);

    // Reconstruct HEAD from the keyframe + the edit tail: the keyframe (`project.json`) reflects seq
    // `headSeq`; replay the edits after it through `applyEdit` to reach the true working state (notes
    // and the undo/redo reflog markers are skipped - not pure-forward). A bundle with no `headSeq`
    // has `project.json` authoritative, so this no-ops.
    let project = baseProject;
    const replayTail = entries.filter((entry) => entry.seq > (headSeq ?? -1) && isReplayable(entry));
    if (replayTail.length > 0) {
      const replayStore = new ProjectStore(false);
      replayStore.load(baseProject);
      for (const entry of replayTail) applyEdit(replayStore, entry.command, entry.author);
      project = replayStore.snapshot();
    }
    this.lastKeyframeSeq = headSeq ?? -1;
    // Everything on disk is already sealed history, so nothing at/below the max needs re-sending.
    this.syncedThroughSeq = Math.max(headSeq ?? -1, highWaterSeq(entries, notes));
    return { project, log: entries, notes };
  }

  /**
   * Bring a just-read document up to the current schema. If the manifest's version is
   * behind, chain the registered upcasters, then heal the bundle in place (rewrite
   * project.json + manifest at the version reached) so we upcast at most once. A no-op
   * when the bundle is already current (the common case; the registry is empty today).
   */
  private async upcast(rawDocument: unknown, manifest: Manifest): Promise<ProjectData> {
    const fromVersion = manifest.projectSchema ?? 0;
    if (fromVersion >= PROJECT_SCHEMA) return rawDocument as ProjectData;
    const { data, version } = migrateDocument(rawDocument, fromVersion, PROJECT_SCHEMA);
    if (version > fromVersion) {
      await this.store.writeText("project.json", JSON.stringify(data));
      await this.store.writeText("manifest.json", JSON.stringify({ ...manifest, projectSchema: version }));
    }
    return data as ProjectData;
  }

  /**
   * Append the authored stream delta (edits + feed notes, merged and seq-ordered). Sends everything
   * above the last sealed seq; the last EDIT may still be coalescing, so it is re-sent each call (the
   * store upserts by seq) to carry its final value. Sealing is by the edits (notes never coalesce and
   * are idempotent upserts), so a note appended after an edit can't prematurely seal it. Serialized
   * with saves.
   */
  appendEdits(entries: EditEntry[], notes: FeedNote[] = []): Promise<void> {
    const run = async () => {
      const toSend = toStream(entries, notes).filter((entry) => entry.seq > this.syncedThroughSeq);
      if (toSend.length === 0) return;
      await this.store.appendEdits(toSend);
      // Seal all but the last edit (only it can still coalesce, so keep re-sending it).
      if (entries.length >= 2) this.syncedThroughSeq = entries[entries.length - 2].seq;
    };
    this.saveChain = this.saveChain.then(run, run);
    return this.saveChain;
  }

  /**
   * Write the working snapshot as a keyframe: `project.json` records the edit `seq` it reflects
   * (`headSeq`), so load replays only the tail after it, and `meta.json` rides along. The feed lives
   * entirely in the append stream now (no log.json/notes.json). Writes are serialized.
   */
  writeKeyframe(project: ProjectData, headSeq: number): Promise<void> {
    const run = () => this.writeKeyframeNow(project, headSeq);
    this.saveChain = this.saveChain.then(run, run);
    return this.saveChain;
  }

  private async writeKeyframeNow(project: ProjectData, headSeq: number): Promise<void> {
    if (!this.projectId) this.projectId = `p-${crypto.randomUUID().slice(0, 8)}`;
    const manifest: Manifest = {
      formatVersion: FORMAT_VERSION,
      projectId: this.projectId,
      projectSchema: PROJECT_SCHEMA,
    };
    const keyframe: PersistedProject = { ...project, headSeq };
    await this.store.writeText("manifest.json", JSON.stringify(manifest));
    await this.store.writeText("project.json", JSON.stringify(keyframe));
    await this.store.writeText("meta.json", this.metaJson());
    this.lastKeyframeSeq = headSeq;
  }

  /** A full write (keyframe + the whole stream appended) for non-autosave callers:
   *  switch/create/import. */
  save(project: ProjectData, log: EditEntry[], notes: FeedNote[] = []): Promise<void> {
    this.writeKeyframe(project, highWaterSeq(log, notes));
    return this.appendEdits(log, notes);
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
   * The current project as a readable bundle (path -> bytes): pretty-printed manifest / project /
   * meta JSON, the unified authored stream (`edits.json`: edits + notes), plus the referenced samples
   * as real `.wav` bytes. The UI zips this into a portable `.daw.zip`. This is the same shape the
   * disk-folder backend (15D) will write uncompressed, so export and on-disk are one format. Pass the
   * live snapshot + log + notes so it is always current.
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
      "edits.json": json(toStream(log, notes)),
      "meta.json": json({ name: this.name, modifiedAt: new Date().toISOString() }),
    };
    for (const id of referencedSampleIds(project)) {
      const buf = await this.store.readBlob(`samples/${id}`);
      if (buf) files[`samples/${id}.wav`] = new Uint8Array(buf);
    }
    return files;
  }

  /** Load a bundle file map (from an unzipped `.daw.zip`), replacing the project. Reads the unified
   *  `edits.json` stream (edits + feed notes). */
  async importBundle(files: BundleFiles): Promise<StoredProject> {
    const project = JSON.parse(text(files["project.json"])) as ProjectData;
    if (!project?.tracks) throw new Error("bundle: missing project.json");
    const stream = files["edits.json"] ? (JSON.parse(text(files["edits.json"])) as EditEntry[]) : [];
    const { entries: log, notes } = fromStream(stream);
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
    try {
      this.name = (JSON.parse(text(files["meta.json"])) as { name?: string }).name ?? this.name;
    } catch {
      // keep the current name
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
  for (const track of project.tracks) {
    if (track.kind !== "audio") continue;
    for (const clip of track.clips ?? []) if (clip.fileId) ids.add(clip.fileId);
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
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** localStorage key holding the current project id (shared source of truth with the library). */
const CURRENT_PROJECT_KEY = "web-daw:current-project";

let current: { id: string; repo: ProjectRepository } | null = null;

function readCurrentId(): string {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(CURRENT_PROJECT_KEY) : null;
  return stored || "default";
}

/** Point the app-wide repository at project `id` (rebuilds it over that bundle). */
export function setCurrentProject(id: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(CURRENT_PROJECT_KEY, id);
  current = { id, repo: new ProjectRepository(getProjectStorage().bundle(id), id) };
}

/** The id of the project the app is currently working on. */
export function currentProjectId(): string {
  return current?.id ?? readCurrentId();
}

/**
 * The repository for the current project. Samples, history, and the working snapshot
 * all live in that project's bundle; a project switch repoints this (setCurrentProject).
 */
export function getRepository(): ProjectRepository {
  if (!current) setCurrentProject(readCurrentId());
  return current!.repo;
}

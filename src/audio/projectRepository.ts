/**
 * The project repository: the one seam the app uses to load/save the project
 * document and its audio samples. It reads/writes a *bundle* (see `bundleStore.ts`)
 * with this layout - the v1 of the on-disk format in docs/DESIGN.md section 10:
 *
 *   project.daw/
 *     manifest.json     formatVersion, project id, project-schema version
 *     project.json      the materialized ProjectData snapshot (working state)
 *     log.json          the persisted authored edit log (interim; becomes history/ in 15B)
 *     meta.json         human-facing name + modified time
 *     samples/<sha256>  audio sample bytes, content-addressed (dedup + integrity)
 *
 * Samples are content-addressed: `putSample` hashes the bytes and stores them under
 * that hash, so the same file imported twice is stored once and a clip's `fileId`
 * doubles as an integrity check. On first run with no bundle, `load` migrates the
 * pre-bundle localStorage blob + the old `au-*` OPFS samples into a bundle, leaving
 * localStorage as a read-only fallback.
 */
import type { ProjectData, TrackData } from './project/types';
import type { EditEntry } from './commands/types';
import { type BundleStore, createBundleStore } from './bundleStore';

const FORMAT_VERSION = 1;
/** Schema version of `project.json` (ProjectStore.load migrates older shapes). */
const PROJECT_SCHEMA = 7;
/** Bound the persisted log (commands are tiny); deeper history is slice 15B. */
const MAX_PERSISTED_ENTRIES = 2000;
/** Pre-bundle localStorage keys, newest first. Read once, to migrate into a bundle. */
const LEGACY_KEYS = [
  'web-daw:project:v7',
  'web-daw:project:v6',
  'web-daw:project:v5',
  'web-daw:project:v4',
  'web-daw:project:v3',
];

export interface StoredProject {
  project: ProjectData;
  log: EditEntry[];
}

/** A bundle as a flat path -> bytes map (what gets zipped into a `.daw.zip`). */
export type BundleFiles = Record<string, Uint8Array>;

interface Manifest {
  formatVersion: number;
  projectId: string;
  projectSchema: number;
}

export interface RepositoryOptions {
  /** Read a pre-bundle localStorage blob to migrate (default: real localStorage). */
  loadLegacy?: () => StoredProject | null;
  /** Read a pre-bundle OPFS sample by its old `au-*` id (default: real OPFS). */
  legacySampleReader?: (id: string) => Promise<ArrayBuffer | null>;
}

export class ProjectRepository {
  private projectId: string | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly store: BundleStore;
  private readonly loadLegacy: () => StoredProject | null;
  private readonly legacySampleReader: (id: string) => Promise<ArrayBuffer | null>;

  constructor(store: BundleStore, opts: RepositoryOptions = {}) {
    this.store = store;
    this.loadLegacy = opts.loadLegacy ?? defaultLoadLegacy;
    this.legacySampleReader = opts.legacySampleReader ?? defaultLegacySampleReader;
  }

  /** Load the working snapshot + log, migrating a pre-bundle blob on first run. */
  async load(): Promise<StoredProject | null> {
    const manifestRaw = await this.store.readText('manifest.json');
    if (manifestRaw) {
      const manifest = JSON.parse(manifestRaw) as Manifest;
      this.projectId = manifest.projectId;
      const projectRaw = await this.store.readText('project.json');
      if (!projectRaw) return null;
      const project = JSON.parse(projectRaw) as ProjectData;
      const logRaw = await this.store.readText('log.json');
      return { project, log: logRaw ? (JSON.parse(logRaw) as EditEntry[]) : [] };
    }

    // No bundle yet: migrate a pre-bundle localStorage blob, if any exists.
    const legacy = this.loadLegacy();
    if (!legacy) return null;
    const project = await this.migrateSamples(legacy.project);
    await this.save(project, legacy.log);
    return { project, log: legacy.log };
  }

  /** Persist the working snapshot + log. Writes are serialized so they never overlap. */
  save(project: ProjectData, log: EditEntry[]): Promise<void> {
    const run = () => this.writeAll(project, log);
    this.saveChain = this.saveChain.then(run, run);
    return this.saveChain;
  }

  private async writeAll(project: ProjectData, log: EditEntry[]): Promise<void> {
    if (!this.projectId) this.projectId = `p-${crypto.randomUUID().slice(0, 8)}`;
    const manifest: Manifest = { formatVersion: FORMAT_VERSION, projectId: this.projectId, projectSchema: PROJECT_SCHEMA };
    await this.store.writeText('manifest.json', JSON.stringify(manifest));
    await this.store.writeText('project.json', JSON.stringify(project));
    await this.store.writeText('log.json', JSON.stringify(log.slice(-MAX_PERSISTED_ENTRIES)));
    await this.store.writeText('meta.json', JSON.stringify({ name: 'Untitled', modifiedAt: new Date().toISOString() }));
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
   * manifest / project / log / meta JSON plus the referenced samples as real
   * `.wav` bytes. The UI zips this into a portable `.daw.zip`. This is the same
   * shape the disk-folder backend (15D) will write uncompressed, so export and
   * on-disk are one format. Pass the live snapshot + log so it is always current.
   */
  async exportBundle(project: ProjectData, log: EditEntry[]): Promise<BundleFiles> {
    if (!this.projectId) this.projectId = `p-${crypto.randomUUID().slice(0, 8)}`;
    const manifest: Manifest = { formatVersion: FORMAT_VERSION, projectId: this.projectId, projectSchema: PROJECT_SCHEMA };
    const files: BundleFiles = {
      'manifest.json': json(manifest),
      'project.json': json(project),
      'log.json': json(log),
      'meta.json': json({ name: 'Untitled', modifiedAt: new Date().toISOString() }),
    };
    for (const id of referencedSampleIds(project)) {
      const buf = await this.store.readBlob(`samples/${id}`);
      if (buf) files[`samples/${id}.wav`] = new Uint8Array(buf);
    }
    return files;
  }

  /** Load a bundle file map (from an unzipped `.daw.zip`), replacing the project. */
  async importBundle(files: BundleFiles): Promise<StoredProject> {
    const project = JSON.parse(text(files['project.json'])) as ProjectData;
    if (!project?.tracks) throw new Error('bundle: missing project.json');
    const log = files['log.json'] ? (JSON.parse(text(files['log.json'])) as EditEntry[]) : [];
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith('samples/')) continue;
      const id = path.slice('samples/'.length).replace(/\.[^.]*$/, ''); // strip dir + extension -> content hash
      if (id && !(await this.store.exists(`samples/${id}`))) await this.store.writeBlob(`samples/${id}`, new Blob([bytes as BlobPart]));
    }
    try {
      this.projectId = (JSON.parse(text(files['manifest.json'])) as Manifest).projectId;
    } catch {
      this.projectId = null;
    }
    await this.save(project, log);
    return { project, log };
  }

  /** Re-store legacy `au-*` samples under content hashes; rewrite clip fileIds. */
  private async migrateSamples(project: ProjectData): Promise<ProjectData> {
    const oldIds = new Set<string>();
    for (const t of project.tracks) {
      if (t.kind !== 'audio') continue;
      for (const c of t.clips ?? []) if (c.fileId?.startsWith('au-')) oldIds.add(c.fileId);
    }
    if (oldIds.size === 0) return project;

    const map = new Map<string, string>();
    for (const old of oldIds) {
      try {
        const buf = await this.legacySampleReader(old);
        if (!buf) continue;
        const hash = await sha256hex(buf);
        if (!(await this.store.exists(`samples/${hash}`))) await this.store.writeBlob(`samples/${hash}`, new Blob([buf]));
        map.set(old, hash);
      } catch {
        // unreadable sample: leave the clip's id as-is (it will fail to decode, as before)
      }
    }
    return map.size ? rewriteSampleIds(project, map) : project;
  }
}

/** Replace audio clips' `fileId`s per `map`, leaving everything else untouched. */
function rewriteSampleIds(project: ProjectData, map: Map<string, string>): ProjectData {
  const tracks: TrackData[] = project.tracks.map((t) =>
    t.kind === 'audio'
      ? { ...t, clips: (t.clips ?? []).map((c) => (map.has(c.fileId) ? { ...c, fileId: map.get(c.fileId)! } : c)) }
      : t,
  );
  return { ...project, tracks };
}

/** Content hashes of every sample the project's audio clips reference. */
function referencedSampleIds(project: ProjectData): string[] {
  const ids = new Set<string>();
  for (const t of project.tracks) {
    if (t.kind !== 'audio') continue;
    for (const c of t.clips ?? []) if (c.fileId) ids.add(c.fileId);
  }
  return [...ids];
}

/** Pretty-printed JSON as bytes (readable inside the zip). */
function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

function text(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder().decode(bytes) : '';
}

async function sha256hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultLoadLegacy(): StoredProject | null {
  if (typeof localStorage === 'undefined') return null;
  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw) as { project?: ProjectData; log?: EditEntry[] };
      if (data.project?.tracks) return { project: data.project, log: data.log ?? [] };
    } catch {
      // try the next key
    }
  }
  return null;
}

async function defaultLegacySampleReader(id: string): Promise<ArrayBuffer | null> {
  try {
    if (!(typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory)) return null;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('audio');
    const handle = await dir.getFileHandle(id);
    return (await handle.getFile()).arrayBuffer();
  } catch {
    return null;
  }
}

let singleton: ProjectRepository | null = null;

/** The app-wide repository (OPFS-backed in the browser). Samples + project share it. */
export function getRepository(): ProjectRepository {
  if (!singleton) singleton = new ProjectRepository(createBundleStore());
  return singleton;
}

/**
 * Version history: the commit DAG layered on top of the authored edit log.
 * The edit log is the fine-grained working stream; a *commit* is a coarse, durable
 * checkpoint - a full snapshot plus the edits since the last commit, with an author,
 * message, and a parent pointer (DESIGN.md section 7). The DAG is the source of
 * truth; `project.json` is just where HEAD currently is.
 *
 * Hybrid creation: the store auto-checkpoints after a burst of edit activity
 * (debounced), and `commit(message)` stamps a named version on demand. Both are the
 * same kind of node. Linear for now (one branch, append); the storage is a DAG so
 * branches/merges (15C) and time-travel/diff (15B.3) drop in without reshaping.
 */
import { ProjectStore } from "../project/projectStore";
import type { ProjectData } from "../project/types";
import { applyEdit } from "./applyEdit";
import { describeCommand } from "./describe";
import { diffProjects } from "./diff";
import type { Author, EditEntry } from "./types";
import type { EditLog, FeedNote } from "./editLog";
import { getRepository, type Commit, type ProjectRepository, type Refs } from "../projectRepository";

/** A burst of edits within this window collapses into one auto-checkpoint. */
const CHECKPOINT_DEBOUNCE_MS = 4000;

/**
 * Keyframe cadence: store a full snapshot at most every Nth commit; the commits
 * between are deltas that replay forward from it. Bounds both per-commit size and
 * the replay length needed to reconstruct any commit (DESIGN.md section 7).
 */
const KEYFRAME_INTERVAL = 16;

/** A commit without its (large) snapshot/entries - for listing history. */
export interface CommitSummary {
  id: string;
  parent: string | null;
  author: Author;
  message: string;
  time: number;
  auto: boolean;
  entryCount: number;
  /** How many feed notes (intent narration) this commit swept in. */
  noteCount: number;
  /** Highest edit seq this commit included - positions it in the activity feed. */
  lastSeq: number;
}

export interface VersionState {
  branch: string;
  headId: string | null;
  hasUncommitted: boolean;
}

export class VersionStore {
  private readonly project: ProjectStore;
  private readonly editLog: EditLog;
  private readonly repo: ProjectRepository;
  private refs: Refs = { head: "main", branches: { main: null } };
  private lastCommittedSeq = -1;
  /** Delta commits written since the last keyframe (drives keyframe cadence). */
  private commitsSinceKeyframe = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(project: ProjectStore, editLog: EditLog, repo: ProjectRepository = getRepository()) {
    this.project = project;
    this.editLog = editLog;
    this.repo = repo;
  }

  /** Load refs + HEAD from the bundle. Call after the project is restored. */
  async load(): Promise<void> {
    const refs = await this.repo.readRefs();
    if (refs) {
      this.refs = refs;
      const head = this.headId() ? await this.repo.readCommit(this.headId()!) : null;
      this.lastCommittedSeq = head?.lastSeq ?? -1;
      this.commitsSinceKeyframe = await this.distanceToKeyframe(this.headId());
    } else {
      // No history yet: start the DAG from here, rather than retro-committing the
      // restored working log (which has no commits behind it).
      this.lastCommittedSeq = this.maxSeq();
    }
    this.emit();
  }

  /** Auto-checkpoint on edit activity (debounced). Returns a disposer. */
  attach(): () => void {
    const unsub = this.editLog.subscribe(() => this.schedule());
    return () => {
      unsub();
      if (this.timer) clearTimeout(this.timer);
    };
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.commit(undefined, undefined, true), CHECKPOINT_DEBOUNCE_MS);
  }

  /**
   * Commit the edits since the last commit + the current snapshot, advancing HEAD.
   * No-op (returns null) when nothing is uncommitted. `auto` marks a system
   * checkpoint vs a named version.
   */
  async commit(message?: string, author?: Author, auto = false): Promise<CommitSummary | null> {
    const entries = this.uncommitted();
    if (entries.length === 0) return null;
    // Sweep in any feed notes posted since the last commit, so the narration is
    // anchored to the version it describes. Notes are not edits (materialize never
    // replays them); they ride alongside the entries purely as history.
    const notes = this.uncommittedNotes();
    const lastSeq = [...entries, ...notes].reduce((m, x) => Math.max(m, x.seq), this.lastCommittedSeq);
    // Keyframe when there is nothing to replay from (the root), on cadence, or when
    // the commit holds undo/redo entries - those restore a snapshot rather than
    // applying forward, so they can't be replayed; storing the snapshot makes this
    // commit a valid replay base and keeps every delta commit pure-forward.
    const keyframe =
      this.headId() === null ||
      this.commitsSinceKeyframe + 1 >= KEYFRAME_INTERVAL ||
      entries.some((e) => e.kind === "undo" || e.kind === "redo");
    const commit: Commit = {
      id: `cm-${crypto.randomUUID().slice(0, 8)}`,
      parent: this.headId(),
      author: author ?? entries[entries.length - 1].author,
      message: message ?? autoMessage(entries),
      time: Date.now(),
      auto,
      entryCount: entries.length,
      ...(keyframe ? { snapshot: this.project.snapshot() } : {}),
      entries,
      ...(notes.length ? { notes } : {}),
      lastSeq,
    };
    await this.repo.writeCommit(commit);
    this.refs = { ...this.refs, branches: { ...this.refs.branches, [this.refs.head]: commit.id } };
    await this.repo.writeRefs(this.refs);
    this.lastCommittedSeq = lastSeq;
    this.commitsSinceKeyframe = keyframe ? 0 : this.commitsSinceKeyframe + 1;
    this.editLog.resetCoalescing(); // a commit is a boundary: don't fold later edits into a committed entry
    this.emit();
    return toSummary(commit);
  }

  /**
   * Time-travel: load a commit's snapshot as the live project, recorded as a new
   * HEAD commit (history stays append-only - git-revert style, not a detached
   * HEAD). Subsequent edits checkpoint forward from here. No-op if id is unknown.
   */
  async revertTo(commitId: string, author: Author = "you"): Promise<CommitSummary | null> {
    const target = await this.repo.readCommit(commitId);
    if (!target) return null;
    const snapshot = await this.materialize(commitId); // reconstruct (target may be a delta)
    if (!snapshot) return null;
    this.project.load(snapshot); // live state jumps to the old snapshot
    const notes = this.uncommittedNotes(); // attach any pending narration to the revert
    const lastSeq = Math.max(
      this.maxSeq(),
      notes.reduce((m, n) => Math.max(m, n.seq), -1),
    ); // the jump consumes pending edits + notes
    const commit: Commit = {
      id: `cm-${crypto.randomUUID().slice(0, 8)}`,
      parent: this.headId(),
      author,
      message: `Revert to "${target.message}"`,
      time: Date.now(),
      auto: false,
      entryCount: 0,
      snapshot, // a revert is a discontinuity, so it anchors a fresh keyframe
      entries: [],
      ...(notes.length ? { notes } : {}),
      lastSeq,
    };
    await this.repo.writeCommit(commit);
    this.refs = { ...this.refs, branches: { ...this.refs.branches, [this.refs.head]: commit.id } };
    await this.repo.writeRefs(this.refs);
    this.lastCommittedSeq = lastSeq;
    this.commitsSinceKeyframe = 0;
    this.editLog.resetCoalescing();
    this.emit();
    return toSummary(commit);
  }

  /** The full commit (with snapshot + entries) by id, or null. */
  getCommit(id: string): Promise<Commit | null> {
    return this.repo.readCommit(id);
  }

  /** Readable, musical changes between two commits ("cutoff 400 -> 800"). */
  async diff(fromId: string, toId: string): Promise<string[]> {
    const [from, to] = await Promise.all([this.materialize(fromId), this.materialize(toId)]);
    if (!from || !to) return [];
    return diffProjects(from, to);
  }

  /** The commit chain from HEAD back to the root, newest first. */
  async history(limit = 100): Promise<CommitSummary[]> {
    const out: CommitSummary[] = [];
    let id = this.headId();
    while (id && out.length < limit) {
      const c = await this.repo.readCommit(id);
      if (!c) break;
      out.push(toSummary(c));
      id = c.parent;
    }
    return out;
  }

  getState(): VersionState {
    return { branch: this.refs.head, headId: this.headId(), hasUncommitted: this.uncommitted().length > 0 };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Reconstruct a commit's full project state: walk back to the nearest keyframe
   * (a commit carrying a snapshot), then replay the intervening delta commits'
   * edits forward through `applyEdit` on a headless store. Delta commits are
   * pure-forward by construction (undo/redo force a keyframe), so this is exact.
   * Returns null if the commit (or its keyframe) is missing.
   */
  private async materialize(commitId: string): Promise<ProjectData | null> {
    const forward: Commit[] = [];
    let id: string | null = commitId;
    let base: Commit | null = null;
    while (id) {
      const c = await this.repo.readCommit(id);
      if (!c) return null;
      if (c.snapshot) {
        base = c;
        break;
      }
      forward.push(c);
      id = c.parent;
    }
    if (!base?.snapshot) return null;
    const store = new ProjectStore(false);
    store.load(base.snapshot); // the keyframe already includes its own entries
    for (const c of forward.reverse()) {
      for (const e of c.entries) applyEdit(store, e.command, e.author);
    }
    return store.snapshot();
  }

  /** How many delta commits sit between `id` and the nearest keyframe (0 if it is one). */
  private async distanceToKeyframe(id: string | null): Promise<number> {
    let n = 0;
    while (id) {
      const c = await this.repo.readCommit(id);
      if (!c || c.snapshot) break;
      n++;
      id = c.parent;
    }
    return n;
  }

  private headId(): string | null {
    return this.refs.branches[this.refs.head] ?? null;
  }
  private uncommitted(): EditEntry[] {
    return this.editLog.getEntries().filter((e) => e.seq > this.lastCommittedSeq);
  }
  private uncommittedNotes(): FeedNote[] {
    return this.editLog.getNotes().filter((n) => n.seq > this.lastCommittedSeq);
  }
  private maxSeq(): number {
    return this.editLog.getEntries().reduce((m, e) => Math.max(m, e.seq), -1);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }
}

function autoMessage(entries: EditEntry[]): string {
  const desc = describeCommand(entries[entries.length - 1].command);
  return entries.length === 1 ? desc : `${desc} (+${entries.length - 1} more)`;
}

function toSummary(c: Commit): CommitSummary {
  return {
    id: c.id,
    parent: c.parent,
    author: c.author,
    message: c.message,
    time: c.time,
    auto: c.auto,
    entryCount: c.entryCount,
    noteCount: c.notes?.length ?? 0,
    lastSeq: c.lastSeq,
  };
}

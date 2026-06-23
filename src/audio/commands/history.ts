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
import type { ProjectStore } from '../project/projectStore';
import { describeCommand } from './describe';
import { diffProjects } from './diff';
import type { Author, EditEntry } from './types';
import type { EditLog } from './editLog';
import { getRepository, type Commit, type ProjectRepository, type Refs } from '../projectRepository';

/** A burst of edits within this window collapses into one auto-checkpoint. */
const CHECKPOINT_DEBOUNCE_MS = 4000;

/** A commit without its (large) snapshot/entries - for listing history. */
export interface CommitSummary {
  id: string;
  parent: string | null;
  author: Author;
  message: string;
  time: number;
  auto: boolean;
  entryCount: number;
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
  private refs: Refs = { head: 'main', branches: { main: null } };
  private lastCommittedSeq = -1;
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
    const lastSeq = entries.reduce((m, e) => Math.max(m, e.seq), this.lastCommittedSeq);
    const commit: Commit = {
      id: `cm-${crypto.randomUUID().slice(0, 8)}`,
      parent: this.headId(),
      author: author ?? entries[entries.length - 1].author,
      message: message ?? autoMessage(entries),
      time: Date.now(),
      auto,
      entryCount: entries.length,
      snapshot: this.project.snapshot(),
      entries,
      lastSeq,
    };
    await this.repo.writeCommit(commit);
    this.refs = { ...this.refs, branches: { ...this.refs.branches, [this.refs.head]: commit.id } };
    await this.repo.writeRefs(this.refs);
    this.lastCommittedSeq = lastSeq;
    this.emit();
    return toSummary(commit);
  }

  /**
   * Time-travel: load a commit's snapshot as the live project, recorded as a new
   * HEAD commit (history stays append-only - git-revert style, not a detached
   * HEAD). Subsequent edits checkpoint forward from here. No-op if id is unknown.
   */
  async revertTo(commitId: string, author: Author = 'you'): Promise<CommitSummary | null> {
    const target = await this.repo.readCommit(commitId);
    if (!target) return null;
    this.project.load(target.snapshot); // live state jumps to the old snapshot
    const lastSeq = this.maxSeq(); // the jump consumes any pending edits
    const commit: Commit = {
      id: `cm-${crypto.randomUUID().slice(0, 8)}`,
      parent: this.headId(),
      author,
      message: `Revert to "${target.message}"`,
      time: Date.now(),
      auto: false,
      entryCount: 0,
      snapshot: target.snapshot,
      entries: [],
      lastSeq,
    };
    await this.repo.writeCommit(commit);
    this.refs = { ...this.refs, branches: { ...this.refs.branches, [this.refs.head]: commit.id } };
    await this.repo.writeRefs(this.refs);
    this.lastCommittedSeq = lastSeq;
    this.emit();
    return toSummary(commit);
  }

  /** The full commit (with snapshot + entries) by id, or null. */
  getCommit(id: string): Promise<Commit | null> {
    return this.repo.readCommit(id);
  }

  /** Readable, musical changes between two commits' snapshots ("cutoff 400 -> 800"). */
  async diff(fromId: string, toId: string): Promise<string[]> {
    const [from, to] = await Promise.all([this.repo.readCommit(fromId), this.repo.readCommit(toId)]);
    if (!from || !to) return [];
    return diffProjects(from.snapshot, to.snapshot);
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

  private headId(): string | null {
    return this.refs.branches[this.refs.head] ?? null;
  }
  private uncommitted(): EditEntry[] {
    return this.editLog.getEntries().filter((e) => e.seq > this.lastCommittedSeq);
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
  return { id: c.id, parent: c.parent, author: c.author, message: c.message, time: c.time, auto: c.auto, entryCount: c.entryCount };
}

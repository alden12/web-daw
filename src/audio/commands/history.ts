/**
 * Version history: the commit DAG layered on top of the authored edit log.
 * The edit log is the fine-grained working stream; a *commit* is a coarse, durable
 * checkpoint - a full snapshot plus the edits since the last commit, with an author,
 * message, and a parent pointer (see apm: "History and versioning"). The DAG is the source of
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
import { randomUuid } from "../randomUuid";

/** A burst of edits within this window collapses into one auto-checkpoint. */
const CHECKPOINT_DEBOUNCE_MS = 4000;

/**
 * Keyframe cadence: store a full snapshot at most every Nth commit; the commits
 * between are deltas that replay forward from it. Bounds both per-commit size and
 * the replay length needed to reconstruct any commit (see apm: "History and versioning").
 */
const KEYFRAME_INTERVAL = 16;

/** Version-history markers in the authored log (remote mode): a named `commit` and a `loadSnapshot`
 *  revert. History (HEAD, the version list, diffs) is derived by scanning the log for these. */
const MARKER_TYPES = new Set(["commit", "loadSnapshot"]);
const isMarker = (entry: EditEntry): boolean => MARKER_TYPES.has(entry.command.type);
/** A real, forward edit that counts toward a version's change tally (not a marker, not a feed note). */
const isCountableEdit = (entry: EditEntry): boolean =>
  (entry.kind === undefined || entry.kind === "edit") && !MARKER_TYPES.has(entry.command.type);

/** The remote sink the remote-mode `VersionStore` authors commits through (a `SharedSession`). */
export interface RemoteCommitSink {
  postCommit(message: string, author: Author): void;
}

/** A commit without its (large) snapshot/entries - for listing history. */
export interface CommitSummary {
  id: string;
  parent: string | null;
  author: Author;
  message: string;
  time: number;
  auto: boolean;
  entryCount: number;
  /**
   * What this version's diff is measured against, which for a **named** version is the previous
   * *named* one rather than its parent.
   *
   * Auto checkpoints are plumbing: they fire on a debounce nobody sees, so which of them happens
   * to hold a given edit is a matter of how long you paused. Diffing a named version against its
   * literal parent therefore reports "No detected changes" about edits you certainly made, purely
   * because a checkpoint landed in between. Measuring from the last thing you *named* is both
   * stable and what "what changed in this version" means.
   *
   * Null at the root, and equal to `parent` for an auto checkpoint (which is its own answer).
   */
  diffBase: string | null;
  /** How many feed notes (intent narration) this commit swept in. */
  noteCount: number;
  /** Highest edit seq this commit included - positions it in the activity feed. */
  lastSeq: number;
}

export interface VersionState {
  branch: string;
  headId: string | null;
  /**
   * Whether there is anything worth naming: edits in no commit yet, **or** edits an auto
   * checkpoint has already swept that no named version claims.
   *
   * The second half is the point. Gating Save on "uncommitted" alone means the button greys out
   * four seconds after you stop editing, which is the debounce firing, and reads as the app
   * deciding your work does not count.
   */
  hasUnnamedChanges: boolean;
}

export class VersionStore {
  private readonly project: ProjectStore;
  private readonly editLog: EditLog;
  /** An injected repo (tests) pins the target; otherwise resolve the current project's
   *  repo dynamically, so a project switch (which repoints getRepository) is picked up. */
  private readonly repoOverride: ProjectRepository | null;
  private refs: Refs = { head: "main", branches: { main: null } };
  private lastCommittedSeq = -1;
  /** Whether HEAD is an auto checkpoint, so `getState` can tell "saved" from "merely checkpointed". */
  private headIsAuto = false;
  /** Delta commits written since the last keyframe (drives keyframe cadence). */
  private commitsSinceKeyframe = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  /**
   * Remote mode (server-authoritative history). When set, history is derived from the authoritative log's
   * markers instead of the client file-DAG: `commit()` authors a marker through this sink, `revertTo()`
   * dispatches a `loadSnapshot`, and reads scan the log + fetch pinned keyframes. The local file-DAG path
   * (below, untouched) runs when this is null - the `repoOverride` seam keeps offline/local projects on it.
   */
  private remoteSink: RemoteCommitSink | null = null;
  /** Cached derived state for the synchronous `getState()` (recomputed by `onLogAdvanced`). */
  private remoteHeadId: string | null = null;
  private remoteHasUncommitted = false;

  constructor(project: ProjectStore, editLog: EditLog, repo?: ProjectRepository) {
    this.project = project;
    this.editLog = editLog;
    this.repoOverride = repo ?? null;
  }

  private get isRemote(): boolean {
    return this.remoteSink !== null;
  }

  /** Switch to server-authoritative history: author commits through `sink` and derive history from the
   *  log. Pass null to return to the local file-DAG. Seeds the derived state. Call on (re)connect. */
  setRemote(sink: RemoteCommitSink | null): void {
    this.remoteSink = sink;
    if (sink) void this.onLogAdvanced();
  }

  /** The authoritative log advanced (a confirmed edit/commit/revert): recompute derived HEAD +
   *  uncommitted flags and notify listeners so the history UI re-reads. Wired to `SharedSession`. */
  async onLogAdvanced(): Promise<void> {
    if (!this.isRemote) return;
    const stream = await this.repo.readEditStream(-1);
    const markers = stream.filter(isMarker);
    this.remoteHeadId = markers.length > 0 ? String(markers[markers.length - 1].seq) : null;
    const lastMarkerSeq = markers.length > 0 ? markers[markers.length - 1].seq : -1;
    this.remoteHasUncommitted = stream.some((entry) => entry.seq > lastMarkerSeq && isCountableEdit(entry));
    this.emit();
  }

  private get repo(): ProjectRepository {
    return this.repoOverride ?? getRepository();
  }

  /** Load refs + HEAD from the bundle. Call after the project is restored. */
  async load(): Promise<void> {
    // Remote mode derives history from the log (no refs.json); just (re)seed the cached derived state.
    if (this.isRemote) return this.onLogAdvanced();
    const refs = await this.repo.readRefs();
    if (refs) {
      this.refs = refs;
      const head = this.headId() ? await this.repo.readCommit(this.headId()!) : null;
      this.lastCommittedSeq = head?.lastSeq ?? -1;
      this.headIsAuto = head?.auto ?? false;
      this.commitsSinceKeyframe = await this.distanceToKeyframe(this.headId());
    } else {
      // No history yet: reset to a fresh DAG and start from here, rather than
      // retro-committing the restored working log (which has no commits behind it).
      this.refs = { head: "main", branches: { main: null } };
      this.lastCommittedSeq = this.maxSeq();
      this.headIsAuto = false;
      this.commitsSinceKeyframe = 0;
    }
    this.emit();
  }

  /** Re-read history for the now-current project (after a project switch). */
  reload(): Promise<void> {
    return this.load();
  }

  /** Auto-checkpoint on edit activity (debounced). Returns a disposer. In remote mode there is no client
   *  auto-checkpoint: commits are explicit user actions and the authority owns keyframes, so this is a
   *  no-op (the history UI refreshes via `onLogAdvanced`, driven by the sync session). */
  attach(): () => void {
    if (this.isRemote) return () => {};
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
   * Commit the edits since the last commit + the current snapshot, advancing HEAD. `auto` marks a
   * system checkpoint vs a named version.
   *
   * **An auto checkpoint with nothing to record is a no-op; a named version never is.** A version
   * marks a state you want to be able to come back to, and whether an invisible checkpoint
   * happened to sweep the edits first has nothing to do with whether you meant to name it. That
   * asymmetry is the fix for a real bug: the checkpoint debounce is four seconds, so pausing that
   * long between the last edit and pressing Save used to leave you with no version and nothing
   * saying why.
   */
  async commit(message?: string, author?: Author, auto = false): Promise<CommitSummary | null> {
    // Remote mode: author a commit marker into the shared log. It gets an authoritative seq + broadcast,
    // and the confirmation re-reads history via `onLogAdvanced`, so we don't synthesise a summary here.
    if (this.isRemote) {
      if (!this.remoteHasUncommitted) return null; // nothing new since the last version
      this.remoteSink!.postCommit(message?.trim() || "Untitled version", author ?? "you");
      return null;
    }
    const entries = this.uncommitted();
    if (auto && entries.length === 0) return null;
    // A named save supersedes the checkpoint that was about to fire, so cancel it rather than
    // leaving a redundant one queued behind the version.
    if (this.timer) clearTimeout(this.timer);
    // Sweep in any feed notes posted since the last commit, so the narration is
    // anchored to the version it describes. Notes are not edits (materialize never
    // replays them); they ride alongside the entries purely as history.
    const notes = this.uncommittedNotes();
    const lastSeq = [...entries, ...notes].reduce(
      (highest, item) => Math.max(highest, item.seq),
      this.lastCommittedSeq,
    );
    // Keyframe when there is nothing to replay from (the root), on cadence, or when
    // the commit holds undo/redo entries - those restore a snapshot rather than
    // applying forward, so they can't be replayed; storing the snapshot makes this
    // commit a valid replay base and keeps every delta commit pure-forward.
    const keyframe =
      this.headId() === null ||
      this.commitsSinceKeyframe + 1 >= KEYFRAME_INTERVAL ||
      entries.some((entry) => entry.kind === "undo" || entry.kind === "redo");
    const commit: Commit = {
      id: `cm-${randomUuid().slice(0, 8)}`,
      parent: this.headId(),
      // Both fall back, because a named version can now carry no entries at all to read them off.
      author: author ?? entries[entries.length - 1]?.author ?? "you",
      message: message ?? (entries.length ? autoMessage(entries) : "Untitled version"),
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
    this.headIsAuto = auto;
    this.commitsSinceKeyframe = keyframe ? 0 : this.commitsSinceKeyframe + 1;
    this.editLog.resetCoalescing(); // a commit is a boundary: don't fold later edits into a committed entry
    this.emit();
    // Resolved against the *parent* chain, since this commit is not in it.
    return toSummary(commit, auto ? commit.parent : await this.previousNamed(commit.parent));
  }

  /**
   * Time-travel: load a commit's snapshot as the live project, recorded as a new
   * HEAD commit (history stays append-only - git-revert style, not a detached
   * HEAD). Subsequent edits checkpoint forward from here. No-op if id is unknown.
   */
  async revertTo(commitId: string, author: Author = "you"): Promise<CommitSummary | null> {
    // Remote mode: a revert rides the shared log as a `loadSnapshot` edit carrying the target snapshot.
    // Dispatching it through the EditLog applies it optimistically (live jumps now) and forwards it to the
    // authority, which orders + broadcasts it; peers replay it like any edit. It is also a history node.
    if (this.isRemote) {
      const seq = Number(commitId);
      const target = await this.repo.readKeyframe(seq);
      if (!target) return null;
      const label = (await this.history()).find((commit) => commit.id === commitId)?.message ?? `version ${seq}`;
      this.editLog.dispatch({ type: "loadSnapshot", project: target, message: `Revert to "${label}"` }, author);
      return null;
    }
    const target = await this.repo.readCommit(commitId);
    if (!target) return null;
    const snapshot = await this.materialize(commitId); // reconstruct (target may be a delta)
    if (!snapshot) return null;
    this.project.load(snapshot); // live state jumps to the old snapshot
    const notes = this.uncommittedNotes(); // attach any pending narration to the revert
    const lastSeq = Math.max(
      this.maxSeq(),
      notes.reduce((highest, note) => Math.max(highest, note.seq), -1),
    ); // the jump consumes pending edits + notes
    const commit: Commit = {
      id: `cm-${randomUuid().slice(0, 8)}`,
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
    this.headIsAuto = false; // a revert is a deliberate node, not a checkpoint
    this.commitsSinceKeyframe = 0;
    this.editLog.resetCoalescing();
    this.emit();
    return toSummary(commit);
  }

  /** The full commit (with snapshot + entries) by id, or null. Remote history has no `Commit` DAG nodes
   *  (markers + pinned keyframes only), so this is a local-mode read. */
  getCommit(id: string): Promise<Commit | null> {
    if (this.isRemote) return Promise.resolve(null);
    return this.repo.readCommit(id);
  }

  /** Readable, musical changes between two commits ("cutoff 400 -> 800"). */
  async diff(fromId: string, toId: string): Promise<string[]> {
    // Remote: materialise both versions from their pinned keyframes. The root (no parent) has no `from`.
    if (this.isRemote) {
      if (!fromId) return [];
      const [from, to] = await Promise.all([
        this.repo.readKeyframe(Number(fromId)),
        this.repo.readKeyframe(Number(toId)),
      ]);
      return from && to ? diffProjects(from, to) : [];
    }
    const [from, to] = await Promise.all([this.materialize(fromId), this.materialize(toId)]);
    if (!from || !to) return [];
    return diffProjects(from, to);
  }

  /** The commit chain from HEAD back to the root, newest first. */
  async history(limit = 100): Promise<CommitSummary[]> {
    // Remote: scan the authoritative log for version markers, newest first. Each marker's authoritative
    // seq is its id; `entryCount` is the real edits between it and the previous marker.
    if (this.isRemote) {
      const stream = await this.repo.readEditStream(-1);
      const summaries: CommitSummary[] = [];
      let previousSeq = -1;
      for (const marker of stream.filter(isMarker)) {
        const entryCount = stream.filter(
          (entry) => entry.seq > previousSeq && entry.seq < marker.seq && isCountableEdit(entry),
        ).length;
        const parent = previousSeq >= 0 ? String(previousSeq) : null;
        summaries.push({
          id: String(marker.seq),
          parent,
          // Remote history is built from markers only, so a parent already *is* the previous
          // named version; there are no auto checkpoints in the chain to skip over.
          diffBase: parent,
          author: marker.author,
          message: (marker.command as { message?: string }).message ?? "Version",
          time: marker.time,
          auto: false,
          entryCount,
          noteCount: 0,
          lastSeq: marker.seq,
        });
        previousSeq = marker.seq;
      }
      return summaries.reverse().slice(0, limit);
    }
    const chain: Commit[] = [];
    let id = this.headId();
    while (id && chain.length < limit) {
      const commit = await this.repo.readCommit(id);
      if (!commit) break;
      chain.push(commit);
      id = commit.parent;
    }
    // Newest-first, so a named version's diff base is the next named commit *further down* the
    // list. Auto checkpoints keep their parent, which is already the right answer for them.
    return chain.map((commit, index) => {
      if (commit.auto) return toSummary(commit);
      const previousNamed = chain.slice(index + 1).find((ancestor) => !ancestor.auto);
      // No named ancestor (or the chain was cut short by `limit`): fall back to the parent, which
      // is what this did before and is never wrong, only sometimes less useful.
      return toSummary(commit, previousNamed?.id ?? commit.parent);
    });
  }

  getState(): VersionState {
    if (this.isRemote)
      return { branch: "main", headId: this.remoteHeadId, hasUnnamedChanges: this.remoteHasUncommitted };
    return {
      branch: this.refs.head,
      headId: this.headId(),
      hasUnnamedChanges: this.uncommitted().length > 0 || this.headIsAuto,
    };
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
      const commit = await this.repo.readCommit(id);
      if (!commit) return null;
      if (commit.snapshot) {
        base = commit;
        break;
      }
      forward.push(commit);
      id = commit.parent;
    }
    if (!base?.snapshot) return null;
    const store = new ProjectStore(false);
    store.load(base.snapshot); // the keyframe already includes its own entries
    for (const commit of forward.reverse()) {
      for (const entry of commit.entries) applyEdit(store, entry.command, entry.author);
    }
    return store.snapshot();
  }

  /**
   * The nearest ancestor that is a named version, skipping auto checkpoints, falling back to
   * `from` itself when there is no named one behind it. This is what a named version's diff is
   * measured against - see `CommitSummary.diffBase` for why.
   */
  private async previousNamed(from: string | null): Promise<string | null> {
    let id = from;
    while (id) {
      const commit = await this.repo.readCommit(id);
      if (!commit) break;
      if (!commit.auto) return commit.id;
      id = commit.parent;
    }
    return from;
  }

  /** How many delta commits sit between `id` and the nearest keyframe (0 if it is one). */
  private async distanceToKeyframe(id: string | null): Promise<number> {
    let distance = 0;
    while (id) {
      const commit = await this.repo.readCommit(id);
      if (!commit || commit.snapshot) break;
      distance++;
      id = commit.parent;
    }
    return distance;
  }

  private headId(): string | null {
    return this.refs.branches[this.refs.head] ?? null;
  }
  private uncommitted(): EditEntry[] {
    return this.editLog.getEntries().filter((entry) => entry.seq > this.lastCommittedSeq);
  }
  private uncommittedNotes(): FeedNote[] {
    return this.editLog.getNotes().filter((note) => note.seq > this.lastCommittedSeq);
  }
  private maxSeq(): number {
    return this.editLog.getEntries().reduce((highest, entry) => Math.max(highest, entry.seq), -1);
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function autoMessage(entries: EditEntry[]): string {
  const desc = describeCommand(entries[entries.length - 1].command);
  return entries.length === 1 ? desc : `${desc} (+${entries.length - 1} more)`;
}

function toSummary(commit: Commit, diffBase: string | null = commit.parent): CommitSummary {
  return {
    id: commit.id,
    parent: commit.parent,
    author: commit.author,
    message: commit.message,
    time: commit.time,
    auto: commit.auto,
    entryCount: commit.entryCount,
    diffBase,
    noteCount: commit.notes?.length ?? 0,
    lastSeq: commit.lastSeq,
  };
}

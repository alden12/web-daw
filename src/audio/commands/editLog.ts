/**
 * The authored edit log: the single seam every durable edit flows through.
 * `dispatch(command, author)` records an undo checkpoint, applies the command,
 * and appends an authored, timestamped entry to an append-only log. The log is
 * the keystone artifact (it drives the activity feed now and, next slice, the
 * on-disk file format and history); undo/redo is a consumer built on top.
 *
 * Undo uses whole-project snapshot checkpoints (every store already has
 * snapshot()/load(), and load() rebuilds child stores + re-emits, so the UI and
 * the MCP mirror stay in sync). Rapid edits to the same target (a knob drag,
 * repeated nudges) coalesce into one checkpoint and one log entry.
 *
 * In-memory for this slice; persisting the log is the next step (the entry type
 * is serializable by construction).
 */
import type { ProjectStore } from '../project/projectStore';
import type { ProjectData } from '../project/types';
import { applyEdit } from './applyEdit';
import { describeCommand } from './describe';
import type { Author, EditCommand, EditEntry } from './types';

/**
 * An undo/redo checkpoint: the project state to restore, plus the command that
 * the checkpoint brackets - so undo/redo can describe what they reverted/reapplied
 * in the activity feed.
 */
interface Checkpoint {
  snap: ProjectData;
  command: EditCommand;
  author: Author;
}

const COALESCE_MS = 400;
const MAX_DEPTH = 100;
const COALESCABLE = new Set<EditCommand['type']>([
  'setParam',
  'setEffectParam',
  'setTrack',
  'setGroup',
  'setAudioClip',
  'setTempo',
  'setLength',
  'setLoopStart',
  'editNotes',
  'setClipLength',
  'movePlacement',
  'resizePlacement',
]);

/** Identity of a command's edit target, so successive edits to it can coalesce. */
function coalesceKey(c: EditCommand): string {
  switch (c.type) {
    case 'setParam':
      return `setParam:${c.trackId}:${c.id}`;
    case 'setEffectParam':
      return `setEffectParam:${c.hostId}:${c.effectId}:${c.id}`;
    case 'setTrack':
      return `setTrack:${c.trackId}`;
    case 'setGroup':
      return `setGroup:${c.groupId}`;
    case 'setAudioClip':
      return `setAudioClip:${c.trackId}`;
    case 'setTempo':
      return 'setTempo';
    case 'setLength':
      return 'setLength';
    case 'setLoopStart':
      return 'setLoopStart';
    case 'setClipLength':
      return `setClipLength:${c.trackId}:${c.clipId ?? ''}`;
    case 'movePlacement':
      return `movePlacement:${c.trackId}:${c.placementId}`;
    case 'resizePlacement':
      return `resizePlacement:${c.trackId}:${c.placementId}`;
    // Coalesce a continuous drag of a stable selection into one entry; a new
    // gesture (different note set) gets a fresh key, so it starts a new edit.
    case 'editNotes':
      return `editNotes:${c.trackId}:${c.clipId ?? ''}:${c.notes.map((n) => n.id).sort().join(',')}`;
    default:
      return c.type;
  }
}

export interface EditLogState {
  entries: EditEntry[];
  canUndo: boolean;
  canRedo: boolean;
}

export class EditLog {
  private readonly project: ProjectStore;
  private entries: EditEntry[] = [];
  private undoStack: Checkpoint[] = [];
  private redoStack: Checkpoint[] = [];
  private seq = 0;
  private lastKey: string | null = null;
  private lastTime = 0;
  private readonly listeners = new Set<() => void>();
  private cached!: EditLogState;

  constructor(project: ProjectStore) {
    this.project = project;
    this.rebuild();
  }

  /** Apply + log an edit. UI edits are authored 'you'; MCP (Claude) edits 'claude'. */
  dispatch = (command: EditCommand, author: Author = 'you'): void => {
    const now = Date.now();
    const key = COALESCABLE.has(command.type) ? `${author}:${coalesceKey(command)}` : null;
    const coalesce = key !== null && key === this.lastKey && now - this.lastTime < COALESCE_MS && this.entries.length > 0;

    if (coalesce) {
      // Same target as the last edit, within the window: fold into it (one undo
      // step, one log entry) - the pre-edit checkpoint already captures "before".
      applyEdit(this.project, command, author);
      const last = this.entries[this.entries.length - 1];
      this.entries[this.entries.length - 1] = { ...last, command, time: now };
      const top = this.undoStack[this.undoStack.length - 1];
      if (top) top.command = command; // describe the gesture by its latest state
    } else {
      this.undoStack.push({ snap: this.project.snapshot(), command, author });
      if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
      this.redoStack = [];
      applyEdit(this.project, command, author);
      this.entries.push({ seq: this.seq++, command, author, time: now, kind: 'edit' });
    }
    this.lastKey = key;
    this.lastTime = now;
    this.emit();
  };

  undo = (): void => {
    const cp = this.undoStack.pop();
    if (!cp) return;
    this.redoStack.push({ snap: this.project.snapshot(), command: cp.command, author: cp.author });
    this.project.load(cp.snap);
    // Record the undo in the activity feed (append-only; the feed is a reflog,
    // authored by whoever pressed undo - the local user).
    this.entries.push({ seq: this.seq++, command: cp.command, author: 'you', time: Date.now(), kind: 'undo', label: `Undid: ${describeCommand(cp.command)}` });
    this.lastKey = null;
    this.emit();
  };

  redo = (): void => {
    const cp = this.redoStack.pop();
    if (!cp) return;
    this.undoStack.push({ snap: this.project.snapshot(), command: cp.command, author: cp.author });
    this.project.load(cp.snap);
    this.entries.push({ seq: this.seq++, command: cp.command, author: 'you', time: Date.now(), kind: 'redo', label: `Redid: ${describeCommand(cp.command)}` });
    this.lastKey = null;
    this.emit();
  };

  getState(): EditLogState {
    return this.cached;
  }

  /** The raw append-only entries (for persistence). */
  getEntries(): EditEntry[] {
    return this.entries;
  }

  /**
   * Replace the log with persisted entries (on reload). Continues `seq` from the
   * highest restored entry so new edits stay monotonic (correct even if older
   * entries were trimmed). Undo/redo do not span a reload, so the checkpoint
   * stacks start empty.
   */
  restore(entries: EditEntry[]): void {
    this.entries = entries.slice();
    this.seq = entries.reduce((m, e) => Math.max(m, e.seq + 1), 0);
    this.undoStack = [];
    this.redoStack = [];
    this.lastKey = null;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private rebuild(): void {
    this.cached = {
      entries: this.entries.slice(),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  private emit(): void {
    this.rebuild();
    for (const l of this.listeners) l();
  }
}

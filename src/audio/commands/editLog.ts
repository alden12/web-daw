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
import type { Author, EditCommand, EditEntry } from './types';

const COALESCE_MS = 400;
const MAX_DEPTH = 100;
const COALESCABLE = new Set<EditCommand['type']>([
  'setParam',
  'setEffectParam',
  'setTrack',
  'setGroup',
  'setAudioClip',
  'setTempo',
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
  private undoStack: ProjectData[] = [];
  private redoStack: ProjectData[] = [];
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
    } else {
      this.undoStack.push(this.project.snapshot());
      if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
      this.redoStack = [];
      applyEdit(this.project, command, author);
      this.entries.push({ seq: this.seq++, command, author, time: now });
    }
    this.lastKey = key;
    this.lastTime = now;
    this.emit();
  };

  undo = (): void => {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.project.snapshot());
    this.project.load(prev);
    this.lastKey = null;
    this.emit();
  };

  redo = (): void => {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.project.snapshot());
    this.project.load(next);
    this.lastKey = null;
    this.emit();
  };

  getState(): EditLogState {
    return this.cached;
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

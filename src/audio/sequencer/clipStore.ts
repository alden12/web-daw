/**
 * The single source of truth for the song's note data. Framework- and
 * audio-agnostic (pure TS, reused by the Node MCP server as a mirror, exactly
 * like ParamStore). The UI, scheduler, MCP, and persistence all read and write
 * through this one object; every mutation validates input and notifies
 * subscribers.
 */
import { GRID, type ClipData, type NoteEvent } from './types';

const MIN_BPM = 20;
const MAX_BPM = 300;
const DEFAULT_TEMPO = 120;
const DEFAULT_LENGTH = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Input accepted by addNote; id/length/velocity are filled in if omitted. */
export interface NoteInput {
  pitch: number;
  start: number;
  length?: number;
  velocity?: number;
}

export class ClipStore {
  private readonly notes = new Map<string, NoteEvent>();
  private tempoBpm = DEFAULT_TEMPO;
  private lengthBeats = DEFAULT_LENGTH;
  private readonly listeners = new Set<() => void>();
  private cached!: ClipData;

  constructor(initial?: Partial<ClipData>) {
    if (initial) this.applyClip(initial);
    this.rebuild();
  }

  private normalize(input: NoteInput, id: string): NoteEvent {
    const start = clamp(snap(input.start), 0, Math.max(0, this.lengthBeats - GRID));
    const length = clamp(snap(input.length ?? 1), GRID, this.lengthBeats - start);
    return {
      id,
      pitch: clamp(Math.round(input.pitch), 0, 127),
      start,
      length,
      velocity: clamp(input.velocity ?? 0.8, 0, 1),
    };
  }

  private applyClip(clip: Partial<ClipData>): void {
    this.tempoBpm = clamp(clip.tempoBpm ?? this.tempoBpm, MIN_BPM, MAX_BPM);
    this.lengthBeats = clip.lengthBeats ?? this.lengthBeats;
    this.notes.clear();
    for (const n of clip.notes ?? []) {
      this.notes.set(n.id, this.normalize(n, n.id));
    }
  }

  private rebuild(): void {
    this.cached = {
      notes: [...this.notes.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch),
      tempoBpm: this.tempoBpm,
      lengthBeats: this.lengthBeats,
    };
  }

  private emit(): void {
    this.rebuild();
    for (const l of this.listeners) l();
  }

  /** Stable reference between mutations - safe for useSyncExternalStore. */
  getClip(): ClipData {
    return this.cached;
  }

  addNote(input: NoteInput): string {
    const id = crypto.randomUUID();
    this.notes.set(id, this.normalize(input, id));
    this.emit();
    return id;
  }

  /** Insert or replace a note with a known id (used to sync edits from elsewhere). */
  putNote(note: NoteEvent): void {
    this.notes.set(note.id, this.normalize(note, note.id));
    this.emit();
  }

  removeNote(id: string): void {
    if (this.notes.delete(id)) this.emit();
  }

  clear(): void {
    if (this.notes.size === 0) return;
    this.notes.clear();
    this.emit();
  }

  setTempo(bpm: number): void {
    const next = clamp(bpm, MIN_BPM, MAX_BPM);
    if (next === this.tempoBpm) return;
    this.tempoBpm = next;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ClipData {
    return this.cached;
  }

  load(clip: Partial<ClipData>): void {
    this.applyClip(clip);
    this.emit();
  }
}

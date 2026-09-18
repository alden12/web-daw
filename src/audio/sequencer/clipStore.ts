/**
 * The single source of truth for the song's note data. Framework- and
 * audio-agnostic (pure TS, reused by the Node MCP server as a mirror, exactly
 * like ParamStore). The UI, scheduler, MCP, and persistence all read and write
 * through this one object; every mutation validates input and notifies
 * subscribers.
 */
import { GRID, type ClipData, type NoteEvent } from "./types";
import { clamp } from "../../util";
import { randomUuid } from "../randomUuid";

const DEFAULT_LENGTH = 16;

/**
 * Smallest note length we keep (one 16th). Note *positions* are free - the store no
 * longer snaps `start`/`length` to the grid, so recorded feel, sub-grid edits, and
 * (later) grooves survive. Quantizing is now an explicit operation (see `quantize.ts`),
 * not an invariant. We still floor the length here so a note can't collapse to zero.
 */
const MIN_LENGTH = GRID;

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
  private lengthBeats = DEFAULT_LENGTH;
  private readonly listeners = new Set<() => void>();
  private cached: ClipData | null = null;

  constructor(initial?: Partial<ClipData>) {
    if (initial) this.applyClip(initial);
  }

  private normalize(input: NoteInput, id: string): NoteEvent {
    // Coerce into bounds (trusted-value clamping) but do NOT snap to the grid - the
    // note keeps its true position. The UI snaps at edit time; quantize is explicit.
    const start = clamp(input.start, 0, Math.max(0, this.lengthBeats - MIN_LENGTH));
    const length = clamp(input.length ?? 1, MIN_LENGTH, this.lengthBeats - start);
    return {
      id,
      pitch: clamp(Math.round(input.pitch), 0, 127),
      start,
      length,
      velocity: clamp(input.velocity ?? 0.8, 0, 1),
    };
  }

  private applyClip(clip: Partial<ClipData>): void {
    this.lengthBeats = clip.lengthBeats ?? this.lengthBeats;
    this.notes.clear();
    for (const note of clip.notes ?? []) {
      this.notes.set(note.id, this.normalize(note, note.id));
    }
  }

  /**
   * The sorted view, built on the first read after a change rather than on the change itself.
   *
   * Lazy because a mutation is cheap and this is not: it copies and re-sorts every note in the clip.
   * Doing it eagerly made replaying a log quadratic - filling a clip with n notes paid n sorts of an
   * ever-longer array, which measured 12 seconds for a hundred thousand edits and is the whole reason
   * deep rebuilds looked unaffordable. Nothing bulk (replay, `load`, the Node mirror) reads between
   * its own writes, so those now pay one sort instead of n.
   *
   * The cached object is still a stable reference between mutations, which is what
   * `useSyncExternalStore` needs; it is simply built a moment later than it used to be.
   */
  private view(): ClipData {
    this.cached ??= {
      notes: [...this.notes.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch),
      lengthBeats: this.lengthBeats,
    };
    return this.cached;
  }

  private emit(): void {
    this.cached = null;
    for (const listener of this.listeners) listener();
  }

  /** Stable reference between mutations - safe for useSyncExternalStore. */
  getClip(): ClipData {
    return this.view();
  }

  addNote(input: NoteInput): string {
    const id = randomUuid();
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

  /**
   * Set the loop length (beats) and re-clamp every note to fit, so shortening
   * the loop can't leave notes hanging past the end. `normalize` does the clamp.
   */
  setLength(beats: number): void {
    const next = Math.max(GRID, snap(beats));
    if (next === this.lengthBeats) return;
    this.lengthBeats = next;
    for (const [id, n] of this.notes) this.notes.set(id, this.normalize(n, id));
    this.emit();
  }

  getLength(): number {
    return this.lengthBeats;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ClipData {
    return this.view();
  }

  load(clip: Partial<ClipData>): void {
    this.applyClip(clip);
    this.emit();
  }
}

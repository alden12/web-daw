/**
 * The project: the structural single source of truth. Owns a flat list of tracks
 * (each a runtime object holding its own ParamStore + ClipStore) and a flat list
 * of groups (bus nodes with their own gain + effect chain); the group/track tree
 * is derived from `parentId`. Keeping storage flat lets the scheduler, engine,
 * and MCP mirror iterate a plain track list while routing and the UI read the
 * hierarchy. Structural changes (add/remove/select/rename/mute/volume/move/tempo)
 * notify subscribers; per-track param/clip changes are observed on the track's
 * own stores.
 *
 * Effects attach to a "host" - a track or a group - so a group's effect chain
 * reuses the same code path as a track's wholesale (the slice-5 routing).
 */
import { ParamStore } from '../params/store';
import { ClipStore } from '../sequencer/clipStore';
import { GRID } from '../sequencer/types';
import {
  INSTRUMENT_CATALOG,
  catalogEntry,
  instrumentSchema,
  instrumentFamily,
  DEFAULT_INSTRUMENT,
} from '../instruments/catalog';
import { EFFECT_CATALOG, effectSchema, DEFAULT_EFFECT } from '../effects/catalog';
import type { PatchValues } from '../params/types';
import type {
  ProjectData,
  TrackMeta,
  GroupMeta,
  AudioClipData,
  Placement,
  ClipAuthor,
  EffectData,
  InstrumentTrackData,
  AudioTrackData,
} from './types';

const MIN_BPM = 20;
const MAX_BPM = 300;
const MIN_LENGTH = 1; // beats
const MAX_LENGTH = 256; // beats (single-loop model; arrangement lifts this later)
const MIN_LOOP = 1; // beats - smallest loop region (loop end - loop start)
/** Default group family imported/recorded audio is filed into (the librarian). */
const AUDIO_FAMILY = 'Audio';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** An effect at runtime: meta + its own ParamStore over the effect's schema. */
export interface EffectInstance {
  id: string;
  type: string;
  bypassed: boolean;
  params: ParamStore;
}

/** Anything that owns an ordered effect chain: a track or a group bus. */
interface EffectHost {
  effects: EffectInstance[];
}

/** A group bus at runtime: meta + its own effect chain. Nests via parentId. */
export interface Group extends EffectHost {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
  muted: boolean;
  volume: number;
}

interface BaseTrack extends EffectHost {
  id: string;
  name: string;
  parentId: string;
  muted: boolean;
  volume: number;
}

/** A note clip (pattern) at runtime: meta + its own ClipStore (the notes). */
export interface NoteClip {
  id: string;
  name: string;
  author: ClipAuthor;
  store: ClipStore;
}

/**
 * An instrument track: a synth (track-level `params` + effect chain) that plays
 * a pool of note clips arranged along time as `placements`. Each clip owns its
 * own ClipStore, so edits persist per clip with no syncing; the scheduler reads
 * placements -> clip notes as pure data. `activeClipId` is the clip shown/edited
 * in the piano roll. The engine binds one instrument + one effect chain per track
 * (to `params`/`effects`), never to clips.
 */
export interface InstrumentTrack extends BaseTrack {
  kind: 'instrument';
  instrumentType: string;
  params: ParamStore;
  clips: NoteClip[];
  activeClipId: string;
  placements: Placement[];
}

/** An audio track: a pool of audio clips (buffer refs) arranged as `placements`. */
export interface AudioTrack extends BaseTrack {
  kind: 'audio';
  clips: AudioClipData[];
  activeClipId: string;
  placements: Placement[];
}

/** A track at runtime. Both kinds share the base fields + the effect chain. */
export type Track = InstrumentTrack | AudioTrack;

/** Stable structural view for the UI (no child stores). */
export interface ProjectStructure {
  groups: GroupMeta[];
  tracks: TrackMeta[];
  tempoBpm: number;
  lengthBeats: number;
  /** Loop start in beats; the playback loop region is [loopStart, lengthBeats]. */
  loopStart: number;
  selectedTrackId: string | null;
}

export class ProjectStore {
  private tracks: Track[] = [];
  private groups: Group[] = [];
  private tempoBpm = 120;
  private lengthBeats = 16;
  private loopStartBeats = 0;
  private selectedTrackId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private cached!: ProjectStructure;

  constructor(seedDefault = true) {
    if (seedDefault) this.addTrack(DEFAULT_INSTRUMENT);
    else this.rebuild();
  }

  /** Short but globally unique, so server- and browser-created ids never collide. */
  private nextId(): string {
    return `t-${crypto.randomUUID().slice(0, 8)}`;
  }
  private nextGroupId(): string {
    return `g-${crypto.randomUUID().slice(0, 8)}`;
  }
  private nextEffectId(): string {
    return `fx-${crypto.randomUUID().slice(0, 8)}`;
  }
  private nextClipId(): string {
    return `c-${crypto.randomUUID().slice(0, 8)}`;
  }
  private nextPlacementId(): string {
    return `p-${crypto.randomUUID().slice(0, 8)}`;
  }

  private effectMetas(host: EffectHost): TrackMeta['effects'] {
    return host.effects.map((fx) => ({ id: fx.id, type: fx.type, bypassed: fx.bypassed }));
  }

  private trackMeta(t: Track): TrackMeta {
    const base = {
      id: t.id,
      name: t.name,
      parentId: t.parentId,
      muted: t.muted,
      volume: t.volume,
      effects: this.effectMetas(t),
    };
    return t.kind === 'audio'
      ? {
          ...base,
          kind: 'audio',
          clips: t.clips.map((c) => ({ ...c })),
          activeClipId: t.activeClipId,
          placements: t.placements.map((p) => ({ ...p })),
        }
      : {
          ...base,
          kind: 'instrument',
          instrumentType: t.instrumentType,
          clips: t.clips.map((c) => ({ id: c.id, name: c.name, author: c.author, lengthBeats: c.store.getClip().lengthBeats })),
          activeClipId: t.activeClipId,
          placements: t.placements.map((p) => ({ ...p })),
        };
  }

  private rebuild(): void {
    this.cached = {
      groups: this.groups.map((g) => ({
        id: g.id,
        name: g.name,
        parentId: g.parentId,
        collapsed: g.collapsed,
        muted: g.muted,
        volume: g.volume,
        effects: this.effectMetas(g),
      })),
      tracks: this.tracks.map((t) => this.trackMeta(t)),
      tempoBpm: this.tempoBpm,
      lengthBeats: this.lengthBeats,
      loopStart: this.loopStartBeats,
      selectedTrackId: this.selectedTrackId,
    };
  }

  private emit(): void {
    this.rebuild();
    for (const l of this.listeners) l();
  }

  // --- reads ---
  getStructure(): ProjectStructure {
    return this.cached;
  }
  getTracks(): Track[] {
    return this.tracks;
  }
  getTrack(id: string): Track | undefined {
    return this.tracks.find((t) => t.id === id);
  }
  getGroups(): Group[] {
    return this.groups;
  }
  getGroup(id: string): Group | undefined {
    return this.groups.find((g) => g.id === id);
  }
  get selectedId(): string | null {
    return this.selectedTrackId;
  }
  getSelectedTrack(): Track | undefined {
    return this.selectedTrackId ? this.getTrack(this.selectedTrackId) : undefined;
  }
  get tempo(): number {
    return this.tempoBpm;
  }
  get length(): number {
    return this.lengthBeats;
  }
  get loopStart(): number {
    return this.loopStartBeats;
  }

  // --- groups ---------------------------------------------------------------
  /** Create a group (no emit). Reuses an existing group if `id` already exists. */
  private createGroup(opts: { id?: string; name?: string; parentId?: string | null } = {}): Group {
    if (opts.id) {
      const existing = this.getGroup(opts.id);
      if (existing) return existing;
    }
    const group: Group = {
      id: opts.id ?? this.nextGroupId(),
      name: opts.name ?? `Group ${this.groups.length + 1}`,
      parentId: opts.parentId ?? null,
      collapsed: false,
      muted: false,
      volume: 0.8,
      effects: [],
    };
    this.groups.push(group);
    return group;
  }

  /** Find the top-level group named for a family, or create it (no emit). The
   *  "librarian": new tracks are filed into their instrument's family group. */
  private ensureFamilyGroup(family: string): Group {
    return this.groups.find((g) => g.parentId === null && g.name === family) ?? this.createGroup({ name: family });
  }

  addGroup(opts: { id?: string; name?: string; parentId?: string | null } = {}): Group {
    const group = this.createGroup(opts);
    this.emit();
    return group;
  }

  /** Group ids in the subtree below `id` (excludes `id` itself). */
  private descendantGroupIds(id: string): Set<string> {
    const out = new Set<string>();
    const walk = (gid: string) => {
      for (const g of this.groups) {
        if (g.parentId === gid && !out.has(g.id)) {
          out.add(g.id);
          walk(g.id);
        }
      }
    };
    walk(id);
    return out;
  }

  /** Remove a group and everything inside it (descendant groups + their tracks). */
  removeGroup(id: string): void {
    if (!this.getGroup(id)) return;
    const doomed = this.descendantGroupIds(id);
    doomed.add(id);
    this.tracks = this.tracks.filter((t) => !doomed.has(t.parentId));
    this.groups = this.groups.filter((g) => !doomed.has(g.id));
    if (this.selectedTrackId && !this.getTrack(this.selectedTrackId)) {
      this.selectedTrackId = this.tracks[0]?.id ?? null;
    }
    this.emit();
  }

  renameGroup(id: string, name: string): void {
    const g = this.getGroup(id);
    if (!g || g.name === name) return;
    g.name = name;
    this.emit();
  }

  setGroupMuted(id: string, muted: boolean): void {
    const g = this.getGroup(id);
    if (!g || g.muted === muted) return;
    g.muted = muted;
    this.emit();
  }

  setGroupVolume(id: string, volume: number): void {
    const g = this.getGroup(id);
    if (!g) return;
    const next = clamp(volume, 0, 1);
    if (g.volume === next) return;
    g.volume = next;
    this.emit();
  }

  setGroupCollapsed(id: string, collapsed: boolean): void {
    const g = this.getGroup(id);
    if (!g || g.collapsed === collapsed) return;
    g.collapsed = collapsed;
    this.emit();
  }

  /** Reparent a group. Rejects self-parenting and cycles (parent in own subtree). */
  moveGroup(id: string, parentId: string | null): void {
    const g = this.getGroup(id);
    if (!g) return;
    if (parentId !== null) {
      if (parentId === id || !this.getGroup(parentId) || this.descendantGroupIds(id).has(parentId)) return;
    }
    if (g.parentId === parentId) return;
    g.parentId = parentId;
    this.emit();
  }

  /** Move a track into another group. */
  moveTrack(trackId: string, groupId: string): void {
    const t = this.getTrack(trackId);
    if (!t || !this.getGroup(groupId) || t.parentId === groupId) return;
    t.parentId = groupId;
    this.emit();
  }

  // --- tracks ---------------------------------------------------------------
  addTrack(instrumentType: string, opts: { name?: string; id?: string; groupId?: string } = {}): Track {
    const type = instrumentType in INSTRUMENT_CATALOG ? instrumentType : DEFAULT_INSTRUMENT;
    if (opts.id && this.getTrack(opts.id)) return this.getTrack(opts.id)!;
    const parentId =
      opts.groupId && this.getGroup(opts.groupId)
        ? opts.groupId
        : this.ensureFamilyGroup(instrumentFamily(type)).id;
    const trackId = opts.id ?? this.nextId();
    const params = new ParamStore(instrumentSchema(type));
    // Derive the seed clip/placement ids from the (agreed) track id so the browser
    // and the MCP mirror seed the SAME ids - addTrack runs independently on each
    // side, and divergent ids would make clip/placement tools address something
    // the other end doesn't have. Forks/new placements get communicated random ids.
    const clipId = `c-${trackId}`;
    const clip = new ClipStore({ lengthBeats: this.lengthBeats });
    const track: InstrumentTrack = {
      kind: 'instrument',
      id: trackId,
      name: opts.name ?? `${catalogEntry(type).label} ${this.tracks.length + 1}`,
      instrumentType: type,
      parentId,
      muted: false,
      volume: 0.8,
      params,
      effects: [],
      clips: [{ id: clipId, name: 'A', author: 'you', store: clip }],
      activeClipId: clipId,
      // One placement of the seed clip at the start, so a new track plays its clip.
      placements: [{ id: `p-${trackId}`, clipId, startBeat: 0, offset: 0, length: clip.getClip().lengthBeats }],
    };
    this.tracks.push(track);
    this.selectedTrackId = trackId;
    this.emit();
    return track;
  }

  /** Add an audio track for an imported/recorded clip (filed into the Audio group). */
  addAudioTrack(
    clip: { fileId: string; name?: string; durationSec?: number; startBeat?: number; gain?: number },
    opts: { name?: string; id?: string; groupId?: string } = {},
  ): AudioTrack {
    if (opts.id && this.getTrack(opts.id)) return this.getTrack(opts.id)! as AudioTrack;
    const parentId =
      opts.groupId && this.getGroup(opts.groupId) ? opts.groupId : this.ensureFamilyGroup(AUDIO_FAMILY).id;
    const trackId = opts.id ?? this.nextId();
    const name = opts.name ?? clip.name ?? `Audio ${this.tracks.length + 1}`;
    const clipId = `c-${trackId}`;
    const durationSec = clip.durationSec ?? 0;
    const track: AudioTrack = {
      kind: 'audio',
      id: trackId,
      name,
      parentId,
      muted: false,
      volume: 0.8,
      effects: [],
      clips: [{ id: clipId, name: clip.name ?? name, author: 'you', fileId: clip.fileId, gain: clip.gain ?? 1, durationSec }],
      activeClipId: clipId,
      placements: [
        { id: `p-${trackId}`, clipId, startBeat: clip.startBeat ?? 0, offset: 0, length: this.secondsToBeats(durationSec) },
      ],
    };
    this.tracks.push(track);
    this.selectedTrackId = trackId;
    this.emit();
    return track;
  }

  /** Natural length of `durationSec` in beats at the current tempo (>= 1 beat). */
  private secondsToBeats(durationSec: number): number {
    return Math.max(1, durationSec * (this.tempoBpm / 60));
  }

  /** Edit an audio clip's gain/name in the pool (no-op on instrument tracks). */
  setAudioClip(trackId: string, clipId: string | undefined, patch: { gain?: number; name?: string }): void {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== 'audio') return;
    const clip = t.clips.find((c) => c.id === (clipId ?? t.activeClipId));
    if (!clip) return;
    if (patch.gain !== undefined) clip.gain = clamp(patch.gain, 0, 1);
    if (patch.name !== undefined) clip.name = patch.name;
    this.emit();
  }

  removeTrack(id: string): void {
    const idx = this.tracks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    this.tracks.splice(idx, 1);
    if (this.selectedTrackId === id) {
      this.selectedTrackId = this.tracks[Math.min(idx, this.tracks.length - 1)]?.id ?? null;
    }
    this.emit();
  }

  selectTrack(id: string): void {
    if (!this.getTrack(id) || this.selectedTrackId === id) return;
    this.selectedTrackId = id;
    this.emit();
  }

  renameTrack(id: string, name: string): void {
    const t = this.getTrack(id);
    if (!t || t.name === name) return;
    t.name = name;
    this.emit();
  }

  setMuted(id: string, muted: boolean): void {
    const t = this.getTrack(id);
    if (!t || t.muted === muted) return;
    t.muted = muted;
    this.emit();
  }

  setVolume(id: string, volume: number): void {
    const t = this.getTrack(id);
    if (!t) return;
    const next = clamp(volume, 0, 1);
    if (t.volume === next) return;
    t.volume = next;
    this.emit();
  }

  setTempo(bpm: number): void {
    const next = clamp(bpm, MIN_BPM, MAX_BPM);
    if (next === this.tempoBpm) return;
    this.tempoBpm = next;
    this.emit();
  }

  /**
   * Set the arrangement loop length (beats): the scheduler loops the region
   * [loopStart, lengthBeats]. Clip lengths are independent (set per clip in the
   * piano roll), so this no longer touches clips.
   */
  setLength(beats: number): void {
    const next = clamp(beats, MIN_LENGTH, MAX_LENGTH);
    if (next === this.lengthBeats) return;
    this.lengthBeats = next;
    // Keep the loop start inside the new end.
    this.loopStartBeats = clamp(this.loopStartBeats, 0, next - MIN_LOOP);
    this.emit();
  }

  /**
   * Set the loop start (beats). The scheduler loops the region [loopStart, length];
   * notes before the start stay editable, they just don't play. Clamped inside the
   * loop end (leaving at least MIN_LOOP beats of region).
   */
  setLoopStart(beats: number): void {
    const next = clamp(beats, 0, this.lengthBeats - MIN_LOOP);
    if (next === this.loopStartBeats) return;
    this.loopStartBeats = next;
    this.emit();
  }

  // --- clip pool + arrangement (instrument & audio) -------------------------
  /** A unique, human clip name (A, B, C, ... AA) not already used on the track. */
  private nextClipName(t: Track): string {
    const used = new Set(t.clips.map((c) => c.name));
    for (let i = 0; ; i++) {
      const name = String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1);
      if (!used.has(name)) return name;
    }
  }

  /** Reconcile an effect chain against a target list IN PLACE (reuse by id, keep bindings). */
  private loadEffectsInPlace(host: EffectHost, want: EffectData[]): void {
    const byId = new Map(host.effects.map((fx) => [fx.id, fx] as const));
    host.effects = want.map((w) => {
      const existing = byId.get(w.id);
      if (existing && existing.type === w.type) {
        existing.bypassed = w.bypassed;
        existing.params.load(w.params);
        return existing;
      }
      const params = new ParamStore(effectSchema(w.type));
      if (w.params) params.load(w.params);
      return { id: w.id, type: w.type, bypassed: w.bypassed, params };
    });
  }

  /** The ClipStore for an instrument track's clip (the active one if `clipId` omitted). */
  getClipStore(trackId: string, clipId?: string): ClipStore | undefined {
    const t = this.getTrack(trackId);
    if (t?.kind !== 'instrument') return undefined;
    return t.clips.find((c) => c.id === (clipId ?? t.activeClipId))?.store;
  }

  /** Natural length (beats) of a clip in a track's pool: notes length, or audio duration. */
  private naturalLength(t: Track, clipId: string): number {
    if (t.kind === 'instrument') return t.clips.find((c) => c.id === clipId)?.store.getClip().lengthBeats ?? 4;
    const c = t.clips.find((x) => x.id === clipId);
    return c ? this.secondsToBeats(c.durationSec) : 4;
  }

  /**
   * Add a note clip to the pool and make it active. Defaults to forking the
   * active clip ("Try"); pass `empty` to start with no notes (a fresh clip), and
   * `lengthBeats` to set its pattern length (e.g. drag-to-size on the timeline).
   */
  addClip(
    trackId: string,
    opts: { id?: string; name?: string; fromClipId?: string; author?: ClipAuthor; empty?: boolean; lengthBeats?: number } = {},
  ): NoteClip | undefined {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== 'instrument') return undefined;
    const source = opts.empty ? undefined : t.clips.find((c) => c.id === (opts.fromClipId ?? t.activeClipId)) ?? t.clips[0];
    const id = opts.id && !t.clips.some((c) => c.id === opts.id) ? opts.id : this.nextClipId();
    const seed = source ? source.store.snapshot() : { notes: [], lengthBeats: this.lengthBeats };
    const clip: NoteClip = {
      id,
      name: opts.name ?? this.nextClipName(t),
      author: opts.author ?? 'you',
      store: new ClipStore({ notes: seed.notes.map((n) => ({ ...n })), lengthBeats: opts.lengthBeats ?? seed.lengthBeats }),
    };
    t.clips.push(clip);
    t.activeClipId = id;
    this.emit();
    return clip;
  }

  /** Make a clip the active one (shown/edited in the piano roll). */
  selectClip(trackId: string, clipId: string): void {
    const t = this.getTrack(trackId);
    if (!t || t.activeClipId === clipId || !t.clips.some((c) => c.id === clipId)) return;
    t.activeClipId = clipId;
    this.emit();
  }

  /** Remove a clip (never the last) and any placements of it; reassign active if needed. */
  removeClip(trackId: string, clipId: string): void {
    const t = this.getTrack(trackId);
    if (!t || t.clips.length <= 1) return;
    const idx = t.clips.findIndex((c) => c.id === clipId);
    if (idx === -1) return;
    t.clips.splice(idx, 1);
    t.placements = t.placements.filter((p) => p.clipId !== clipId);
    if (t.activeClipId === clipId) t.activeClipId = t.clips[Math.min(idx, t.clips.length - 1)].id;
    this.emit();
  }

  renameClip(trackId: string, clipId: string, name: string): void {
    const t = this.getTrack(trackId);
    if (!t) return;
    const c = t.clips.find((x) => x.id === clipId);
    if (!c || c.name === name) return;
    c.name = name;
    this.emit();
  }

  /** Set an instrument clip's pattern length (beats), re-clamping its notes. */
  setClipLength(trackId: string, clipId: string | undefined, lengthBeats: number): void {
    const store = this.getClipStore(trackId, clipId);
    store?.setLength(lengthBeats);
    this.emit();
  }

  // --- placements (arrangement) ---------------------------------------------
  /** Place a clip on the arrangement at `startBeat` (clip defaults to the active one). */
  addPlacement(
    trackId: string,
    opts: { id?: string; clipId?: string; startBeat?: number; offset?: number; length?: number },
  ): Placement | undefined {
    const t = this.getTrack(trackId);
    if (!t) return undefined;
    const clipId = opts.clipId ?? t.activeClipId;
    if (!t.clips.some((c) => c.id === clipId)) return undefined;
    const id = opts.id && !t.placements.some((p) => p.id === opts.id) ? opts.id : this.nextPlacementId();
    const placement: Placement = {
      id,
      clipId,
      startBeat: Math.max(0, opts.startBeat ?? 0),
      offset: Math.max(0, opts.offset ?? 0),
      length: opts.length ?? this.naturalLength(t, clipId),
    };
    t.placements.push(placement);
    this.emit();
    return placement;
  }

  movePlacement(trackId: string, placementId: string, startBeat: number): void {
    const p = this.getTrack(trackId)?.placements.find((x) => x.id === placementId);
    if (!p) return;
    p.startBeat = Math.max(0, startBeat);
    this.emit();
  }

  resizePlacement(trackId: string, placementId: string, patch: { offset?: number; length?: number }): void {
    const p = this.getTrack(trackId)?.placements.find((x) => x.id === placementId);
    if (!p) return;
    if (patch.offset !== undefined) p.offset = Math.max(0, patch.offset);
    if (patch.length !== undefined) p.length = Math.max(GRID, patch.length);
    this.emit();
  }

  removePlacement(trackId: string, placementId: string): void {
    const t = this.getTrack(trackId);
    if (!t) return;
    const before = t.placements.length;
    t.placements = t.placements.filter((p) => p.id !== placementId);
    if (t.placements.length !== before) this.emit();
  }

  /** Split a placement at an absolute beat into two windows over the same clip. */
  splitPlacement(trackId: string, placementId: string, atBeat: number, newId?: string): void {
    const t = this.getTrack(trackId);
    const p = t?.placements.find((x) => x.id === placementId);
    if (!t || !p) return;
    const local = atBeat - p.startBeat;
    if (local <= 0 || local >= p.length) return;
    const right: Placement = {
      id: newId && !t.placements.some((x) => x.id === newId) ? newId : this.nextPlacementId(),
      clipId: p.clipId,
      startBeat: p.startBeat + local,
      offset: p.offset + local,
      length: p.length - local,
    };
    p.length = local;
    t.placements.push(right);
    this.emit();
  }

  // --- effect chain (track OR group) ----------------------------------------
  /** Resolve an effect host (track or group) by id; ids are unique across both. */
  private getEffectHost(hostId: string): EffectHost | undefined {
    return this.getTrack(hostId) ?? this.getGroup(hostId);
  }

  addEffect(hostId: string, type: string, id?: string): EffectInstance | undefined {
    const host = this.getEffectHost(hostId);
    if (!host) return undefined;
    const fxType = type in EFFECT_CATALOG ? type : DEFAULT_EFFECT;
    if (id) {
      const existing = host.effects.find((fx) => fx.id === id);
      if (existing) return existing;
    }
    const effect: EffectInstance = {
      id: id ?? this.nextEffectId(),
      type: fxType,
      bypassed: false,
      params: new ParamStore(effectSchema(fxType)),
    };
    host.effects.push(effect);
    this.emit();
    return effect;
  }

  removeEffect(hostId: string, effectId: string): void {
    const host = this.getEffectHost(hostId);
    if (!host) return;
    const idx = host.effects.findIndex((fx) => fx.id === effectId);
    if (idx === -1) return;
    host.effects.splice(idx, 1);
    this.emit();
  }

  moveEffect(hostId: string, effectId: string, toIndex: number): void {
    const host = this.getEffectHost(hostId);
    if (!host) return;
    const from = host.effects.findIndex((fx) => fx.id === effectId);
    if (from === -1) return;
    const to = clamp(toIndex, 0, host.effects.length - 1);
    if (to === from) return;
    const [fx] = host.effects.splice(from, 1);
    host.effects.splice(to, 0, fx);
    this.emit();
  }

  setEffectBypass(hostId: string, effectId: string, bypassed: boolean): void {
    const fx = this.getEffectHost(hostId)?.effects.find((e) => e.id === effectId);
    if (!fx || fx.bypassed === bypassed) return;
    fx.bypassed = bypassed;
    this.emit();
  }

  getEffect(hostId: string, effectId: string): EffectInstance | undefined {
    return this.getEffectHost(hostId)?.effects.find((fx) => fx.id === effectId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- persistence / sync ---
  private snapshotEffects(host: EffectHost) {
    return host.effects.map((fx) => ({
      id: fx.id,
      type: fx.type,
      bypassed: fx.bypassed,
      params: fx.params.snapshot(),
    }));
  }

  snapshot(): ProjectData {
    return {
      groups: this.groups.map((g) => ({
        id: g.id,
        name: g.name,
        parentId: g.parentId,
        collapsed: g.collapsed,
        muted: g.muted,
        volume: g.volume,
        effects: this.snapshotEffects(g),
      })),
      tracks: this.tracks.map((t) => {
        const base = { id: t.id, name: t.name, parentId: t.parentId, muted: t.muted, volume: t.volume };
        const arrangement = {
          activeClipId: t.activeClipId,
          placements: t.placements.map((p) => ({ ...p })),
        };
        if (t.kind === 'audio') {
          return {
            ...base,
            kind: 'audio' as const,
            effects: this.snapshotEffects(t),
            clips: t.clips.map((c) => ({ ...c })),
            ...arrangement,
          };
        }
        return {
          ...base,
          kind: 'instrument' as const,
          instrumentType: t.instrumentType,
          params: t.params.snapshot(),
          effects: this.snapshotEffects(t),
          clips: t.clips.map((c) => {
            const data = c.store.snapshot();
            return { id: c.id, name: c.name, author: c.author, notes: data.notes.map((n) => ({ ...n })), lengthBeats: data.lengthBeats };
          }),
          ...arrangement,
        };
      }),
      tempoBpm: this.tempoBpm,
      lengthBeats: this.lengthBeats,
      loopStart: this.loopStartBeats,
      selectedTrackId: this.selectedTrackId,
    };
  }

  private loadEffects(effects: ProjectData['tracks'][number]['effects'] = []): EffectInstance[] {
    return effects.map((fx) => {
      const store = new ParamStore(effectSchema(fx.type));
      if (fx.params) store.load(fx.params);
      return { id: fx.id, type: fx.type, bypassed: fx.bypassed ?? false, params: store };
    });
  }

  private static author(a: unknown): ClipAuthor {
    return a === 'claude' ? 'claude' : 'you';
  }

  /**
   * The note-clip pool + active id + placements for an instrument track, reading
   * forward from any older shape:
   * - v7: `clips`/`activeClipId`/`placements` as stored.
   * - v6 variants: one clip per variant (notes only; per-variant params/effects are
   *   dropped - the track sound is migrated separately from the active variant).
   * - v4 single `clip`: one clip "A".
   * Migrated projects get a single placement of the active clip at beat 0, so they
   * play exactly as before.
   */
  private noteClipPool(
    t: InstrumentTrackData,
    projLen: number,
  ): { clips: NoteClip[]; activeClipId: string; placements: Placement[] } {
    const mk = (id: string, name: string, author: ClipAuthor, clip: { notes?: unknown; lengthBeats?: number }): NoteClip => ({
      id,
      name,
      author,
      store: new ClipStore({ notes: (clip.notes as never) ?? [], lengthBeats: clip.lengthBeats ?? projLen }),
    });

    let clips: NoteClip[];
    if (t.clips?.length) {
      clips = t.clips.map((c) => mk(c.id, c.name, ProjectStore.author(c.author), c));
    } else if (t.variants?.length) {
      clips = t.variants.map((v) => mk(v.id, v.name, ProjectStore.author(v.author), v.clip ?? {}));
    } else {
      clips = [mk(this.nextClipId(), 'A', 'you', t.clip ?? {})];
    }

    const wantActive = t.activeClipId ?? t.activeVariantId;
    const activeClipId = wantActive && clips.some((c) => c.id === wantActive) ? wantActive : clips[0].id;
    const placements: Placement[] = t.placements?.length
      ? t.placements.map((p) => ({ ...p }))
      : [{ id: this.nextPlacementId(), clipId: activeClipId, startBeat: 0, offset: 0, length: clips.find((c) => c.id === activeClipId)!.store.getClip().lengthBeats }];
    return { clips, activeClipId, placements };
  }

  /** The track-level sound for an instrument track (v7 top-level, else the active variant). */
  private instrumentSound(t: InstrumentTrackData): { params: PatchValues; effects: EffectData[] } {
    const active = t.variants?.find((v) => v.id === (t.activeVariantId ?? t.variants?.[0]?.id)) ?? t.variants?.[0];
    return { params: t.params ?? active?.params ?? {}, effects: t.effects ?? active?.effects ?? [] };
  }

  /** The audio-clip pool + active id + placements for an audio track (migrates `audioClip`). */
  private audioClipPool(t: AudioTrackData): { clips: AudioClipData[]; activeClipId: string; placements: Placement[] } {
    if (t.clips?.length) {
      const activeClipId = t.activeClipId && t.clips.some((c) => c.id === t.activeClipId) ? t.activeClipId : t.clips[0].id;
      return { clips: t.clips.map((c) => ({ ...c })), activeClipId, placements: (t.placements ?? []).map((p) => ({ ...p })) };
    }
    const a = t.audioClip;
    if (!a) return { clips: [], activeClipId: '', placements: [] };
    const clip: AudioClipData = { id: a.id, name: a.name, author: ProjectStore.author(a.author), fileId: a.fileId, gain: a.gain ?? 1, durationSec: a.durationSec ?? 0 };
    return {
      clips: [clip],
      activeClipId: clip.id,
      placements: [{ id: this.nextPlacementId(), clipId: clip.id, startBeat: a.startBeat ?? 0, offset: 0, length: this.secondsToBeats(clip.durationSec) }],
    };
  }

  load(data: ProjectData): void {
    const projLen = data.lengthBeats ?? 16;
    this.groups = (data.groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      parentId: g.parentId ?? null,
      collapsed: g.collapsed ?? false,
      muted: g.muted ?? false,
      volume: g.volume ?? 0.8,
      effects: this.loadEffects(g.effects),
    }));
    // Reuse existing child stores by id so the engine's per-track bindings stay
    // valid across load (undo/redo, variant switches) - replacing a ParamStore
    // would orphan the bound instrument. Stores are mutated in place below.
    const prev = new Map(this.tracks.map((t) => [t.id, t] as const));
    this.tracks = (data.tracks ?? []).map((t): Track => {
      const base = {
        id: t.id,
        name: t.name,
        parentId: t.parentId,
        muted: t.muted ?? false,
        volume: t.volume ?? 0.8,
      };
      if (t.kind === 'audio') {
        const pool = this.audioClipPool(t);
        return { ...base, kind: 'audio', effects: this.loadEffects(t.effects), ...pool };
      }
      // Legacy tracks predate `kind`; treat them as instrument tracks. The sound
      // (params + effects) is track-level; the clip pool + placements come from
      // whatever shape was stored (v7 clips, v6 variants, or a v4 single clip).
      const sound = this.instrumentSound(t);
      const { clips, activeClipId, placements } = this.noteClipPool(t, projLen);
      // Reuse the prior track's ParamStore + effect instances by id so the engine's
      // per-track bindings stay live across the load (clips are not engine-bound).
      const reuse = prev.get(t.id);
      const reused = reuse?.kind === 'instrument' && reuse.instrumentType === t.instrumentType ? reuse : undefined;
      const params = reused?.params ?? new ParamStore(instrumentSchema(t.instrumentType));
      params.load(sound.params);
      const track: InstrumentTrack = {
        ...base,
        kind: 'instrument',
        instrumentType: t.instrumentType,
        params,
        effects: reused?.effects ?? [],
        clips,
        activeClipId,
        placements,
      };
      this.loadEffectsInPlace(track, sound.effects);
      return track;
    });
    // Repair: every track must belong to a real group (migrates flat/legacy
    // projects by filing tracks into their instrument's family group).
    for (const t of this.tracks) {
      if (!t.parentId || !this.getGroup(t.parentId)) {
        const family = t.kind === 'audio' ? AUDIO_FAMILY : instrumentFamily(t.instrumentType);
        t.parentId = this.ensureFamilyGroup(family).id;
      }
    }
    this.tempoBpm = clamp(data.tempoBpm ?? 120, MIN_BPM, MAX_BPM);
    this.lengthBeats = data.lengthBeats ?? 16;
    this.loopStartBeats = clamp(data.loopStart ?? 0, 0, this.lengthBeats - MIN_LOOP);
    this.selectedTrackId =
      data.selectedTrackId && this.getTrack(data.selectedTrackId)
        ? data.selectedTrackId
        : (this.tracks[0]?.id ?? null);
    this.emit();
  }
}

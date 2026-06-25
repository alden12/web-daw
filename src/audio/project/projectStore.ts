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
import {
  INSTRUMENT_CATALOG,
  catalogEntry,
  instrumentSchema,
  instrumentFamily,
  DEFAULT_INSTRUMENT,
} from '../instruments/catalog';
import { EFFECT_CATALOG, effectSchema, DEFAULT_EFFECT } from '../effects/catalog';
import type { ProjectData, TrackMeta, GroupMeta, AudioClip, VariantData, VariantAuthor } from './types';

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

/**
 * An instrument track: a synth (params) playing a note clip. The live
 * `params`/`clip`/`effects` are the working copy of the active variant; the
 * parked variants are snapshots in `variants` (the active entry is refreshed
 * from the live stores on fold). Switching/forking loads a variant into the
 * live stores IN PLACE so the engine's bindings (created once per track id)
 * stay valid - see materializeVariant.
 */
export interface InstrumentTrack extends BaseTrack {
  kind: 'instrument';
  instrumentType: string;
  params: ParamStore;
  clip: ClipStore;
  variants: VariantData[];
  activeVariantId: string;
}

/** An audio track: a recorded/imported audio clip played back as a buffer. */
export interface AudioTrack extends BaseTrack {
  kind: 'audio';
  audioClip: AudioClip;
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
  private nextVariantId(): string {
    return `v-${crypto.randomUUID().slice(0, 8)}`;
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
      ? { ...base, kind: 'audio', audioClip: { ...t.audioClip } }
      : {
          ...base,
          kind: 'instrument',
          instrumentType: t.instrumentType,
          variants: t.variants.map((v) => ({ id: v.id, name: v.name, author: v.author })),
          activeVariantId: t.activeVariantId,
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
    const clip = new ClipStore({ lengthBeats: this.lengthBeats });
    // Derive the seed variant's id from the (agreed) track id so the browser and
    // the MCP mirror seed the SAME id - addTrack runs independently on each side,
    // and a divergent default-variant id would make variant tools address a
    // variant the other end doesn't have. Forks get communicated random ids.
    const variantId = `v-${trackId}`;
    const track: InstrumentTrack = {
      kind: 'instrument',
      id: trackId,
      name: opts.name ?? `${catalogEntry(type).label} ${this.tracks.length + 1}`,
      instrumentType: type,
      parentId,
      muted: false,
      volume: 0.8,
      params,
      clip,
      effects: [],
      // The whole sound is the active variant; the live stores are its working copy.
      variants: [{ id: variantId, name: 'A', author: 'you', clip: clip.snapshot(), params: params.snapshot(), effects: [] }],
      activeVariantId: variantId,
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
    const track: AudioTrack = {
      kind: 'audio',
      id: trackId,
      name,
      parentId,
      muted: false,
      volume: 0.8,
      effects: [],
      audioClip: {
        id: `ac-${crypto.randomUUID().slice(0, 8)}`,
        name: clip.name ?? name,
        fileId: clip.fileId,
        startBeat: clip.startBeat ?? 0,
        gain: clip.gain ?? 1,
        durationSec: clip.durationSec ?? 0,
      },
    };
    this.tracks.push(track);
    this.selectedTrackId = trackId;
    this.emit();
    return track;
  }

  /** Edit an audio clip's placement/gain (no-op on instrument tracks). */
  setAudioClip(trackId: string, patch: Partial<Pick<AudioClip, 'startBeat' | 'gain' | 'name'>>): void {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== 'audio') return;
    const next = {
      ...t.audioClip,
      ...(patch.startBeat !== undefined ? { startBeat: Math.max(0, patch.startBeat) } : {}),
      ...(patch.gain !== undefined ? { gain: clamp(patch.gain, 0, 1) } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
    };
    t.audioClip = next;
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
   * Set the project loop length (beats). Single-loop model: the scheduler loops
   * on this, and each instrument track's active clip is kept the same length (so
   * the piano-roll grid and playback agree, and notes past the end are clamped).
   */
  setLength(beats: number): void {
    const next = clamp(beats, MIN_LENGTH, MAX_LENGTH);
    if (next === this.lengthBeats) return;
    this.lengthBeats = next;
    // Keep the loop start inside the new end.
    this.loopStartBeats = clamp(this.loopStartBeats, 0, next - MIN_LOOP);
    for (const t of this.tracks) if (t.kind === 'instrument') t.clip.setLength(next);
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

  // --- variants (instrument tracks) -----------------------------------------
  /** A unique, human variant name (A, B, C, ... AA) not already used on the track. */
  private nextVariantName(t: InstrumentTrack): string {
    const used = new Set(t.variants.map((v) => v.name));
    for (let i = 0; ; i++) {
      const name = String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1);
      if (!used.has(name)) return name;
    }
  }

  /** Snapshot the live stores back into the active variant (it is otherwise stale). */
  private foldActiveVariant(t: InstrumentTrack): void {
    const v = t.variants.find((x) => x.id === t.activeVariantId);
    if (!v) return;
    v.clip = t.clip.snapshot();
    v.params = t.params.snapshot();
    v.effects = this.snapshotEffects(t);
  }

  /**
   * Reconcile a host's live effect chain against a target list IN PLACE: reuse
   * existing EffectInstances by id (load their params) so the engine's binding
   * survives; create fresh instances for new ids; drop removed; match order.
   */
  private loadEffectsInPlace(host: EffectHost, want: VariantData['effects']): void {
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

  /** Load a variant's bundle into the track's live stores in place; make it active. */
  private materializeVariant(t: InstrumentTrack, v: VariantData): void {
    t.params.load(v.params);
    t.clip.load(v.clip);
    this.loadEffectsInPlace(t, v.effects);
    t.activeVariantId = v.id;
  }

  /** Deep, independent copy of a variant's payload (clip notes + params + effects). */
  private cloneVariantPayload(v: VariantData): Pick<VariantData, 'clip' | 'params' | 'effects'> {
    return {
      clip: { notes: v.clip.notes.map((n) => ({ ...n })), lengthBeats: v.clip.lengthBeats },
      params: { ...v.params },
      effects: v.effects.map((fx) => ({ ...fx, params: { ...fx.params } })),
    };
  }

  /** Fork a variant ("Try"): clone the source (default active), park it, edit the copy. */
  addVariant(
    trackId: string,
    opts: { id?: string; name?: string; fromVariantId?: string; author?: VariantAuthor } = {},
  ): VariantData | undefined {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== 'instrument') return undefined;
    this.foldActiveVariant(t);
    const source =
      t.variants.find((v) => v.id === (opts.fromVariantId ?? t.activeVariantId)) ??
      t.variants.find((v) => v.id === t.activeVariantId)!;
    const id = opts.id && !t.variants.some((v) => v.id === opts.id) ? opts.id : this.nextVariantId();
    const variant: VariantData = {
      id,
      name: opts.name ?? this.nextVariantName(t),
      author: opts.author ?? 'you',
      ...this.cloneVariantPayload(source),
    };
    t.variants.push(variant);
    this.materializeVariant(t, variant);
    this.emit();
    return variant;
  }

  /** Switch the active variant: fold the current one, then materialize the target. */
  selectVariant(trackId: string, variantId: string): void {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== 'instrument' || t.activeVariantId === variantId) return;
    const target = t.variants.find((v) => v.id === variantId);
    if (!target) return;
    this.foldActiveVariant(t);
    this.materializeVariant(t, target);
    this.emit();
  }

  /** Remove a variant (never the last); reassign + materialize a neighbour if active. */
  removeVariant(trackId: string, variantId: string): void {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== 'instrument' || t.variants.length <= 1) return;
    const idx = t.variants.findIndex((v) => v.id === variantId);
    if (idx === -1) return;
    const removingActive = t.activeVariantId === variantId;
    t.variants.splice(idx, 1);
    if (removingActive) this.materializeVariant(t, t.variants[Math.min(idx, t.variants.length - 1)]);
    this.emit();
  }

  renameVariant(trackId: string, variantId: string, name: string): void {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== 'instrument') return;
    const v = t.variants.find((x) => x.id === variantId);
    if (!v || v.name === name) return;
    v.name = name;
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
        if (t.kind === 'audio') {
          return { ...base, kind: 'audio' as const, effects: this.snapshotEffects(t), audioClip: { ...t.audioClip } };
        }
        // The active variant is otherwise stale (the live stores are truth) - fold first.
        this.foldActiveVariant(t);
        return {
          ...base,
          kind: 'instrument' as const,
          instrumentType: t.instrumentType,
          activeVariantId: t.activeVariantId,
          variants: t.variants.map((v) => ({
            id: v.id,
            name: v.name,
            author: v.author,
            clip: { notes: v.clip.notes.map((n) => ({ ...n })), lengthBeats: v.clip.lengthBeats },
            params: { ...v.params },
            effects: v.effects.map((fx) => ({ ...fx, params: { ...fx.params } })),
          })),
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

  /**
   * The persisted variant stack for an instrument track. Migrates legacy v4
   * tracks (top-level params/clip/effects, no `variants`) into one default
   * variant, so older snapshots are read forward.
   */
  private normalizeVariants(t: ProjectData['tracks'][number], projLen: number): VariantData[] {
    // Legacy tracks predate `kind`; anything not explicitly audio is an instrument.
    if (t.kind === 'audio') return [];
    const author = (a: unknown): VariantAuthor => (a === 'claude' ? 'claude' : 'you');
    if (t.variants?.length) {
      return t.variants.map((v) => ({
        id: v.id,
        name: v.name,
        author: author(v.author),
        clip: v.clip ?? { notes: [], lengthBeats: projLen },
        params: v.params ?? {},
        effects: v.effects ?? [],
      }));
    }
    return [
      {
        id: this.nextVariantId(),
        name: 'A',
        author: 'you',
        clip: t.clip ?? { notes: [], lengthBeats: projLen },
        params: t.params ?? {},
        effects: t.effects ?? [],
      },
    ];
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
        return { ...base, kind: 'audio', effects: this.loadEffects(t.effects), audioClip: { ...t.audioClip } };
      }
      // Legacy tracks predate `kind`; treat them as instrument tracks.
      const variants = this.normalizeVariants(t, projLen);
      const activeVariantId =
        t.activeVariantId && variants.some((v) => v.id === t.activeVariantId) ? t.activeVariantId : variants[0].id;
      const reuse = prev.get(t.id);
      const reused = reuse?.kind === 'instrument' && reuse.instrumentType === t.instrumentType ? reuse : undefined;
      const track: InstrumentTrack = {
        ...base,
        kind: 'instrument',
        instrumentType: t.instrumentType,
        params: reused?.params ?? new ParamStore(instrumentSchema(t.instrumentType)),
        clip: reused?.clip ?? new ClipStore({ lengthBeats: projLen }),
        effects: reused?.effects ?? [],
        variants,
        activeVariantId,
      };
      // Load the active variant into the live stores in place (reuses effect
      // instances by id), keeping any reused bindings live.
      this.materializeVariant(track, variants.find((v) => v.id === activeVariantId)!);
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

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
import type { ProjectData, TrackMeta, GroupMeta } from './types';

const MIN_BPM = 20;
const MAX_BPM = 300;
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

/** A track at runtime: meta + its instrument params + its clip + its effect chain. */
export interface Track extends EffectHost {
  id: string;
  name: string;
  instrumentType: string;
  parentId: string;
  muted: boolean;
  volume: number;
  params: ParamStore;
  clip: ClipStore;
}

/** Stable structural view for the UI (no child stores). */
export interface ProjectStructure {
  groups: GroupMeta[];
  tracks: TrackMeta[];
  tempoBpm: number;
  lengthBeats: number;
  selectedTrackId: string | null;
}

export class ProjectStore {
  private tracks: Track[] = [];
  private groups: Group[] = [];
  private tempoBpm = 120;
  private lengthBeats = 16;
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

  private effectMetas(host: EffectHost): TrackMeta['effects'] {
    return host.effects.map((fx) => ({ id: fx.id, type: fx.type, bypassed: fx.bypassed }));
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
      tracks: this.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        instrumentType: t.instrumentType,
        parentId: t.parentId,
        muted: t.muted,
        volume: t.volume,
        effects: this.effectMetas(t),
      })),
      tempoBpm: this.tempoBpm,
      lengthBeats: this.lengthBeats,
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
    const track: Track = {
      id: trackId,
      name: opts.name ?? `${catalogEntry(type).label} ${this.tracks.length + 1}`,
      instrumentType: type,
      parentId,
      muted: false,
      volume: 0.8,
      params: new ParamStore(instrumentSchema(type)),
      clip: new ClipStore({ lengthBeats: this.lengthBeats }),
      effects: [],
    };
    this.tracks.push(track);
    this.selectedTrackId = trackId;
    this.emit();
    return track;
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
      tracks: this.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        instrumentType: t.instrumentType,
        parentId: t.parentId,
        muted: t.muted,
        volume: t.volume,
        params: t.params.snapshot(),
        clip: t.clip.snapshot(),
        effects: this.snapshotEffects(t),
      })),
      tempoBpm: this.tempoBpm,
      lengthBeats: this.lengthBeats,
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

  load(data: ProjectData): void {
    this.groups = (data.groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      parentId: g.parentId ?? null,
      collapsed: g.collapsed ?? false,
      muted: g.muted ?? false,
      volume: g.volume ?? 0.8,
      effects: this.loadEffects(g.effects),
    }));
    this.tracks = (data.tracks ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      instrumentType: t.instrumentType,
      parentId: t.parentId,
      muted: t.muted ?? false,
      volume: t.volume ?? 0.8,
      params: (() => {
        const store = new ParamStore(instrumentSchema(t.instrumentType));
        if (t.params) store.load(t.params);
        return store;
      })(),
      clip: new ClipStore(t.clip ?? { lengthBeats: data.lengthBeats ?? 16 }),
      effects: this.loadEffects(t.effects),
    }));
    // Repair: every track must belong to a real group (migrates flat/legacy
    // projects by filing tracks into their instrument's family group).
    for (const t of this.tracks) {
      if (!t.parentId || !this.getGroup(t.parentId)) {
        t.parentId = this.ensureFamilyGroup(instrumentFamily(t.instrumentType)).id;
      }
    }
    this.tempoBpm = clamp(data.tempoBpm ?? 120, MIN_BPM, MAX_BPM);
    this.lengthBeats = data.lengthBeats ?? 16;
    this.selectedTrackId =
      data.selectedTrackId && this.getTrack(data.selectedTrackId)
        ? data.selectedTrackId
        : (this.tracks[0]?.id ?? null);
    this.emit();
  }
}

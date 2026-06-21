/**
 * The project: the structural single source of truth. Owns the list of tracks
 * (each a runtime object holding its own ParamStore + ClipStore) plus transport
 * state (tempo, loop length, selection). Structural changes (add/remove/select/
 * rename/mute/volume/tempo) notify subscribers; per-track param/clip changes are
 * observed on the track's own stores.
 */
import { ParamStore } from '../params/store';
import { ClipStore } from '../sequencer/clipStore';
import { INSTRUMENT_CATALOG, catalogEntry, instrumentSchema, DEFAULT_INSTRUMENT } from '../instruments/catalog';
import { EFFECT_CATALOG, effectSchema, DEFAULT_EFFECT } from '../effects/catalog';
import type { ProjectData, TrackMeta } from './types';

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

/** A track at runtime: meta + its instrument params + its clip + its effect chain. */
export interface Track {
  id: string;
  name: string;
  instrumentType: string;
  muted: boolean;
  volume: number;
  params: ParamStore;
  clip: ClipStore;
  effects: EffectInstance[];
}

/** Stable structural view for the UI (no child stores). */
export interface ProjectStructure {
  tracks: TrackMeta[];
  tempoBpm: number;
  lengthBeats: number;
  selectedTrackId: string | null;
}

export class ProjectStore {
  private tracks: Track[] = [];
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
  private nextEffectId(): string {
    return `fx-${crypto.randomUUID().slice(0, 8)}`;
  }

  private rebuild(): void {
    this.cached = {
      tracks: this.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        instrumentType: t.instrumentType,
        muted: t.muted,
        volume: t.volume,
        effects: t.effects.map((fx) => ({ id: fx.id, type: fx.type, bypassed: fx.bypassed })),
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

  // --- structural mutations ---
  addTrack(instrumentType: string, name?: string, id?: string): Track {
    const type = instrumentType in INSTRUMENT_CATALOG ? instrumentType : DEFAULT_INSTRUMENT;
    if (id && this.getTrack(id)) return this.getTrack(id)!;
    const trackId = id ?? this.nextId();
    const track: Track = {
      id: trackId,
      name: name ?? `${catalogEntry(type).label} ${this.tracks.length + 1}`,
      instrumentType: type,
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

  // --- effect chain ---------------------------------------------------------
  addEffect(trackId: string, type: string, id?: string): EffectInstance | undefined {
    const track = this.getTrack(trackId);
    if (!track) return undefined;
    const fxType = type in EFFECT_CATALOG ? type : DEFAULT_EFFECT;
    if (id) {
      const existing = track.effects.find((fx) => fx.id === id);
      if (existing) return existing;
    }
    const effect: EffectInstance = {
      id: id ?? this.nextEffectId(),
      type: fxType,
      bypassed: false,
      params: new ParamStore(effectSchema(fxType)),
    };
    track.effects.push(effect);
    this.emit();
    return effect;
  }

  removeEffect(trackId: string, effectId: string): void {
    const track = this.getTrack(trackId);
    if (!track) return;
    const idx = track.effects.findIndex((fx) => fx.id === effectId);
    if (idx === -1) return;
    track.effects.splice(idx, 1);
    this.emit();
  }

  moveEffect(trackId: string, effectId: string, toIndex: number): void {
    const track = this.getTrack(trackId);
    if (!track) return;
    const from = track.effects.findIndex((fx) => fx.id === effectId);
    if (from === -1) return;
    const to = clamp(toIndex, 0, track.effects.length - 1);
    if (to === from) return;
    const [fx] = track.effects.splice(from, 1);
    track.effects.splice(to, 0, fx);
    this.emit();
  }

  setEffectBypass(trackId: string, effectId: string, bypassed: boolean): void {
    const fx = this.getTrack(trackId)?.effects.find((e) => e.id === effectId);
    if (!fx || fx.bypassed === bypassed) return;
    fx.bypassed = bypassed;
    this.emit();
  }

  getEffect(trackId: string, effectId: string): EffectInstance | undefined {
    return this.getTrack(trackId)?.effects.find((fx) => fx.id === effectId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- persistence / sync ---
  snapshot(): ProjectData {
    return {
      tracks: this.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        instrumentType: t.instrumentType,
        muted: t.muted,
        volume: t.volume,
        params: t.params.snapshot(),
        clip: t.clip.snapshot(),
        effects: t.effects.map((fx) => ({
          id: fx.id,
          type: fx.type,
          bypassed: fx.bypassed,
          params: fx.params.snapshot(),
        })),
      })),
      tempoBpm: this.tempoBpm,
      lengthBeats: this.lengthBeats,
      selectedTrackId: this.selectedTrackId,
    };
  }

  load(data: ProjectData): void {
    this.tracks = (data.tracks ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      instrumentType: t.instrumentType,
      muted: t.muted ?? false,
      volume: t.volume ?? 0.8,
      params: (() => {
        const store = new ParamStore(instrumentSchema(t.instrumentType));
        if (t.params) store.load(t.params);
        return store;
      })(),
      clip: new ClipStore(t.clip ?? { lengthBeats: data.lengthBeats ?? 16 }),
      effects: (t.effects ?? []).map((fx) => {
        const store = new ParamStore(effectSchema(fx.type));
        if (fx.params) store.load(fx.params);
        return { id: fx.id, type: fx.type, bypassed: fx.bypassed ?? false, params: store };
      }),
    }));
    this.tempoBpm = clamp(data.tempoBpm ?? 120, MIN_BPM, MAX_BPM);
    this.lengthBeats = data.lengthBeats ?? 16;
    this.selectedTrackId =
      data.selectedTrackId && this.getTrack(data.selectedTrackId)
        ? data.selectedTrackId
        : (this.tracks[0]?.id ?? null);
    this.emit();
  }
}

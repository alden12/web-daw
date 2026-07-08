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
import { ParamStore } from "../params/store";
import { ClipStore } from "../sequencer/clipStore";
import { GRID, type NoteEvent } from "../sequencer/types";
import { clamp } from "../../util";
import { secondsToBeats } from "../timing";
import {
  snapshotProject,
  loadEffectInstances,
  noteClipPool,
  instrumentSound,
  audioClipPool,
} from "./projectSerialization";
import { buildStructure } from "./projectStructure";
import {
  hasInstrument,
  catalogEntry,
  instrumentSchema,
  DEFAULT_INSTRUMENT,
  EMPTY_INSTRUMENT,
} from "../instruments/catalog";
import { hasEffect, effectSchema, DEFAULT_EFFECT } from "../effects/catalog";
import { DEFAULT_GROOVE_ID } from "../grooves/catalog";
import type { SampleAsset } from "../samples/catalog";
import type { PatchValues } from "../params/types";
import type {
  ProjectData,
  TrackMeta,
  GroupMeta,
  AudioClipData,
  Placement,
  ClipAuthor,
  ClipContent,
  EffectData,
} from "./types";

const MIN_BPM = 20;
const MAX_BPM = 300;
const MIN_LENGTH = 1; // beats
const MAX_LENGTH = 256; // beats (single-loop model; arrangement lifts this later)
const MIN_LOOP = 1; // beats - smallest loop region (loop end - loop start)
const MAX_AUDIO_GAIN = 4; // ~+12 dB - lets a quiet recording be boosted
const MIN_LOOP_SEC = 0.05; // seconds - smallest audio loop region
/** The single default group every new track is filed into (stable id for delta replay). */
const MAIN_GROUP_NAME = "main";
const MAIN_GROUP_ID = "g-main";

/** An effect at runtime: meta + its own ParamStore over the effect's schema. */
export interface EffectInstance {
  id: string;
  type: string;
  bypassed: boolean;
  params: ParamStore;
}

/** Anything that owns an ordered effect chain: a track or a group bus. */
export interface EffectHost {
  effects: EffectInstance[];
}

/** A group bus at runtime: meta + its own effect chain. Nests via parentId. */
export interface Group extends EffectHost {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
  muted: boolean;
  solo: boolean;
  volume: number;
}

interface BaseTrack extends EffectHost {
  id: string;
  name: string;
  parentId: string;
  muted: boolean;
  solo: boolean;
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
  kind: "instrument";
  instrumentType: string;
  params: ParamStore;
  clips: NoteClip[];
  activeClipId: string;
  placements: Placement[];
  /** A launched clip loops over the transport, overriding `placements`; null = play the arrangement. */
  launchedClipId: string | null;
}

/** An audio track: a pool of audio clips (buffer refs) arranged as `placements`. */
export interface AudioTrack extends BaseTrack {
  kind: "audio";
  clips: AudioClipData[];
  activeClipId: string;
  placements: Placement[];
  /** A launched clip loops over the transport, overriding `placements`; null = play the arrangement. */
  launchedClipId: string | null;
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
  /** Project-wide groove template id (see grooves/catalog) + how strongly it applies. */
  grooveId: string;
  grooveAmount: number;
  /** The project's imported-sample library (referenced by Sampler params as "asset:<id>"). */
  samples: SampleAsset[];
  selectedTrackId: string | null;
}

export class ProjectStore {
  private tracks: Track[] = [];
  private groups: Group[] = [];
  private tempoBpm = 120;
  private lengthBeats = 16;
  private loopStartBeats = 0;
  private grooveId = DEFAULT_GROOVE_ID;
  private grooveAmount = 1;
  private samples: SampleAsset[] = [];
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

  private rebuild(): void {
    this.cached = buildStructure(this.tracks, this.groups, {
      tempoBpm: this.tempoBpm,
      lengthBeats: this.lengthBeats,
      loopStartBeats: this.loopStartBeats,
      selectedTrackId: this.selectedTrackId,
      grooveId: this.grooveId,
      grooveAmount: this.grooveAmount,
      samples: this.samples,
    });
  }

  private emit(): void {
    this.rebuild();
    for (const listener of this.listeners) listener();
  }

  // --- reads ---
  getStructure(): ProjectStructure {
    return this.cached;
  }
  getTracks(): Track[] {
    return this.tracks;
  }
  getTrack(id: string): Track | undefined {
    return this.tracks.find((track) => track.id === id);
  }
  getGroups(): Group[] {
    return this.groups;
  }
  getGroup(id: string): Group | undefined {
    return this.groups.find((group) => group.id === id);
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
      solo: false,
      volume: 0.8,
      effects: [],
    };
    this.groups.push(group);
    return group;
  }

  /** Find the single default "main" group, or create it (no emit). New tracks are
   *  filed here; grouping is otherwise manual. The id is fixed (not random) so that
   *  replaying a createTrack that auto-files into it reconstructs the SAME id - delta
   *  replay (undo, commit materialize) needs apply to be a pure function of the command. */
  private ensureMainGroup(): Group {
    return (
      this.groups.find((group) => group.parentId === null && group.id === MAIN_GROUP_ID) ??
      this.groups.find((group) => group.parentId === null) ??
      this.createGroup({ id: MAIN_GROUP_ID, name: MAIN_GROUP_NAME })
    );
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
      for (const group of this.groups) {
        if (group.parentId === gid && !out.has(group.id)) {
          out.add(group.id);
          walk(group.id);
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
    this.tracks = this.tracks.filter((track) => !doomed.has(track.parentId));
    this.groups = this.groups.filter((group) => !doomed.has(group.id));
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

  setGroupSolo(id: string, solo: boolean): void {
    const g = this.getGroup(id);
    if (!g || g.solo === solo) return;
    g.solo = solo;
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
    const type = hasInstrument(instrumentType) ? instrumentType : DEFAULT_INSTRUMENT;
    if (opts.id && this.getTrack(opts.id)) return this.getTrack(opts.id)!;
    const parentId = opts.groupId && this.getGroup(opts.groupId) ? opts.groupId : this.ensureMainGroup().id;
    const trackId = opts.id ?? this.nextId();
    const params = new ParamStore(instrumentSchema(type));
    // Derive the seed clip/placement ids from the (agreed) track id so the browser
    // and the MCP mirror seed the SAME ids - addTrack runs independently on each
    // side, and divergent ids would make clip/placement tools address something
    // the other end doesn't have. Forks/new placements get communicated random ids.
    const clipId = `c-${trackId}`;
    const clip = new ClipStore({ lengthBeats: this.lengthBeats });
    const track: InstrumentTrack = {
      kind: "instrument",
      id: trackId,
      name: opts.name ?? `${type === EMPTY_INSTRUMENT ? "Track" : catalogEntry(type).label} ${this.tracks.length + 1}`,
      instrumentType: type,
      parentId,
      muted: false,
      solo: false,
      volume: 0.8,
      params,
      effects: [],
      clips: [{ id: clipId, name: "A", author: "you", store: clip }],
      activeClipId: clipId,
      // One placement of the seed clip at the start, so a new track plays its clip.
      placements: [{ id: `p-${trackId}`, clipId, startBeat: 0, offset: 0, length: clip.getClip().lengthBeats }],
      launchedClipId: null,
    };
    this.tracks.push(track);
    this.selectedTrackId = trackId;
    this.emit();
    return track;
  }

  /**
   * Assign (or swap) the instrument on an existing instrument track - e.g. an empty
   * track (`none`) picks one. Rebuilds the ParamStore from the new schema (shared
   * param ids carry over; unknown ones are dropped) and keeps the track's clips,
   * placements, effects, name, and mix. A pure function of (trackId, type), so delta
   * replay is deterministic; the engine swaps the node on the next reconcile.
   */
  setInstrument(trackId: string, instrumentType: string): void {
    const track = this.getTrack(trackId);
    if (!track || track.kind !== "instrument") return;
    const type = hasInstrument(instrumentType) ? instrumentType : DEFAULT_INSTRUMENT;
    if (track.instrumentType === type) return;
    const carried = track.params.snapshot();
    track.params = new ParamStore(instrumentSchema(type));
    track.params.load(carried); // load ignores ids not in the new schema
    track.instrumentType = type;
    this.emit();
  }

  /**
   * Add an instrument track from a saved patch: the instrument plus its parameter
   * values and effect chain. Effect ids are supplied by the caller (carried in the
   * `createTrackFromPatch` edit), so this is a pure function of its argument and
   * replays to the same track exactly. Values are loaded through the same coercing
   * setters as any edit, so an out-of-range stored value is clamped, not trusted blindly.
   */
  addTrackFromPatch(spec: {
    id: string;
    name?: string;
    groupId?: string;
    instrumentType: string;
    params: PatchValues;
    effects: { id: string; type: string; bypassed?: boolean; params: PatchValues }[];
  }): Track {
    if (spec.id && this.getTrack(spec.id)) return this.getTrack(spec.id)!;
    const track = this.addTrack(spec.instrumentType, { name: spec.name, id: spec.id, groupId: spec.groupId });
    if (track.kind === "instrument") {
      track.params.load(spec.params);
      for (const fx of spec.effects) {
        const effect = this.addEffect(track.id, fx.type, fx.id);
        if (!effect) continue;
        effect.params.load(fx.params);
        if (fx.bypassed) this.setEffectBypass(track.id, fx.id, true);
      }
    }
    this.emit();
    return track;
  }

  /**
   * Apply a patch to an existing instrument track (auditioning a patch on the current
   * track): replace its instrument, parameter values, and effect chain, keeping the
   * track's clips, name, and mix. A pure function of its argument (effect ids carried
   * in), so delta replay is deterministic. No-op on a non-instrument track.
   *
   * The instrument is handled two ways so the engine keeps making sound: on a *type
   * change* the ParamStore is replaced and the engine swaps the instrument node and
   * rebinds to the new store; on the *same* instrument the existing store is mutated in
   * place, because the engine's live param bindings are subscribed to that object.
   */
  applyPatchToTrack(spec: {
    trackId: string;
    instrumentType: string;
    params: PatchValues;
    effects: { id: string; type: string; bypassed?: boolean; params: PatchValues }[];
  }): void {
    const track = this.getTrack(spec.trackId);
    if (!track || track.kind !== "instrument") return;
    const type = hasInstrument(spec.instrumentType) ? spec.instrumentType : DEFAULT_INSTRUMENT;
    const schema = instrumentSchema(type);
    // The patch may set only some params; fill the rest from schema defaults so the
    // applied sound is the patch's, not a blend with whatever the track held before.
    const values = {
      ...Object.fromEntries(schema.map((paramSpec) => [paramSpec.id, paramSpec.default])),
      ...spec.params,
    };
    if (track.instrumentType !== type) {
      track.instrumentType = type;
      track.params = new ParamStore(schema);
    }
    track.params.load(values);
    // Replace the effect chain (the engine reconciles effect add/remove by id).
    for (const effect of [...track.effects]) this.removeEffect(track.id, effect.id);
    for (const fx of spec.effects) {
      const effect = this.addEffect(track.id, fx.type, fx.id);
      if (!effect) continue;
      effect.params.load(fx.params);
      if (fx.bypassed) this.setEffectBypass(track.id, fx.id, true);
    }
    this.emit();
  }

  /**
   * Create an empty audio track (no clips/placements yet) - the audio peer of an
   * empty instrument track. It renders an empty lane and an empty workbench until a
   * take is recorded into it (`addAudioClip`) or a clip is dropped onto it. Files into
   * the main group by default. `activeClipId` is "" (no clip selected) until then.
   */
  addEmptyAudioTrack(opts: { name?: string; id?: string; groupId?: string } = {}): AudioTrack {
    if (opts.id && this.getTrack(opts.id)) return this.getTrack(opts.id)! as AudioTrack;
    const parentId = opts.groupId && this.getGroup(opts.groupId) ? opts.groupId : this.ensureMainGroup().id;
    const trackId = opts.id ?? this.nextId();
    const track: AudioTrack = {
      kind: "audio",
      id: trackId,
      name: opts.name ?? `Audio ${this.tracks.length + 1}`,
      parentId,
      muted: false,
      solo: false,
      volume: 0.8,
      effects: [],
      clips: [],
      activeClipId: "",
      placements: [],
      launchedClipId: null,
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
    const parentId = opts.groupId && this.getGroup(opts.groupId) ? opts.groupId : this.ensureMainGroup().id;
    const trackId = opts.id ?? this.nextId();
    const name = opts.name ?? clip.name ?? `Audio ${this.tracks.length + 1}`;
    const clipId = `c-${trackId}`;
    const durationSec = clip.durationSec ?? 0;
    const track: AudioTrack = {
      kind: "audio",
      id: trackId,
      name,
      parentId,
      muted: false,
      solo: false,
      volume: 0.8,
      effects: [],
      clips: [
        { id: clipId, name: clip.name ?? name, author: "you", fileId: clip.fileId, gain: clip.gain ?? 1, durationSec },
      ],
      activeClipId: clipId,
      placements: [
        {
          id: `p-${trackId}`,
          clipId,
          startBeat: clip.startBeat ?? 0,
          offset: 0,
          length: this.naturalBeats(durationSec),
        },
      ],
      launchedClipId: null,
    };
    this.tracks.push(track);
    this.selectedTrackId = trackId;
    this.emit();
    return track;
  }

  /**
   * Add an audio clip (e.g. a recorded take) to an existing audio track's pool and
   * place it on the arrangement. Clip + placement ids are supplied by the caller
   * (carried in the `addAudioClip` edit), so this is a pure function of its argument
   * and replays to the same clip/placement exactly. No-op on a non-audio track.
   */
  addAudioClip(spec: {
    trackId: string;
    id: string;
    placementId: string;
    fileId: string;
    name?: string;
    durationSec?: number;
    gain?: number;
    startBeat?: number;
  }): void {
    const t = this.getTrack(spec.trackId);
    if (!t || t.kind !== "audio" || t.clips.some((clip) => clip.id === spec.id)) return;
    const durationSec = spec.durationSec ?? 0;
    t.clips.push({
      id: spec.id,
      name: spec.name ?? "Take",
      author: "you",
      fileId: spec.fileId,
      gain: spec.gain ?? 1,
      durationSec,
    });
    t.activeClipId = spec.id;
    if (!t.placements.some((placement) => placement.id === spec.placementId)) {
      const startBeat = Math.max(0, spec.startBeat ?? 0);
      const length = this.naturalBeats(durationSec);
      // A recorded take punches in over the lane: replace whatever it overlaps.
      this.replaceRegion(t, startBeat, startBeat + length, spec.placementId);
      t.placements.push({ id: spec.placementId, clipId: spec.id, startBeat, offset: 0, length });
    }
    this.emit();
  }

  /**
   * Add a note clip (a recorded MIDI take) to an instrument track's pool and place
   * it on the arrangement, punching in over whatever it overlaps. Clip + placement
   * ids and every note id are supplied by the caller (carried in the `addNoteClip`
   * edit), so this is a pure function of its argument and replays exactly. No-op on
   * a non-instrument track.
   */
  addNoteClip(
    spec: {
      trackId: string;
      id: string;
      placementId: string;
      name?: string;
      notes: NoteEvent[];
      lengthBeats: number;
      startBeat: number;
    },
    author: ClipAuthor = "you",
  ): void {
    const t = this.getTrack(spec.trackId);
    if (!t || t.kind !== "instrument" || t.clips.some((clip) => clip.id === spec.id)) return;
    const lengthBeats = Math.max(GRID, spec.lengthBeats);
    t.clips.push({
      id: spec.id,
      name: spec.name ?? this.nextClipName(t),
      author,
      store: new ClipStore({ notes: spec.notes.map((note) => ({ ...note })), lengthBeats }),
    });
    t.activeClipId = spec.id;
    if (!t.placements.some((placement) => placement.id === spec.placementId)) {
      const startBeat = Math.max(0, spec.startBeat);
      this.replaceRegion(t, startBeat, startBeat + lengthBeats, spec.placementId);
      t.placements.push({ id: spec.placementId, clipId: spec.id, startBeat, offset: 0, length: lengthBeats });
    }
    this.emit();
  }

  /**
   * Punch-in: clear the arrangement region [start, end) on a track so an incoming
   * placement replaces only what is beneath it. Placements fully inside the region
   * are dropped, ones straddling an edge are trimmed, and one that spans the whole
   * region is split into its surviving left/right remnants. The split remnant's id
   * is derived from `idPrefix` (the incoming placement id) so replay is deterministic.
   */
  private replaceRegion(t: Track, start: number, end: number, idPrefix: string): void {
    if (end <= start) return;
    t.placements = t.placements.flatMap((placement) => {
      const placementEnd = placement.startBeat + placement.length;
      if (placementEnd <= start || placement.startBeat >= end) return [placement]; // no overlap
      const keepLeft = placement.startBeat < start; // some survives before the region
      const keepRight = placementEnd > end; // some survives after the region
      if (keepLeft && keepRight) {
        const right: Placement = {
          id: `${idPrefix}-r-${placement.id}`,
          clipId: placement.clipId,
          startBeat: end,
          offset: placement.offset + (end - placement.startBeat),
          length: placementEnd - end,
        };
        return [{ ...placement, length: start - placement.startBeat }, right];
      }
      if (keepLeft) return [{ ...placement, length: start - placement.startBeat }];
      if (keepRight)
        return [
          {
            ...placement,
            startBeat: end,
            offset: placement.offset + (end - placement.startBeat),
            length: placementEnd - end,
          },
        ];
      return []; // fully covered -> drop
    });
  }

  /** Natural length of `durationSec` in beats at the current tempo (>= 1 beat). */
  private naturalBeats(durationSec: number): number {
    return Math.max(1, secondsToBeats(durationSec, this.tempoBpm));
  }

  /** Edit an audio clip's gain / name / loop region in the pool (no-op on instrument tracks). */
  setAudioClip(
    trackId: string,
    clipId: string | undefined,
    patch: { gain?: number; name?: string; loopStartSec?: number; loopEndSec?: number; gridOffsetSec?: number },
  ): void {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== "audio") return;
    const clip = t.clips.find((clip) => clip.id === (clipId ?? t.activeClipId));
    if (!clip) return;
    if (patch.gain !== undefined) clip.gain = clamp(patch.gain, 0, MAX_AUDIO_GAIN);
    if (patch.name !== undefined) clip.name = patch.name;
    // Grid slide: an alignment nudge, bounded to ±the clip length so the audio can
    // never be slid entirely out of reach of the downbeat.
    if (patch.gridOffsetSec !== undefined) {
      const bound = clip.durationSec || Infinity;
      clip.gridOffsetSec = clamp(patch.gridOffsetSec, -bound, bound);
    }
    // The loop region is a slice of the buffer in seconds, clamped inside the clip
    // with a minimum span; either end may be set independently.
    const dur = clip.durationSec || 0;
    if (patch.loopStartSec !== undefined) {
      const end = clip.loopEndSec ?? dur;
      clip.loopStartSec = clamp(patch.loopStartSec, 0, Math.max(0, end - MIN_LOOP_SEC));
    }
    if (patch.loopEndSec !== undefined) {
      const start = clip.loopStartSec ?? 0;
      clip.loopEndSec = clamp(patch.loopEndSec, start + MIN_LOOP_SEC, dur || patch.loopEndSec);
    }
    this.emit();
  }

  removeTrack(id: string): void {
    const idx = this.tracks.findIndex((track) => track.id === id);
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

  setSolo(id: string, solo: boolean): void {
    const t = this.getTrack(id);
    if (!t || t.solo === solo) return;
    t.solo = solo;
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

  /** The project-wide groove: which template, and how strongly it applies (0..1). */
  getGroove(): { id: string; amount: number } {
    return { id: this.grooveId, amount: this.grooveAmount };
  }

  /** Set the project groove template and/or amount; omitted fields stay unchanged. */
  setGroove(id?: string, amount?: number): void {
    const nextId = id ?? this.grooveId;
    const nextAmount = amount === undefined ? this.grooveAmount : clamp(amount, 0, 1);
    if (nextId === this.grooveId && nextAmount === this.grooveAmount) return;
    this.grooveId = nextId;
    this.grooveAmount = nextAmount;
    this.emit();
  }

  /** The project's imported-sample library. */
  getSamples(): SampleAsset[] {
    return this.samples;
  }

  /** Add an imported sample to the library (no-op if its id already exists). */
  addSample(asset: SampleAsset): void {
    if (this.samples.some((sample) => sample.id === asset.id)) return;
    this.samples = [...this.samples, asset];
    this.emit();
  }

  /** Remove a sample from the library by id (does not delete its bytes from the store). */
  removeSample(id: string): void {
    if (!this.samples.some((sample) => sample.id === id)) return;
    this.samples = this.samples.filter((sample) => sample.id !== id);
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
    const used = new Set(t.clips.map((clip) => clip.name));
    for (let i = 0; ; i++) {
      const name = String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1);
      if (!used.has(name)) return name;
    }
  }

  /** Reconcile an effect chain against a target list IN PLACE (reuse by id, keep bindings). */
  private loadEffectsInPlace(host: EffectHost, want: EffectData[]): void {
    const byId = new Map(host.effects.map((effect) => [effect.id, effect] as const));
    host.effects = want.map((wanted) => {
      const existing = byId.get(wanted.id);
      if (existing && existing.type === wanted.type) {
        existing.bypassed = wanted.bypassed;
        existing.params.load(wanted.params);
        return existing;
      }
      const params = new ParamStore(effectSchema(wanted.type));
      if (wanted.params) params.load(wanted.params);
      return { id: wanted.id, type: wanted.type, bypassed: wanted.bypassed, params };
    });
  }

  /** The ClipStore for an instrument track's clip (the active one if `clipId` omitted). */
  getClipStore(trackId: string, clipId?: string): ClipStore | undefined {
    const t = this.getTrack(trackId);
    if (t?.kind !== "instrument") return undefined;
    return t.clips.find((clip) => clip.id === (clipId ?? t.activeClipId))?.store;
  }

  /** Natural length (beats) of a clip in a track's pool: notes length, or audio duration. */
  private naturalLength(t: Track, clipId: string): number {
    if (t.kind === "instrument") return t.clips.find((clip) => clip.id === clipId)?.store.getClip().lengthBeats ?? 4;
    const c = t.clips.find((clip) => clip.id === clipId);
    return c ? this.naturalBeats(c.durationSec) : 4;
  }

  /**
   * Add a note clip to the pool and make it active. Defaults to forking the
   * active clip ("Try"); pass `empty` to start with no notes (a fresh clip), and
   * `lengthBeats` to set its pattern length (e.g. drag-to-size on the timeline).
   */
  addClip(
    trackId: string,
    opts: {
      id?: string;
      name?: string;
      fromClipId?: string;
      author?: ClipAuthor;
      empty?: boolean;
      lengthBeats?: number;
    } = {},
  ): NoteClip | undefined {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== "instrument") return undefined;
    const source = opts.empty
      ? undefined
      : (t.clips.find((clip) => clip.id === (opts.fromClipId ?? t.activeClipId)) ?? t.clips[0]);
    const id = opts.id && !t.clips.some((clip) => clip.id === opts.id) ? opts.id : this.nextClipId();
    const seed = source ? source.store.snapshot() : { notes: [], lengthBeats: this.lengthBeats };
    const clip: NoteClip = {
      id,
      name: opts.name ?? this.nextClipName(t),
      author: opts.author ?? "you",
      store: new ClipStore({
        notes: seed.notes.map((note) => ({ ...note })),
        lengthBeats: opts.lengthBeats ?? seed.lengthBeats,
      }),
    };
    t.clips.push(clip);
    t.activeClipId = id;
    this.emit();
    return clip;
  }

  /**
   * Paste copied clip content into a track's pool as a new active clip. Refuses a
   * cross-type paste (instrument <-> audio); audio reuses the source fileId (the
   * OPFS file is shared, not duplicated). Enables clip copy/paste within and
   * across same-kind tracks.
   */
  pasteClip(trackId: string, id: string, content: ClipContent, author: ClipAuthor = "you"): void {
    const t = this.getTrack(trackId);
    if (!t || t.kind !== content.kind) return;
    const clipId = id && !t.clips.some((clip) => clip.id === id) ? id : this.nextClipId();
    if (t.kind === "instrument" && content.kind === "instrument") {
      t.clips.push({
        id: clipId,
        name: content.name,
        author,
        store: new ClipStore({ notes: content.notes.map((note) => ({ ...note })), lengthBeats: content.lengthBeats }),
      });
    } else if (t.kind === "audio" && content.kind === "audio") {
      t.clips.push({
        id: clipId,
        name: content.name,
        author,
        fileId: content.fileId,
        gain: content.gain,
        durationSec: content.durationSec,
      });
    }
    t.activeClipId = clipId;
    this.emit();
  }

  /** Make a clip the active one (shown/edited in the piano roll). */
  selectClip(trackId: string, clipId: string): void {
    const t = this.getTrack(trackId);
    if (!t || t.activeClipId === clipId || !t.clips.some((clip) => clip.id === clipId)) return;
    t.activeClipId = clipId;
    this.emit();
  }

  /** Remove a clip (never the last) and any placements of it; reassign active if needed. */
  removeClip(trackId: string, clipId: string): void {
    const t = this.getTrack(trackId);
    if (!t || t.clips.length <= 1) return;
    const idx = t.clips.findIndex((clip) => clip.id === clipId);
    if (idx === -1) return;
    t.clips.splice(idx, 1);
    t.placements = t.placements.filter((placement) => placement.clipId !== clipId);
    if (t.activeClipId === clipId) t.activeClipId = t.clips[Math.min(idx, t.clips.length - 1)].id;
    this.emit();
  }

  renameClip(trackId: string, clipId: string, name: string): void {
    const t = this.getTrack(trackId);
    if (!t) return;
    const c = t.clips.find((clip) => clip.id === clipId);
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
    if (!t.clips.some((clip) => clip.id === clipId)) return undefined;
    const id =
      opts.id && !t.placements.some((placement) => placement.id === opts.id) ? opts.id : this.nextPlacementId();
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
    const p = this.getTrack(trackId)?.placements.find((placement) => placement.id === placementId);
    if (!p) return;
    p.startBeat = Math.max(0, startBeat);
    this.emit();
  }

  resizePlacement(trackId: string, placementId: string, patch: { offset?: number; length?: number }): void {
    const p = this.getTrack(trackId)?.placements.find((placement) => placement.id === placementId);
    if (!p) return;
    if (patch.offset !== undefined) p.offset = Math.max(0, patch.offset);
    if (patch.length !== undefined) p.length = Math.max(GRID, patch.length);
    this.emit();
  }

  removePlacement(trackId: string, placementId: string): void {
    const t = this.getTrack(trackId);
    if (!t) return;
    const before = t.placements.length;
    t.placements = t.placements.filter((placement) => placement.id !== placementId);
    if (t.placements.length !== before) this.emit();
  }

  /** Split a placement at an absolute beat into two windows over the same clip. */
  splitPlacement(trackId: string, placementId: string, atBeat: number, newId?: string): void {
    const t = this.getTrack(trackId);
    const p = t?.placements.find((placement) => placement.id === placementId);
    if (!t || !p) return;
    const local = atBeat - p.startBeat;
    if (local <= 0 || local >= p.length) return;
    const right: Placement = {
      id: newId && !t.placements.some((placement) => placement.id === newId) ? newId : this.nextPlacementId(),
      clipId: p.clipId,
      startBeat: p.startBeat + local,
      offset: p.offset + local,
      length: p.length - local,
    };
    p.length = local;
    t.placements.push(right);
    this.emit();
  }

  // --- clip launching (mode-less Session) -----------------------------------
  /**
   * Launch a clip on a track: it loops over the transport, overriding the track's
   * placements, until stopped (clipId null) or replaced. Persisted, so a launched
   * clip is part of the composition (a looping track without dragging placements).
   */
  launchClip(trackId: string, clipId: string | null): void {
    const t = this.getTrack(trackId);
    if (!t) return;
    const next = clipId && t.clips.some((clip) => clip.id === clipId) ? clipId : null;
    if (t.launchedClipId === next) return;
    t.launchedClipId = next;
    this.emit();
  }

  /** Stop every launched clip - the whole project plays its arrangement again. */
  stopAllClips(): void {
    let changed = false;
    for (const track of this.tracks) {
      if (track.launchedClipId !== null) {
        track.launchedClipId = null;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  // --- effect chain (track OR group) ----------------------------------------
  /** Resolve an effect host (track or group) by id; ids are unique across both. */
  private getEffectHost(hostId: string): EffectHost | undefined {
    return this.getTrack(hostId) ?? this.getGroup(hostId);
  }

  addEffect(hostId: string, type: string, id?: string): EffectInstance | undefined {
    const host = this.getEffectHost(hostId);
    if (!host) return undefined;
    const fxType = hasEffect(type) ? type : DEFAULT_EFFECT;
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
    const fx = this.getEffectHost(hostId)?.effects.find((effect) => effect.id === effectId);
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
  snapshot(): ProjectData {
    return snapshotProject(this.tracks, this.groups, {
      tempoBpm: this.tempoBpm,
      lengthBeats: this.lengthBeats,
      loopStartBeats: this.loopStartBeats,
      selectedTrackId: this.selectedTrackId,
      grooveId: this.grooveId,
      grooveAmount: this.grooveAmount,
      samples: this.samples,
    });
  }

  load(data: ProjectData): void {
    const projLen = data.lengthBeats ?? 16;
    this.groups = (data.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      parentId: group.parentId ?? null,
      collapsed: group.collapsed ?? false,
      muted: group.muted ?? false,
      solo: group.solo ?? false,
      volume: group.volume ?? 0.8,
      effects: loadEffectInstances(group.effects),
    }));
    // Reuse existing child stores by id so the engine's per-track bindings stay
    // valid across load (undo/redo) - replacing a ParamStore would orphan the
    // bound instrument. Stores are mutated in place below.
    const prev = new Map(this.tracks.map((track) => [track.id, track] as const));
    this.tracks = (data.tracks ?? []).map((stored): Track => {
      const base = {
        id: stored.id,
        name: stored.name,
        parentId: stored.parentId,
        muted: stored.muted ?? false,
        solo: stored.solo ?? false,
        volume: stored.volume ?? 0.8,
      };
      if (stored.kind === "audio") {
        const pool = audioClipPool(stored);
        const launchedClipId =
          stored.launchedClipId && pool.clips.some((clip) => clip.id === stored.launchedClipId)
            ? stored.launchedClipId
            : null;
        return { ...base, kind: "audio", effects: loadEffectInstances(stored.effects), ...pool, launchedClipId };
      }
      // Instrument track: the sound (params + effects) is track-level; the clip
      // pool + placements come from the stored clips/placements.
      const sound = instrumentSound(stored);
      const { clips, activeClipId, placements } = noteClipPool(stored, projLen, {
        clipId: () => this.nextClipId(),
        placementId: () => this.nextPlacementId(),
      });
      // Reuse the prior track's ParamStore + effect instances by id so the engine's
      // per-track bindings stay live across the load (clips are not engine-bound).
      const reuse = prev.get(stored.id);
      const reused = reuse?.kind === "instrument" && reuse.instrumentType === stored.instrumentType ? reuse : undefined;
      const params = reused?.params ?? new ParamStore(instrumentSchema(stored.instrumentType));
      params.load(sound.params);
      const launchedClipId =
        stored.launchedClipId && clips.some((clip) => clip.id === stored.launchedClipId) ? stored.launchedClipId : null;
      const track: InstrumentTrack = {
        ...base,
        kind: "instrument",
        instrumentType: stored.instrumentType,
        params,
        effects: reused?.effects ?? [],
        clips,
        activeClipId,
        placements,
        launchedClipId,
      };
      this.loadEffectsInPlace(track, sound.effects);
      return track;
    });
    // Invariant: every track must belong to a real group; file any orphan into main.
    for (const track of this.tracks) {
      if (!track.parentId || !this.getGroup(track.parentId)) track.parentId = this.ensureMainGroup().id;
    }
    this.tempoBpm = clamp(data.tempoBpm ?? 120, MIN_BPM, MAX_BPM);
    this.lengthBeats = data.lengthBeats ?? 16;
    this.loopStartBeats = clamp(data.loopStart ?? 0, 0, this.lengthBeats - MIN_LOOP);
    this.grooveId = data.grooveId ?? DEFAULT_GROOVE_ID;
    this.grooveAmount = clamp(data.grooveAmount ?? 1, 0, 1);
    this.samples = (data.samples ?? []).map((sample) => ({ ...sample }));
    this.selectedTrackId =
      data.selectedTrackId && this.getTrack(data.selectedTrackId) ? data.selectedTrackId : (this.tracks[0]?.id ?? null);
    this.emit();
  }
}

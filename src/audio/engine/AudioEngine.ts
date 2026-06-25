/**
 * The audio engine: owns the AudioContext and master output, and realizes the
 * project's tracks and groups as audio. Tracks come in two kinds:
 *   - instrument: an Instrument (from the registry, driven by the track's
 *     ParamStore) -> [track effects] -> trackGain
 *   - audio: scheduled AudioBufferSourceNodes -> an input gain -> [track effects]
 *     -> trackGain
 * Both feed their group's bus, mirroring the project's tree:
 *   ... -> trackGain -> group.input -> [group effects] -> group.output
 *       -> parent group.input | master -> limiter -> destination
 *
 * `reconcile` keeps audio in sync with the project: it builds/disposes nodes for
 * tracks and groups, rewires each effect chain, re-routes to the current parent,
 * applies mute/volume, and decodes any audio clips. A muted group zeroes its bus,
 * silencing all its descendants. Audio playback is driven by the Scheduler, which
 * calls `scheduleAudioClip` the way it calls `instrument.playNote`.
 */
import type { ProjectStore, EffectInstance } from '../project/projectStore';
import { createInstrument } from '../instruments/registry';
import type { Instrument } from '../instruments/types';
import { createEffect } from '../effects/registry';
import type { Effect } from '../effects/types';
import { getAudioBuffer } from '../audioStore';

interface TrackNode {
  instrument: Instrument;
  gain: GainNode;
  /** Effect instances by id; chain order comes from the track's effect list. */
  effects: Map<string, Effect>;
}

interface AudioTrackNode {
  /** Where this track's scheduled buffer sources feed in. */
  input: GainNode;
  /** Track volume/mute; feeds the group bus. */
  gain: GainNode;
  effects: Map<string, Effect>;
  /** Currently-playing sources, so playback can be stopped on transport stop. */
  sources: Set<AudioBufferSourceNode>;
}

interface GroupNode {
  /** Where this group's children (tracks/subgroups) sum in. */
  input: GainNode;
  /** Group volume/mute; feeds the parent group's input (or master). */
  output: GainNode;
  effects: Map<string, Effect>;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private readonly nodes = new Map<string, TrackNode>();
  private readonly audioNodes = new Map<string, AudioTrackNode>();
  private readonly groupNodes = new Map<string, GroupNode>();
  /** Decoded audio buffers keyed by OPFS file id (shared across tracks). */
  private readonly audioBuffers = new Map<string, AudioBuffer>();
  private readonly decoding = new Set<string>();
  private project: ProjectStore | null = null;
  private unsubscribe: (() => void) | null = null;

  get started(): boolean {
    return this.ctx !== null;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Must be called from a user gesture. Builds audio for the project's tracks. */
  async start(project: ProjectStore): Promise<void> {
    this.project = project;
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    // A gentle brick-wall limiter guards the bus as stacked tracks/effects sum.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.reconcile();
    this.unsubscribe = project.subscribe(() => this.reconcile());
    await ctx.resume();
  }

  private reconcile(): void {
    const ctx = this.ctx;
    const project = this.project;
    if (!ctx || !project || !this.master) return;

    const groups = project.getGroups();
    const tracks = project.getTracks();

    // Dispose nodes for removed groups/tracks (by kind - ids live in one map).
    const liveGroupIds = new Set(groups.map((g) => g.id));
    for (const [id, node] of this.groupNodes) {
      if (!liveGroupIds.has(id)) {
        this.disposeEffects(node.effects);
        node.input.disconnect();
        node.output.disconnect();
        this.groupNodes.delete(id);
      }
    }
    const instrumentIds = new Set(tracks.filter((t) => t.kind === 'instrument').map((t) => t.id));
    for (const [id, node] of this.nodes) {
      if (!instrumentIds.has(id)) {
        this.disposeEffects(node.effects);
        node.instrument.dispose();
        node.gain.disconnect();
        this.nodes.delete(id);
      }
    }
    const audioIds = new Set(tracks.filter((t) => t.kind === 'audio').map((t) => t.id));
    for (const [id, node] of this.audioNodes) {
      if (!audioIds.has(id)) {
        this.disposeAudioSources(node);
        this.disposeEffects(node.effects);
        node.input.disconnect();
        node.gain.disconnect();
        this.audioNodes.delete(id);
      }
    }

    // Ensure every group node exists before any routing (children may reference
    // a parent created in this same pass).
    for (const group of groups) {
      if (!this.groupNodes.has(group.id)) {
        this.groupNodes.set(group.id, { input: ctx.createGain(), output: ctx.createGain(), effects: new Map() });
      }
    }

    // Group effect chains and routing.
    for (const group of groups) {
      const node = this.groupNodes.get(group.id)!;
      this.reconcileEffects(node.effects, group.effects);
      this.rewireChain(node.input, node.effects, group.effects, node.output);
      node.output.disconnect();
      node.output.connect(this.parentInput(group.parentId));
      node.output.gain.setTargetAtTime(group.muted ? 0 : group.volume, ctx.currentTime, 0.01);
    }

    // Track nodes, effect chains, and routing into their group.
    for (const track of tracks) {
      if (track.kind === 'instrument') {
        let node = this.nodes.get(track.id);
        if (!node) {
          const gain = ctx.createGain();
          const instrument = createInstrument(track.instrumentType, ctx, track.params);
          node = { instrument, gain, effects: new Map() };
          this.nodes.set(track.id, node);
        }
        this.reconcileEffects(node.effects, track.effects);
        this.rewireChain(node.instrument.output, node.effects, track.effects, node.gain);
        node.gain.disconnect();
        node.gain.connect(this.parentInput(track.parentId));
        node.gain.gain.setTargetAtTime(track.muted ? 0 : track.volume, ctx.currentTime, 0.01);
      } else {
        let node = this.audioNodes.get(track.id);
        if (!node) {
          node = { input: ctx.createGain(), gain: ctx.createGain(), effects: new Map(), sources: new Set() };
          this.audioNodes.set(track.id, node);
        }
        this.reconcileEffects(node.effects, track.effects);
        this.rewireChain(node.input, node.effects, track.effects, node.gain);
        node.gain.disconnect();
        node.gain.connect(this.parentInput(track.parentId));
        node.gain.gain.setTargetAtTime(track.muted ? 0 : track.volume, ctx.currentTime, 0.01);
        this.ensureDecoded(track.audioClip.fileId);
      }
    }
  }

  /** The bus a child routes into: its parent group's input, or master at top level. */
  private parentInput(parentId: string | null): AudioNode {
    const parent = parentId ? this.groupNodes.get(parentId) : undefined;
    return parent?.input ?? this.master!;
  }

  private disposeEffects(effects: Map<string, Effect>): void {
    for (const fx of effects.values()) fx.dispose();
    effects.clear();
  }

  private disposeAudioSources(node: AudioTrackNode): void {
    for (const src of node.sources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    node.sources.clear();
  }

  /** Create effects for new instances, dispose effects no longer in the chain. */
  private reconcileEffects(live: Map<string, Effect>, chain: EffectInstance[]): void {
    const ctx = this.ctx!;
    const want = new Set(chain.map((fx) => fx.id));
    for (const [id, fx] of live) {
      if (!want.has(id)) {
        fx.dispose();
        live.delete(id);
      }
    }
    for (const fx of chain) {
      if (!live.has(fx.id)) live.set(fx.id, createEffect(fx.type, ctx, fx.params));
    }
  }

  /** Rewire source -> active effects (in order) -> dest. Leaves dest's own output. */
  private rewireChain(source: AudioNode, live: Map<string, Effect>, chain: EffectInstance[], dest: AudioNode): void {
    source.disconnect();
    for (const fx of live.values()) fx.output.disconnect();

    let cursor: AudioNode = source;
    for (const fx of chain) {
      if (fx.bypassed) continue;
      const effect = live.get(fx.id);
      if (!effect) continue;
      cursor.connect(effect.input);
      cursor = effect.output;
    }
    cursor.connect(dest);
  }

  /** Fetch + decode an audio file once, keyed by its OPFS id. */
  private ensureDecoded(fileId: string): void {
    if (!fileId || this.audioBuffers.has(fileId) || this.decoding.has(fileId)) return;
    this.decoding.add(fileId);
    getAudioBuffer(fileId)
      .then((arr) => this.ctx?.decodeAudioData(arr))
      .then((buffer) => {
        if (buffer) this.audioBuffers.set(fileId, buffer);
      })
      .catch(() => undefined)
      .finally(() => this.decoding.delete(fileId));
  }

  /** Schedule an audio track's clip to play at `when` (audio-clock seconds). */
  scheduleAudioClip(trackId: string, when: number): void {
    const ctx = this.ctx;
    const node = this.audioNodes.get(trackId);
    const track = this.project?.getTrack(trackId);
    if (!ctx || !node || track?.kind !== 'audio') return;
    const buffer = this.audioBuffers.get(track.audioClip.fileId);
    if (!buffer) return; // not decoded yet - silently skip this pass

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (track.audioClip.gain !== 1) {
      const clipGain = ctx.createGain();
      clipGain.gain.value = track.audioClip.gain;
      source.connect(clipGain);
      clipGain.connect(node.input);
    } else {
      source.connect(node.input);
    }
    source.start(when);
    node.sources.add(source);
    source.onended = () => {
      node.sources.delete(source);
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    };
  }

  /** Stop all currently-playing audio clips (called on transport stop). */
  stopAllAudio(): void {
    for (const node of this.audioNodes.values()) this.disposeAudioSources(node);
  }

  getInstrument(trackId: string): Instrument | undefined {
    return this.nodes.get(trackId)?.instrument;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const node of this.nodes.values()) {
      this.disposeEffects(node.effects);
      node.instrument.dispose();
      node.gain.disconnect();
    }
    this.nodes.clear();
    for (const node of this.audioNodes.values()) {
      this.disposeAudioSources(node);
      this.disposeEffects(node.effects);
      node.input.disconnect();
      node.gain.disconnect();
    }
    this.audioNodes.clear();
    for (const node of this.groupNodes.values()) {
      this.disposeEffects(node.effects);
      node.input.disconnect();
      node.output.disconnect();
    }
    this.groupNodes.clear();
    this.audioBuffers.clear();
    this.decoding.clear();
    this.limiter?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.limiter = null;
  }
}

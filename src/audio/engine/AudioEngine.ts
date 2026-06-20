/**
 * The audio engine: owns the AudioContext and master output, and realizes the
 * project's tracks as audio. Each track gets an Instrument (from the registry,
 * driven by the track's ParamStore) and a track gain (volume/mute), routed
 *   Instrument.output -> trackGain -> master -> destination.
 * (Effect chains will insert between instrument and trackGain next slice.)
 *
 * `reconcile` keeps audio in sync with the project: it builds audio for new
 * tracks, disposes audio for removed ones, and applies mute/volume.
 */
import type { ProjectStore, Track } from '../project/projectStore';
import { createInstrument } from '../instruments/registry';
import type { Instrument } from '../instruments/types';
import { createEffect } from '../effects/registry';
import type { Effect } from '../effects/types';

interface TrackNode {
  instrument: Instrument;
  gain: GainNode;
  /** Effect instances by id; chain order comes from the track's effect list. */
  effects: Map<string, Effect>;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private readonly nodes = new Map<string, TrackNode>();
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

    const tracks = project.getTracks();
    const liveIds = new Set(tracks.map((t) => t.id));

    for (const [id, node] of this.nodes) {
      if (!liveIds.has(id)) {
        for (const fx of node.effects.values()) fx.dispose();
        node.instrument.dispose();
        node.gain.disconnect();
        this.nodes.delete(id);
      }
    }

    for (const track of tracks) {
      let node = this.nodes.get(track.id);
      if (!node) {
        const gain = ctx.createGain();
        gain.connect(this.master);
        const instrument = createInstrument(track.instrumentType, ctx, track.params);
        node = { instrument, gain, effects: new Map() };
        this.nodes.set(track.id, node);
      }
      this.reconcileEffects(node, track);
      this.rewireChain(node, track);
      node.gain.gain.setTargetAtTime(track.muted ? 0 : track.volume, ctx.currentTime, 0.01);
    }
  }

  /** Create effects for new instances, dispose effects no longer in the chain. */
  private reconcileEffects(node: TrackNode, track: Track): void {
    const ctx = this.ctx!;
    const liveFx = new Set(track.effects.map((fx) => fx.id));
    for (const [id, fx] of node.effects) {
      if (!liveFx.has(id)) {
        fx.dispose();
        node.effects.delete(id);
      }
    }
    for (const fx of track.effects) {
      if (!node.effects.has(fx.id)) {
        node.effects.set(fx.id, createEffect(fx.type, ctx, fx.params));
      }
    }
  }

  /** Rewire instrument -> active effects (in order) -> trackGain. */
  private rewireChain(node: TrackNode, track: Track): void {
    node.instrument.output.disconnect();
    for (const fx of node.effects.values()) fx.output.disconnect();

    const chain = track.effects
      .filter((fx) => !fx.bypassed)
      .map((fx) => node.effects.get(fx.id))
      .filter((fx): fx is Effect => fx !== undefined);

    let cursor: AudioNode = node.instrument.output;
    for (const fx of chain) {
      cursor.connect(fx.input);
      cursor = fx.output;
    }
    cursor.connect(node.gain);
  }

  getInstrument(trackId: string): Instrument | undefined {
    return this.nodes.get(trackId)?.instrument;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const node of this.nodes.values()) {
      for (const fx of node.effects.values()) fx.dispose();
      node.instrument.dispose();
      node.gain.disconnect();
    }
    this.nodes.clear();
    this.limiter?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.limiter = null;
  }
}

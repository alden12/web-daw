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
import type { ProjectStore } from '../project/projectStore';
import { createInstrument } from '../instruments/registry';
import type { Instrument } from '../instruments/types';

interface TrackNode {
  instrument: Instrument;
  gain: GainNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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
    this.master.connect(ctx.destination);
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
        instrument.output.connect(gain);
        node = { instrument, gain };
        this.nodes.set(track.id, node);
      }
      node.gain.gain.setTargetAtTime(track.muted ? 0 : track.volume, ctx.currentTime, 0.01);
    }
  }

  getInstrument(trackId: string): Instrument | undefined {
    return this.nodes.get(trackId)?.instrument;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const node of this.nodes.values()) {
      node.instrument.dispose();
      node.gain.disconnect();
    }
    this.nodes.clear();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}

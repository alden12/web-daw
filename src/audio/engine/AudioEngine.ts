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
import type { ProjectStore, EffectInstance } from "../project/projectStore";
import type { AudioClipData } from "../project/types";
import { createInstrument } from "../instruments/registry";
import type { Instrument } from "../instruments/types";
import { createEffect } from "../effects/registry";
import type { Effect } from "../effects/types";
import { getAudioBuffer } from "../audioStore";
import { soloMutedTrackIds } from "./mix";
import { audioPlayWindow } from "./audioWindow";
import { loadWorklets } from "../worklets";

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
  /** A master-level bus for the metronome click (independent of any track). */
  private metronomeGain: GainNode | null = null;
  private metronomeVolume = 0.6;
  // --- live input capture (recording) ---
  private inputStream: MediaStream | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  /** Silent sink: keeps the capture worklet pulled by the graph without monitoring. */
  private captureSink: GainNode | null = null;
  private captureChunks: Float32Array[] = [];
  private capturing = false;
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
    // The metronome feeds the master bus (so it is limited with everything else)
    // but is not a track, so it ignores mute/solo and the arrangement.
    this.metronomeGain = ctx.createGain();
    this.metronomeGain.gain.value = this.metronomeVolume;
    this.metronomeGain.connect(this.master);
    // Load the worklet processor modules before building the graph, so effect
    // factories can construct AudioWorkletNodes synchronously in reconcile().
    await loadWorklets(ctx);
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

    // Solo + mute: enforced at the track gain; group buses stay open so a soloed
    // track inside an un-soloed group still routes through (see mix.ts).
    const mutedTracks = soloMutedTrackIds(groups, tracks);

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
    const instrumentIds = new Set(tracks.filter((t) => t.kind === "instrument").map((t) => t.id));
    for (const [id, node] of this.nodes) {
      if (!instrumentIds.has(id)) {
        this.disposeEffects(node.effects);
        node.instrument.dispose();
        node.gain.disconnect();
        this.nodes.delete(id);
      }
    }
    const audioIds = new Set(tracks.filter((t) => t.kind === "audio").map((t) => t.id));
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
      if (track.kind === "instrument") {
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
        node.gain.gain.setTargetAtTime(mutedTracks.has(track.id) ? 0 : track.volume, ctx.currentTime, 0.01);
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
        node.gain.gain.setTargetAtTime(mutedTracks.has(track.id) ? 0 : track.volume, ctx.currentTime, 0.01);
        for (const clip of track.clips) this.ensureDecoded(clip.fileId);
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

  /**
   * Schedule one of an audio track's clips to play at `when` (audio-clock seconds).
   * `maxDurationSec` caps how long it plays from `when` (the scheduler passes the time
   * to the loop boundary, so a region overrunning the loop is cut instead of overlapping
   * the loop's restart).
   */
  scheduleAudioClip(trackId: string, clip: AudioClipData, when: number, maxDurationSec?: number): void {
    const ctx = this.ctx;
    const node = this.audioNodes.get(trackId);
    if (!ctx || !node) return;
    const buffer = this.audioBuffers.get(clip.fileId);
    if (!buffer) return; // not decoded yet - silently skip this pass

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (clip.gain !== 1) {
      const clipGain = ctx.createGain();
      clipGain.gain.value = clip.gain;
      source.connect(clipGain);
      clipGain.connect(node.input);
    } else {
      source.connect(node.input);
    }
    // Play only the slice of the buffer under the (grid-fixed) loop window; the
    // scheduler re-triggers it to tile/repeat across a placement. The clip's grid
    // slide moves the buffer under the window, so the played slice shifts with it.
    const win = audioPlayWindow(
      clip.loopStartSec,
      clip.loopEndSec,
      clip.gridOffsetSec,
      buffer.duration,
      maxDurationSec,
    );
    if (!win) {
      try {
        source.disconnect();
      } catch {
        /* not connected */
      }
      return; // the window fell entirely off the buffer - nothing to play
    }
    if (win.offset > 0 || win.span < buffer.duration || win.delaySec > 0)
      source.start(when + win.delaySec, win.offset, win.span);
    else source.start(when);
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

  /**
   * Schedule a metronome click at `when` (audio-clock seconds). A short pitched
   * blip with a fast decay; the accented (downbeat) click is higher and louder.
   * Each click is a throwaway oscillator + envelope into the metronome bus.
   */
  scheduleClick(when: number, accent: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.metronomeGain) return;
    const t = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.value = accent ? 2000 : 1000;
    const peak = accent ? 0.9 : 0.55;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(env);
    env.connect(this.metronomeGain);
    osc.start(t);
    osc.stop(t + 0.06);
    osc.onended = () => {
      try {
        osc.disconnect();
        env.disconnect();
      } catch {
        // already torn down
      }
    };
  }

  /** Set the metronome click level (0..1). */
  setMetronomeVolume(volume: number): void {
    this.metronomeVolume = Math.min(1, Math.max(0, volume));
    if (this.metronomeGain && this.ctx) {
      this.metronomeGain.gain.setTargetAtTime(this.metronomeVolume, this.ctx.currentTime, 0.01);
    }
  }

  // --- live input capture (recording) --------------------------------------
  /**
   * Best-effort round-trip latency estimate (seconds) for recording compensation:
   * output + base latency. The browser does not expose input latency, so this is
   * a v1 estimate; a loopback calibration would make it exact (see DESIGN.md 14).
   */
  inputLatencySec(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const c = ctx as AudioContext & { outputLatency?: number };
    return (c.outputLatency ?? 0) + (ctx.baseLatency ?? 0);
  }

  /** Enumerate audio input devices (labels require a prior getUserMedia grant). */
  async listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput").map((d) => ({ deviceId: d.deviceId, label: d.label }));
  }

  /**
   * Open a mic input and wire it for capture: `MediaStreamSource -> captureNode ->
   * silent sink`. The voice DSP is disabled (or Chrome mangles the signal). The
   * source feeds the worklet only during `startRecording`; monitoring is hardware/
   * direct by default, so the input is never routed to the audible output.
   */
  async enableInput(deviceId?: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) throw new Error("Audio engine not started");
    this.disableInput();
    await loadWorklets(ctx); // idempotent; ensures the capture processor is registered
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.inputStream = stream;
    this.inputSource = ctx.createMediaStreamSource(stream);
    this.captureNode = new AudioWorkletNode(ctx, "capture-processor");
    this.captureNode.port.onmessage = (e) => {
      if (this.capturing && e.data instanceof Float32Array) this.captureChunks.push(e.data);
    };
    // A zero-gain sink to the destination so the worklet is pulled (and thus runs)
    // without being heard. The source is connected only while recording.
    this.captureSink = ctx.createGain();
    this.captureSink.gain.value = 0;
    this.captureNode.connect(this.captureSink);
    this.captureSink.connect(ctx.destination);
  }

  /** Begin collecting input frames; returns the audio-clock start time (seconds). */
  startRecording(): number {
    const ctx = this.ctx;
    if (!ctx || !this.inputSource || !this.captureNode) throw new Error("Input not enabled");
    this.captureChunks = [];
    this.capturing = true;
    this.inputSource.connect(this.captureNode);
    return ctx.currentTime;
  }

  /**
   * Stop collecting and return the captured mono samples. Awaits a short drain so
   * worklet messages already posted (but not yet delivered) are not dropped.
   */
  async stopRecording(): Promise<{ samples: Float32Array; sampleRate: number } | null> {
    const ctx = this.ctx;
    if (!ctx || !this.capturing) return null;
    try {
      this.inputSource?.disconnect(this.captureNode!);
    } catch {
      // already disconnected
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    this.capturing = false;
    const total = this.captureChunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const c of this.captureChunks) {
      samples.set(c, offset);
      offset += c.length;
    }
    this.captureChunks = [];
    return { samples, sampleRate: ctx.sampleRate };
  }

  /** Close the mic input and tear down the capture nodes. */
  disableInput(): void {
    this.capturing = false;
    this.captureChunks = [];
    try {
      this.inputSource?.disconnect();
      this.captureNode?.disconnect();
      this.captureSink?.disconnect();
    } catch {
      // already torn down
    }
    for (const track of this.inputStream?.getTracks() ?? []) track.stop();
    this.inputStream = null;
    this.inputSource = null;
    this.captureNode = null;
    this.captureSink = null;
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
    this.disableInput();
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
    this.metronomeGain?.disconnect();
    this.limiter?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.metronomeGain = null;
  }
}

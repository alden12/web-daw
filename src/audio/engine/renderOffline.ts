/**
 * Offline render (AGENT-4.1, "agent ears").
 *
 * Renders the project to an AudioBuffer under an `OfflineAudioContext`, reusing the EXACT DSP
 * the user hears (the same instrument/effect factories + worklets), so the agent can analyze
 * the mix (LUFS / spectral / clipping) without a second engine to keep in sync. The factories
 * take a `BaseAudioContext`, so an `OfflineAudioContext` is passed directly (no cast).
 *
 * `renderProjectOffline` is the real renderer; `renderWorkletSmokeTest` is the retained
 * de-risking probe that proved the crux - custom AudioWorklet instruments DO produce sound
 * offline - and doubles as the minimal regression guard. Both can only be exercised in a real
 * browser (jsdom has no AudioWorklet), so their coverage is the offline-render e2e.
 */
import { createInstrument } from "../instruments/registry";
import { createEffect } from "../effects/registry";
import { instrumentSchema } from "../instruments/catalog";
import { ParamStore } from "../params/store";
import { loadWorklets } from "../worklets";
import { setSampleAssets } from "../samples/sampleRegistry";
import { soloMutedTrackIds } from "./mix";
import { beatsToSeconds, tileClipNotes } from "../sequencer/scheduler";
import { grooveById } from "../grooves/catalog";
import { grooveAt } from "../sequencer/groove";
import { clamp } from "../../util";
import { analyzeMix, summarizeMix, type MixSummary } from "../analysis/analyze";
import type { ProjectStore, EffectInstance, InstrumentTrack } from "../project/projectStore";
import type { Instrument } from "../instruments/types";
import type { Effect } from "../effects/types";
import type { NoteEvent } from "../sequencer/types";

export interface RenderOptions {
  /** Render sample rate. Default 44100. */
  sampleRate?: number;
  /** Seconds rendered after the arrangement ends, so reverb/delay tails are captured. Default 2. */
  tailSec?: number;
}

/**
 * Render a project's arrangement to an AudioBuffer under an OfflineAudioContext, reusing the
 * exact instrument/effect factories the live engine uses (the "same DSP" thesis). The graph
 * mirrors AudioEngine.reconcile: instrument -> effects -> track gain -> group bus(es) -> master
 * -> limiter -> destination. Notes are flattened from placements and scheduled up front inside a
 * single suspend(0), so worklet-instrument port messages are queued before the first block.
 *
 * Async assets (sampler/drumkit buffers) are awaited via Instrument.ready before rendering, so
 * they are not silent. Remaining v1 gaps (deliberate, expand next): audio tracks are skipped; MIDI
 * devices are bypassed (the instrument plays directly - devices need an offline transport clock);
 * the region plays once (no loop repetition) and groove is not applied.
 */
export async function renderProjectOffline(project: ProjectStore, options: RenderOptions = {}): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100;
  const tailSec = options.tailSec ?? 2;
  const bpm = project.tempo;
  const loopStart = project.loopStart;
  const regionBeats = Math.max(0, project.length - loopStart);
  const durationSec = beatsToSeconds(regionBeats, bpm) + tailSec;
  const frames = Math.max(1, Math.ceil(durationSec * sampleRate));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  // Project groove: the schedule-time onset + velocity nudge the live scheduler applies per note.
  const { id: grooveId, amount: grooveAmount } = project.getGroove();
  const groove = grooveById(grooveId);

  await loadWorklets(ctx);
  setSampleAssets(project.getSamples()); // so a Sampler's "asset:<id>" ref resolves

  // Master bus + limiter, mirroring the live engine (AudioEngine.start).
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(ctx.destination);

  const groups = project.getGroups();
  const tracks = project.getTracks();
  const mutedTracks = soloMutedTrackIds(groups, tracks);
  const disposables: { dispose(): void }[] = [];

  // Build every group bus first (a child may route into a parent created this pass), then wire.
  const groupInputs = new Map<string, GainNode>();
  const groupOutputs = groups.map((group) => {
    const input = ctx.createGain();
    groupInputs.set(group.id, input);
    return { group, input, output: ctx.createGain() };
  });
  const parentInput = (parentId: string | null): AudioNode =>
    (parentId ? groupInputs.get(parentId) : undefined) ?? master;
  for (const { group, input, output } of groupOutputs) {
    disposables.push(...connectChain(ctx, input, group.effects, output));
    output.connect(parentInput(group.parentId));
    output.gain.value = group.muted ? 0 : group.volume;
  }

  // Instrument tracks: build instrument + effects, route into the group tree, and collect the
  // scheduling closures (run later, inside suspend, so worklet note messages are queued in time).
  const scheduleFns: (() => void)[] = [];
  const instruments: Instrument[] = [];
  for (const track of tracks) {
    if (track.kind !== "instrument") continue;
    const gain = ctx.createGain();
    const instrument = createInstrument(track.instrumentType, ctx, track.params);
    instruments.push(instrument);
    disposables.push(instrument, ...connectChain(ctx, instrument.output, track.effects, gain));
    gain.connect(parentInput(track.parentId));
    gain.gain.value = mutedTracks.has(track.id) ? 0 : track.volume;

    const events = flattenTrackNotes(track, loopStart, project.length);
    scheduleFns.push(() => {
      for (const { note, atBeat } of events) {
        // Groove nudges the onset + scales velocity at schedule time (the notes are untouched),
        // matching Scheduler.tick. A no-op when the project has no groove (amount 0 / Straight).
        const shift = grooveAt(groove, atBeat, grooveAmount);
        const whenSec = beatsToSeconds(atBeat - loopStart + shift.offsetBeats, bpm);
        const velocity = clamp(note.velocity * shift.velocityScale, 0, 1);
        instrument.playNote(note.pitch, beatsToSeconds(note.length, bpm), velocity, Math.max(0, whenSec));
      }
    });
  }

  // Wait for async assets (sampler/drumkit buffers) to decode before rendering - offline render
  // runs to completion immediately, so an undecoded sampler would render silent (Instrument.ready).
  await Promise.all(instruments.map((instrument) => instrument.ready?.()));

  // Schedule all notes inside one suspend(0): a worklet note is a port message, and a message
  // posted before startRendering() races the offline render and loses. Pausing at t=0 lets the
  // messages queue before the first block; the processors dispatch each note at its own `when`.
  void ctx.suspend(0).then(() => {
    for (const run of scheduleFns) run();
    void ctx.resume();
  });

  const buffer = await ctx.startRendering();
  // Instruments/effects subscribe to their ParamStore (bindParams); unsubscribe so a discarded
  // render never keeps reacting to the live project's params.
  for (const disposable of disposables) disposable.dispose();
  return buffer;
}

/**
 * Render the project offline and measure its master output - the agent's "ears" as one call.
 * This is what the `analyze_mix` tool runs: it hears the exact audio the user would, so the
 * agent can check its edits (clipping / level / loudness) instead of reasoning blind.
 */
export async function analyzeProjectMix(project: ProjectStore): Promise<MixSummary> {
  return summarizeMix(analyzeMix(await renderProjectOffline(project)));
}

/** Create + connect an effect chain: input -> fx1 -> ... -> output (skipping bypassed). */
function connectChain(ctx: BaseAudioContext, input: AudioNode, chain: EffectInstance[], output: AudioNode): Effect[] {
  const created: Effect[] = [];
  let cursor: AudioNode = input;
  for (const instance of chain) {
    if (instance.bypassed) continue;
    const effect = createEffect(instance.type, ctx, instance.params);
    cursor.connect(effect.input);
    cursor = effect.output;
    created.push(effect);
  }
  cursor.connect(output);
  return created;
}

/** Flatten a track's arrangement into absolute-beat note onsets within [loopStart, length). */
function flattenTrackNotes(
  track: InstrumentTrack,
  loopStart: number,
  length: number,
): { note: NoteEvent; atBeat: number }[] {
  const onsets: { note: NoteEvent; atBeat: number }[] = [];
  for (const placement of track.placements) {
    const clip = track.clips.find((entry) => entry.id === placement.clipId);
    if (!clip) continue;
    const { notes, lengthBeats } = clip.store.getClip();
    for (const note of tileClipNotes(notes, lengthBeats, placement.offset, placement.length)) {
      const atBeat = placement.startBeat + note.start;
      if (atBeat >= loopStart && atBeat < length) onsets.push({ note, atBeat });
    }
  }
  return onsets;
}

/** Peak absolute sample across all channels. 0 means the buffer is silent. */
export function peakAmplitude(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      const magnitude = Math.abs(samples[index]);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

/**
 * Render a single wavetable (worklet) note under an OfflineAudioContext, reusing the real
 * instrument factory + worklet loader. Returns the rendered buffer for the caller to check.
 */
export async function renderWorkletSmokeTest(sampleRate = 44100): Promise<AudioBuffer> {
  const durationSec = 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);

  // Worklet modules are keyed per-context (BaseAudioContext WeakMap), so a fresh offline
  // context re-adds them cleanly. Must complete BEFORE constructing any AudioWorkletNode.
  await loadWorklets(ctx);

  const store = new ParamStore(instrumentSchema("wavetable"));
  const instrument = createInstrument("wavetable", ctx, store);
  instrument.output.connect(ctx.destination);

  // Worklet note commands are port messages. A message posted before startRendering() races
  // the offline render and loses - the render can finish before the cross-thread message is
  // delivered, so the processor never sees the note (renders silence). Suspend the render at
  // t=0, post the note while paused so it is queued, then resume: the message is delivered
  // before the first block renders. C4 (MIDI 60), 0.8s, near-full velocity, at the top.
  void ctx.suspend(0).then(() => {
    instrument.playNote(60, 0.8, 0.9, 0);
    void ctx.resume();
  });

  return ctx.startRendering();
}

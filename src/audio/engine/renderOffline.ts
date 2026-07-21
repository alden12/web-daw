/**
 * Offline render (AGENT-4.1, "agent ears") - foundation spike.
 *
 * The goal of the epic is to render the project to an AudioBuffer under an
 * `OfflineAudioContext`, reusing the EXACT DSP the user hears (the same instrument/effect
 * factories + worklets), so the agent can analyze the mix (LUFS / spectral / clipping)
 * without a second engine to keep in sync.
 *
 * This module currently holds the de-risking spike: the single biggest unknown is whether
 * our custom AudioWorklet instruments (wavetable, nimbus) actually produce sound under an
 * `OfflineAudioContext`. `renderWorkletSmokeTest` proves it end to end - load the worklet
 * modules on a fresh offline context, build a real worklet instrument through the normal
 * factory, play a note, render to completion. If the returned buffer is non-silent, the
 * factory + worklet reuse thesis holds and the full `renderProjectOffline` (groups, samples,
 * effect tails, an offline transport clock for MIDI devices) is mechanical from here.
 *
 * The instrument/effect factories take a `BaseAudioContext`, so an `OfflineAudioContext` is
 * passed directly (no cast) - both the live `AudioContext` and an offline one satisfy it.
 */
import { createInstrument } from "../instruments/registry";
import { instrumentSchema } from "../instruments/catalog";
import { ParamStore } from "../params/store";
import { loadWorklets } from "../worklets";

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

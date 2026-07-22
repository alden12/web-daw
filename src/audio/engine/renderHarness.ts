/**
 * Dev/test-only e2e harness for the offline renderer (AGENT-4.1, "agent ears").
 *
 * The offline-render paths (worklet instruments, sampler pre-decode, audio tracks, MIDI devices)
 * can only be proven in a real browser - jsdom (the vitest env) has no AudioWorklet - so their
 * coverage is the Playwright suite in `e2e/offline-render.e2e.ts`. Playwright reaches into the app
 * through `page.evaluate`, which runs in the browser's global scope and can only see what is on
 * `window`. This module bridges that gap: it builds minimal projects, renders them, and exposes the
 * results as `window.__daw*` hooks the e2e calls.
 *
 * `installRenderHarness` is invoked from `main.tsx` behind an `import.meta.env` guard, so the whole
 * module is dead-code-eliminated from production builds and never ships.
 */
import { renderWorkletSmokeTest, renderProjectOffline, analyzeProjectMix, peakAmplitude } from "./renderOffline";
import { ProjectStore } from "../project/projectStore";
import { encodeWav } from "../recording/wav";
import { putAudio } from "../audioStore";

interface RenderHarness {
  __dawRenderWorkletSmoke?: () => Promise<number>;
  __dawRenderProjectSmoke?: () => Promise<number>;
  __dawRenderSamplerSmoke?: () => Promise<number>;
  __dawRenderAudioTrackSmoke?: () => Promise<number>;
  __dawRenderMidiDeviceSmoke?: () => Promise<number>;
  __dawAnalyzeMix?: () => Promise<unknown>;
}

// Build a tiny project (the seeded default instrument track + a wavetable/worklet track), put a
// note on each - exercises the whole project-consuming render path.
const buildSmokeProject = (): ProjectStore => {
  const project = new ProjectStore();
  project.addTrack("wavetable");
  for (const track of project.getTracks()) {
    if (track.kind === "instrument") track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
  }
  return project;
};

// A sampler track (default sample: builtin:kick) - proves samples are decoded (Instrument.ready)
// before render, so they are not silent.
const buildSamplerProject = (): ProjectStore => {
  const project = new ProjectStore(false);
  const track = project.addTrack("sampler");
  if (track.kind === "instrument") track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
  return project;
};

// An audio track backed by a synthetic recorded take (a 220 Hz sine stored via putAudio) - proves
// audio-clip buffers are decoded + scheduled offline, not just instrument tracks.
const buildAudioTrackProject = async (): Promise<ProjectStore> => {
  const sampleRate = 44100;
  const durationSec = 0.5;
  const samples = new Float32Array(Math.floor(sampleRate * durationSec));
  for (let i = 0; i < samples.length; i += 1) samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  const fileId = await putAudio(encodeWav(samples, sampleRate));
  const project = new ProjectStore(false);
  project.addAudioTrack({ fileId, name: "Take", durationSec, startBeat: 0 });
  return project;
};

// An instrument track with a MIDI device (octavator) + a note - proves notes route through the
// device chain (via the offline transport clock) into the instrument, not silence.
const buildMidiDeviceProject = (): ProjectStore => {
  const project = new ProjectStore();
  const track = project.getTracks().find((entry) => entry.kind === "instrument");
  if (track?.kind === "instrument") {
    project.addMidiDevice(track.id, "octavator");
    track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
  }
  return project;
};

/** Install the offline-render e2e hooks onto `window`. Called from main.tsx in dev/test only. */
export function installRenderHarness(): void {
  const harness = window as unknown as RenderHarness;
  harness.__dawRenderWorkletSmoke = async () => peakAmplitude(await renderWorkletSmokeTest());
  harness.__dawRenderProjectSmoke = async () => peakAmplitude(await renderProjectOffline(buildSmokeProject()));
  harness.__dawRenderSamplerSmoke = async () => peakAmplitude(await renderProjectOffline(buildSamplerProject()));
  harness.__dawRenderAudioTrackSmoke = async () =>
    peakAmplitude(await renderProjectOffline(await buildAudioTrackProject()));
  harness.__dawRenderMidiDeviceSmoke = async () => peakAmplitude(await renderProjectOffline(buildMidiDeviceProject()));
  // The full "agent ears" chain: render offline -> analyze -> model-friendly report.
  harness.__dawAnalyzeMix = async () => analyzeProjectMix(buildSmokeProject());
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Dev/test-only harness hook: exposes the offline-render spike so an e2e (real Chromium,
// where AudioWorklet exists - unlike jsdom) can prove worklets render under an
// OfflineAudioContext. Guarded so it never ships in a production build. See AGENT-4.1.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  void import("./audio/engine/renderOffline").then(
    ({ renderWorkletSmokeTest, renderProjectOffline, analyzeProjectMix, peakAmplitude }) => {
      const harness = window as unknown as {
        __dawRenderWorkletSmoke?: () => Promise<number>;
        __dawRenderProjectSmoke?: () => Promise<number>;
        __dawRenderSamplerSmoke?: () => Promise<number>;
        __dawRenderAudioTrackSmoke?: () => Promise<number>;
        __dawAnalyzeMix?: () => Promise<unknown>;
      };
      // Build a tiny project (the seeded default instrument track + a wavetable/worklet track), put
      // a note on each - exercises the whole project-consuming render path.
      const buildSmokeProject = async () => {
        const { ProjectStore } = await import("./audio/project/projectStore");
        const project = new ProjectStore();
        project.addTrack("wavetable");
        for (const track of project.getTracks()) {
          if (track.kind === "instrument")
            track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
        }
        return project;
      };
      harness.__dawRenderWorkletSmoke = async () => peakAmplitude(await renderWorkletSmokeTest());
      harness.__dawRenderProjectSmoke = async () =>
        peakAmplitude(await renderProjectOffline(await buildSmokeProject()));
      // A sampler track (default sample: builtin:kick) - proves samples are decoded (Instrument.ready)
      // before render, so they are not silent.
      harness.__dawRenderSamplerSmoke = async () => {
        const { ProjectStore } = await import("./audio/project/projectStore");
        const project = new ProjectStore(false);
        const track = project.addTrack("sampler");
        if (track.kind === "instrument")
          track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
        return peakAmplitude(await renderProjectOffline(project));
      };
      // An audio track backed by a synthetic recorded take (a 220 Hz sine stored via putAudio) -
      // proves audio-clip buffers are decoded + scheduled offline, not just instrument tracks.
      harness.__dawRenderAudioTrackSmoke = async () => {
        const { ProjectStore } = await import("./audio/project/projectStore");
        const { encodeWav } = await import("./audio/recording/wav");
        const { putAudio } = await import("./audio/audioStore");
        const sampleRate = 44100;
        const durationSec = 0.5;
        const samples = new Float32Array(Math.floor(sampleRate * durationSec));
        for (let i = 0; i < samples.length; i += 1) samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
        const fileId = await putAudio(encodeWav(samples, sampleRate));
        const project = new ProjectStore(false);
        project.addAudioTrack({ fileId, name: "Take", durationSec, startBeat: 0 });
        return peakAmplitude(await renderProjectOffline(project));
      };
      // The full "agent ears" chain: render offline -> analyze -> model-friendly report.
      harness.__dawAnalyzeMix = async () => analyzeProjectMix(await buildSmokeProject());
    },
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

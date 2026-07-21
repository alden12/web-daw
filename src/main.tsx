import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Dev/test-only harness hook: exposes the offline-render spike so an e2e (real Chromium,
// where AudioWorklet exists - unlike jsdom) can prove worklets render under an
// OfflineAudioContext. Guarded so it never ships in a production build. See AGENT-4.1.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  void import("./audio/engine/renderOffline").then(
    ({ renderWorkletSmokeTest, renderProjectOffline, peakAmplitude }) => {
      const harness = window as unknown as {
        __dawRenderWorkletSmoke?: () => Promise<number>;
        __dawRenderProjectSmoke?: () => Promise<number>;
      };
      harness.__dawRenderWorkletSmoke = async () => peakAmplitude(await renderWorkletSmokeTest());
      // Build a tiny project (the seeded default instrument track + a wavetable/worklet track), put
      // a note on each, and render it - exercises the whole project-consuming render path.
      harness.__dawRenderProjectSmoke = async () => {
        const { ProjectStore } = await import("./audio/project/projectStore");
        const project = new ProjectStore();
        project.addTrack("wavetable");
        for (const track of project.getTracks()) {
          if (track.kind === "instrument")
            track.clips[0]?.store.addNote({ pitch: 60, start: 0, length: 1, velocity: 0.9 });
        }
        return peakAmplitude(await renderProjectOffline(project));
      };
    },
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Dev/test-only harness hook: exposes the offline-render spike so an e2e (real Chromium,
// where AudioWorklet exists - unlike jsdom) can prove worklets render under an
// OfflineAudioContext. Guarded so it never ships in a production build. See AGENT-4.1.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  void import("./audio/engine/renderOffline").then(({ renderWorkletSmokeTest, peakAmplitude }) => {
    (window as unknown as { __dawRenderWorkletSmoke?: () => Promise<number> }).__dawRenderWorkletSmoke = async () =>
      peakAmplitude(await renderWorkletSmokeTest());
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

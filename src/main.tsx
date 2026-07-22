import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Dev/test-only: install the offline-render e2e harness (the window.__daw* hooks the Playwright
// suite calls). Guarded by import.meta.env so the whole module is dead-code-eliminated from
// production builds and never ships. See ./audio/engine/renderHarness.ts and AGENT-4.1.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  void import("./audio/engine/renderHarness").then(({ installRenderHarness }) => installRenderHarness());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

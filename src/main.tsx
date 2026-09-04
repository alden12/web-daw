import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Google Sans Flex (UI) and Google Sans Code (values), both self-hosted so there is no
// font-CDN request on load. The weight-axis builds rather than the full variable fonts:
// the UI varies weight and nothing else, so the optical-size/grade/width/slant files would
// ship and never be called for. `unicode-range` in these sheets means only the latin
// subset is actually fetched.
import "@fontsource-variable/google-sans-flex/wght.css";
import "@fontsource-variable/google-sans-code/wght.css";
import "./index.css";
import { applyStoredTheme } from "./ui/theme";
import App from "./App.tsx";

// Dev/test-only: install the offline-render e2e harness (the window.__daw* hooks the Playwright
// suite calls). Guarded by import.meta.env so the whole module is dead-code-eliminated from
// production builds and never ships. See ./audio/engine/renderHarness.ts and AGENT-4.1.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  void import("./audio/engine/renderHarness").then(({ installRenderHarness }) => installRenderHarness());
}

// Before the first render, so nobody on a non-default theme sees a frame of the wrong one.
applyStoredTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

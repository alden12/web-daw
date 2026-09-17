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
import { registerServiceWorker } from "./pwa/serviceWorkerUpdate";
import { applyStoredTheme } from "./ui/theme";
import App from "./App.tsx";

// Dev/test-only: install the offline-render e2e harness (the window.__daw* hooks the Playwright
// suite calls). Guarded by import.meta.env so the whole module is dead-code-eliminated from
// production builds and never ships. See ./audio/engine/renderHarness.ts and AGENT-4.1.
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  void import("./audio/engine/renderHarness").then(({ installRenderHarness }) => installRenderHarness());
  // Safe-area insets, on the console rather than behind an import: the thing you want to try
  // them on is a phone, and a phone has no editor to add an import statement in. See
  // `ui/shell/safeAreaSimulation.ts` for what to pass and why it exists (MOBILE-8).
  void import("./ui/shell/safeAreaSimulation").then(({ simulateInsets, applySimulatedInsets }) => {
    (window as unknown as { simulateInsets: typeof simulateInsets }).simulateInsets = simulateInsets;
    applySimulatedInsets();
  });
}

/**
 * Install the service worker (MOBILE-3), so the app has its own files before it is asked for
 * them and starts with no network at all.
 *
 * The plugin is on `registerType: "prompt"`, so a new worker installs and then waits rather than
 * reloading the page under someone mid-take. `serviceWorkerUpdate` surfaces the waiting one as a
 * banner with a Reload button, so taking it is a choice rather than a close-and-reopen dance.
 *
 * Eager, before React mounts: a worker that only installs once a component has rendered is a
 * worker that was not there for the render that needed it. In dev and in the e2e run it is a
 * no-op, since the worker is only generated for a real build.
 */
registerServiceWorker();

// Before the first render, so nobody on a non-default theme sees a frame of the wrong one.
applyStoredTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

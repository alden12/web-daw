/**
 * The dev- and test-only extras, behind one call so `main.tsx` carries one guard instead of three.
 *
 * None of it ships. The caller's `import.meta.env.DEV` check is statically false in a production
 * build, so the call goes and this module tree-shakes out behind it (checked: the built bundle
 * contains none of the bench's strings).
 */
import { renderRebuildBench, wantsRebuildBench } from "./ui/rebuildBenchPage";

/**
 * Install them, and say whether one has **taken over the page** - which is the caller's cue not to
 * mount the app at all.
 *
 * The page-taking check is synchronous while the rest are dynamic imports, and that asymmetry is
 * deliberate: the bench replaces the document body, so deciding it a tick later would mount the
 * app, boot an audio engine, and then wipe both off the screen.
 */
export function installDevTools(): boolean {
  // `?bench=rebuild` measures replay cost and renders it INSTEAD of the app (DAW-34 stage F). A page
  // rather than a console hook because the device that needs measuring is a phone, and a phone has
  // neither an editor nor an easy console - so the number has to arrive on the screen.
  if (wantsRebuildBench()) {
    void renderRebuildBench();
    return true;
  }

  // The offline-render e2e harness: the `window.__daw*` hooks the Playwright suite calls. See
  // `audio/engine/renderHarness.ts` and AGENT-4.1.
  void import("./audio/engine/renderHarness").then(({ installRenderHarness }) => installRenderHarness());

  // Safe-area insets, on the console rather than behind an import: the thing you want to try them on
  // is a phone, and a phone has no editor to add an import statement in. See
  // `ui/shell/safeAreaSimulation.ts` for what to pass and why it exists (MOBILE-8).
  void import("./ui/shell/safeAreaSimulation").then(({ simulateInsets, applySimulatedInsets }) => {
    (window as unknown as { simulateInsets: typeof simulateInsets }).simulateInsets = simulateInsets;
    applySimulatedInsets();
  });

  return false;
}

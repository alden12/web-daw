import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The viewer's Vite root is this folder (set by `vite tools/roadmap`), but it imports docs/DESIGN.md and
// scripts/roadmapParse.ts from the repo root via `?raw`/relative paths, so widen the fs allow-list to the
// repo root. This is a dev-only tool (not part of the app's production build), so it keeps its own config.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    fs: { allow: [repoRoot] },
  },
});

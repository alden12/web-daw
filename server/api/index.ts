/**
 * Sync API entry point (`yarn api`). Applies pending migrations, then serves the Hono
 * app over Node. Separate process from the MCP server (../index.ts): different job,
 * different port. Config via .env (DATABASE_URL, API_PORT, SUPABASE_JWKS_URL/ISSUER for auth).
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Server } from "node:http";
import { createApp } from "./app";
import { attachWsServer } from "./wsServer";
import { resolveAuthConfig } from "./principal";
import { getDb } from "../db/client";
import { applyMigrations } from "../db/migrate";
import { findStaleProjects } from "../db/store";
import { PROJECT_SCHEMA } from "../../src/audio/project/documentMigration";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

await applyMigrations(url);

// Report document-schema drift on startup. DB (drizzle-kit) migrations version table shape only;
// the project.json blobs are opaque to them, so a stored document below PROJECT_SCHEMA would drift
// silently. This surfaces it (upcasting itself stays lazy-on-load in documentMigration.ts).
const staleProjects = await findStaleProjects(getDb(), PROJECT_SCHEMA);
if (staleProjects.length > 0) {
  const summary = staleProjects.map((project) => `${project.id} (v${project.projectSchema})`).join(", ");
  console.warn(
    `[web-daw] ${staleProjects.length} project(s) below document schema v${PROJECT_SCHEMA}: ${summary}. ` +
      `They upcast lazily on next load.`,
  );
}

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 5170;
const corsOrigin = process.env.DAW_CORS_ORIGIN?.split(",").map((origin) => origin.trim());
// Real auth (Supabase): both SUPABASE_JWKS_URL and SUPABASE_JWT_ISSUER gate requests/sockets by verifying
// a JWT against the provider's JWKS (the principal is the token's user). Absent config fails closed in
// production and runs the open dev-stub only in local dev - see resolveAuthConfig.
const auth = resolveAuthConfig(process.env);
if (auth) console.log(`[web-daw] auth: verifying JWTs against ${auth.issuer}`);
// Verbose console logging (HTTP requests + WS traffic) in dev, quiet in production.
const verbose = process.env.NODE_ENV !== "production";
const app = createApp(getDb(), { auth, corsOrigin, logRequests: verbose });

// Single-origin deploy: this same server serves the built client (dist/) alongside the API and /ws, so
// there is one URL, no CORS, and same-origin wss. Registered AFTER the API routes, so `/projects/*` (and
// its auth gate) win first. The first handler serves any real file in dist/ by path - hashed /assets/*,
// but also root files like /favicon.svg and /icons.svg and / itself (index.html); serveStatic calls
// next() when no file matches, so the second handler is the SPA fallback, serving index.html for
// client-side routes. In dev the client is served by Vite instead, so dist/ may be absent - serveStatic
// simply falls through then, which is fine (nobody hits the API server's root in dev).
app.get("*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

// The realtime multiplayer socket shares the HTTP server/port (path /ws), so it is one origin.
const server = serve({ fetch: app.fetch, port }) as Server;
attachWsServer(server, { db: getDb(), auth, log: verbose });
console.log(`[web-daw] sync API listening on http://localhost:${port} (+ ws on /ws)`);

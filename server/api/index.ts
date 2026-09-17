/**
 * Sync API entry point (`yarn api`). Applies pending migrations, then serves the Hono
 * app over Node. Separate process from the MCP server (../index.ts): different job,
 * different port. Config via .env (DATABASE_URL, API_PORT, DAW_API_TOKEN).
 */
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createApp } from "./app";
import { attachWsServer } from "./wsServer";
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
const token = process.env.DAW_API_TOKEN;
// Real auth (Supabase): when both are set, requests/sockets are gated by verifying a JWT against the
// provider's JWKS and the principal is the token's user. When unset, the API runs in dev-stub mode
// (the shared DAW_API_TOKEN gate + a single "local" owner) - unchanged local dev.
const jwksUrl = process.env.SUPABASE_JWKS_URL;
const issuer = process.env.SUPABASE_JWT_ISSUER;
const auth = jwksUrl && issuer ? { jwksUrl, issuer } : undefined;
if (auth) console.log(`[web-daw] auth: verifying JWTs against ${auth.issuer}`);
// Verbose console logging (HTTP requests + WS traffic) in dev, quiet in production.
const verbose = process.env.NODE_ENV !== "production";
const app = createApp(getDb(), { auth, token, corsOrigin, logRequests: verbose });

// The realtime multiplayer socket shares the HTTP server/port (path /ws), so it is one origin.
const server = serve({ fetch: app.fetch, port }) as Server;
attachWsServer(server, { db: getDb(), auth, token, log: verbose });
console.log(`[web-daw] sync API listening on http://localhost:${port} (+ ws on /ws)`);

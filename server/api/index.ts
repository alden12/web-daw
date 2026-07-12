/**
 * Sync API entry point (`yarn api`). Applies pending migrations, then serves the Hono
 * app over Node. Separate process from the MCP server (../index.ts): different job,
 * different port. Config via .env (DATABASE_URL, API_PORT, DAW_API_TOKEN).
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { getDb } from "../db/client";
import { applyMigrations } from "../db/migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

await applyMigrations(url);

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 5170;
const corsOrigin = process.env.DAW_CORS_ORIGIN?.split(",").map((origin) => origin.trim());
const app = createApp(getDb(), { token: process.env.DAW_API_TOKEN, corsOrigin });

serve({ fetch: app.fetch, port });
console.log(`[web-daw] sync API listening on http://localhost:${port}`);

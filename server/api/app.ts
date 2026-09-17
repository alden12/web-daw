/**
 * The sync API: a thin, owner-scoped bundle-file store over Postgres. It mirrors the
 * client's `BundleStore`/`ProjectStorage` seam (src/audio/bundleStore.ts) as HTTP:
 *   GET    /projects                    -> { ids }         (ProjectStorage.listProjectIds)
 *   DELETE /projects/:id                -> 204             (soft delete; recoverable)
 *   GET    /projects/:id/files/<path>   -> bytes | 404     (BundleStore.readText/readBlob)
 *   HEAD   /projects/:id/files/<path>   -> 200 | 404       (BundleStore.exists)
 *   PUT    /projects/:id/files/<path>   -> 204 | 409 | 403 (BundleStore.writeText/writeBlob)
 *
 * `createApp(db)` takes the database so tests can pass a pglite-backed handle
 * (test/syncApi.test.ts) while production passes postgres.js. The exported `AppType` is what
 * the client's Hono RPC (`hc`) client is typed against - it types the JSON control routes
 * (/projects); the file routes move raw bytes, so the client hits them with plain fetch.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Db } from "../db/types";
import { listProjectIds, readFile, fileExists, writeFile, softDeleteProject, type FilePayload } from "../db/store";
import { validateBundleFile } from "./bundleSchemas";

type Env = { Variables: { ownerId: string } };

/** Project ids are minted by the client (`p-xxxxxxxx` / "default"); keep them tame. */
const projectId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);
/** Bundle-relative path: the known shape (segments + optional extension), never "..". */
const filePath = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine((value) => !value.split("/").includes(".."), "no traversal");

const idSchema = z.object({ id: projectId });
const fileParamSchema = z.object({ id: projectId, path: filePath });

export interface AppOptions {
  /** Shared bearer token. When empty/unset, the API runs open (local dev). The entry
   *  point passes DAW_API_TOKEN; kept off `process` here so the exported AppType stays
   *  importable under the DOM-only client tsconfig. */
  token?: string;
  /** The principal every request maps to (stubbed single owner until real auth). */
  ownerId?: string;
  /** Allowed CORS origin(s). Default "*" (the app runs on a different port in dev, and the
   *  bearer token, not a cookie, is the gate). Narrow this to the app origin on deploy. */
  corsOrigin?: string | string[];
}

export function createApp(db: Db, options: AppOptions = {}) {
  const token = options.token ?? "";
  const ownerId = options.ownerId ?? "local";
  const corsOrigin = options.corsOrigin ?? "*";

  const app = new Hono<Env>()
    // CORS first, so even a 401 carries the headers the browser needs to read the response.
    .use("*", cors({ origin: corsOrigin, allowMethods: ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"] }))
    .use("*", async (c, next) => {
      if (token && c.req.header("Authorization") !== `Bearer ${token}`) {
        return c.json({ error: "unauthorized" }, 401);
      }
      c.set("ownerId", ownerId);
      await next();
    })
    .get("/projects", async (c) => {
      const ids = await listProjectIds(db, c.get("ownerId"));
      return c.json({ ids });
    })
    .delete("/projects/:id", zValidator("param", idSchema), async (c) => {
      await softDeleteProject(db, c.get("ownerId"), c.req.valid("param").id);
      return c.body(null, 204);
    })
    .get("/projects/:id/files/:path{.+}", zValidator("param", fileParamSchema), async (c) => {
      const { id, path } = c.req.valid("param");
      const payload = await readFile(db, c.get("ownerId"), id, path);
      if (!payload) return c.body(null, 404);
      if (payload.kind === "json") {
        return new Response(JSON.stringify(payload.json), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // A raw Response takes a Uint8Array body directly (Hono's own body type is narrower).
      // Re-wrap so the element type is Uint8Array<ArrayBuffer> - DOM's BodyInit (this file is
      // type-checked under the client tsconfig too, via the exported AppType) requires it.
      return new Response(new Uint8Array(payload.bytes), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    })
    .on("HEAD", "/projects/:id/files/:path{.+}", zValidator("param", fileParamSchema), async (c) => {
      const { id, path } = c.req.valid("param");
      const present = await fileExists(db, c.get("ownerId"), id, path);
      return c.body(null, present ? 200 : 404);
    })
    .put("/projects/:id/files/:path{.+}", zValidator("param", fileParamSchema), async (c) => {
      const { id, path } = c.req.valid("param");
      // Binary bundle entries (samples) come as octet-stream; everything else is a JSON text
      // entry, parsed here so only valid JSON is ever stored (and stored as queryable jsonb).
      const contentType = c.req.header("Content-Type") ?? "";
      let payload: FilePayload;
      if (contentType.includes("application/octet-stream")) {
        payload = { kind: "binary", bytes: new Uint8Array(await c.req.arrayBuffer()) };
      } else {
        let json: unknown;
        try {
          json = JSON.parse(await c.req.text());
        } catch {
          return c.json({ error: "invalid-json" }, 400);
        }
        // Don't trust the client: reject wrong-shaped JSON before it reaches the DB.
        const shape = validateBundleFile(path, json);
        if (!shape.ok) return c.json({ error: "invalid-shape", detail: shape.error }, 422);
        payload = { kind: "json", json };
      }
      const result = await writeFile(db, c.get("ownerId"), id, path, payload);
      if (result.ok) return c.body(null, 204);
      return c.json({ error: result.reason }, result.reason === "conflict" ? 409 : 403);
    });

  return app;
}

export type AppType = ReturnType<typeof createApp>;

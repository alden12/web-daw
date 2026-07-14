/**
 * The sync API: a thin bundle-file store over Postgres, access gated as "owner or member". It mirrors the
 * client's `BundleStore`/`ProjectStorage` seam (src/audio/bundleStore.ts) as HTTP:
 *   GET    /projects                    -> { projects }    (ProjectStorage.listProjects; owned + shared)
 *   DELETE /projects/:id                -> 204             (soft delete; recoverable; owner-only)
 *   GET    /projects/:id/files/<path>   -> bytes | 404     (BundleStore.readText/readBlob)
 *   HEAD   /projects/:id/files/<path>   -> 200 | 404       (BundleStore.exists)
 *   PUT    /projects/:id/files/<path>   -> 204 | 409 | 403 (BundleStore.writeText/writeBlob)
 *   GET/POST/DELETE /projects/:id/members  -> sharing (owner-only): list / invite-by-email / revoke
 *
 * The route surface (paths + param schemas) is not defined here - it is sourced from the
 * shared contract (src/contract/http.ts), so the server mounts exactly what the client
 * calls, with no drift. This file wires handlers to those routes and owns the logic
 * (content-type dispatch, the write-once/soft-delete/validation behaviour).
 *
 * `createApp(db)` takes the database so tests can pass a pglite-backed handle
 * (test/syncApi.test.ts) while production passes postgres.js.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import type { Db } from "../db/types";
import {
  listProjects,
  readFile,
  fileExists,
  writeFile,
  softDeleteProject,
  appendEdits,
  readEdits,
  listMembers,
  addMember,
  removeMember,
  getProjectOwner,
  type Accessor,
  type FilePayload,
} from "../db/store";
import { validateBundleFile } from "../../src/audio/project/schema";
import { routes, isBinaryPath } from "../../src/contract/http";
import { makeDevResolver, makeJwtResolver, type AuthConfig, type ResolvePrincipal } from "./principal";

type Env = { Variables: { ownerId: string; userEmail?: string } };

/** The request's identity for access checks: user id (owner match) + best-effort email (member match). */
const who = (c: Context<Env>): Accessor => ({ userId: c.get("ownerId"), email: c.get("userEmail") });

/** Read a bearer credential from an `Authorization: Bearer <token>` header (undefined if absent). */
const bearer = (header: string | undefined): string | undefined =>
  header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

/** Body-size caps (a memory/storage DoS guard on the buffered PUT body). Generous defaults:
 *  a large project.json vs a long audio sample. Overridable per deployment. */
const DEFAULT_MAX_JSON_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_SAMPLE_BYTES = 64 * 1024 * 1024;

export interface AppOptions {
  /** Real auth: verify a Supabase (or any OIDC) JWT against this JWKS/issuer. When set, the principal is
   *  the token's user; when unset, the app runs in dev-stub mode (the single `ownerId` below, open). */
  auth?: AuthConfig;
  /** Inject a pre-built principal resolver (tests use this to verify against a local key set). Takes
   *  precedence over `auth`/`ownerId`. */
  resolvePrincipal?: ResolvePrincipal;
  /** Dev-stub: the single principal every request maps to (local dev / tests; default "local"). */
  ownerId?: string;
  /** Allowed CORS origin(s). Default "*" (the app runs on a different port in dev, and the
   *  bearer token, not a cookie, is the gate). Narrow this to the app origin on deploy. */
  corsOrigin?: string | string[];
  /** Max bytes for a JSON document write (default 8 MB). */
  maxJsonBytes?: number;
  /** Max bytes for a binary sample write (default 64 MB). */
  maxSampleBytes?: number;
  /** Log each HTTP request (method, path, status, duration) to the console. On in dev, off in prod. */
  logRequests?: boolean;
}

export function createApp(db: Db, options: AppOptions = {}) {
  // Resolve identity through one seam: an injected resolver (tests) > real JWT verification (`auth`) >
  // the dev-stub principal. Handlers below are principal-agnostic - they read `c.get("ownerId")`.
  const resolvePrincipal =
    options.resolvePrincipal ??
    (options.auth ? makeJwtResolver(db, options.auth) : makeDevResolver(db, { devUserId: options.ownerId }));
  const corsOrigin = options.corsOrigin ?? "*";
  const maxJsonBytes = options.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES;
  const maxSampleBytes = options.maxSampleBytes ?? DEFAULT_MAX_SAMPLE_BYTES;

  // Cap the buffered PUT body, picking the limit by path (samples may be much larger than a
  // JSON document). Runs before the handler reads the body, so an oversized upload is refused
  // with 413 rather than buffered whole.
  const tooLarge = (c: Context) => c.json({ error: "too-large" }, 413);
  const jsonBodyLimit = bodyLimit({ maxSize: maxJsonBytes, onError: tooLarge });
  const sampleBodyLimit = bodyLimit({ maxSize: maxSampleBytes, onError: tooLarge });
  const limitBody: MiddlewareHandler<Env> = (c, next) =>
    (isBinaryPath(c.req.param("path") ?? "") ? sampleBodyLimit : jsonBodyLimit)(c, next);

  /** Gate a member-management route to the project's owner: 404 if it doesn't exist, 403 if the caller
   *  isn't its owner. Returns the error response to short-circuit with, or null when the caller is owner. */
  const requireOwner = async (c: Context<Env>, projectId: string): Promise<Response | null> => {
    const owner = await getProjectOwner(db, projectId);
    if (owner == null) return c.json({ error: "not-found" }, 404);
    if (owner !== c.get("ownerId")) return c.json({ error: "forbidden" }, 403);
    return null;
  };

  return (
    new Hono<Env>()
      // Request logging first (dev), so it times the whole request incl. later middleware.
      .use("*", async (c, next) => (options.logRequests ? logger()(c, next) : next()))
      // CORS next, so even a 401 carries the headers the browser needs to read the response.
      .use("*", cors({ origin: corsOrigin, allowMethods: ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"] }))
      .use("*", async (c, next) => {
        const principal = await resolvePrincipal(bearer(c.req.header("Authorization")));
        if (!principal) return c.json({ error: "unauthorized" }, 401);
        c.set("ownerId", principal.userId);
        c.set("userEmail", principal.email);
        await next();
      })
      .get(routes.listProjects.path, async (c) => {
        const projects = await listProjects(db, who(c));
        return c.json({ projects });
      })
      .delete(routes.deleteProject.path, zValidator("param", routes.deleteProject.params), async (c) => {
        // Owner-only: a member can't delete a shared project (softDeleteProject filters on owner).
        await softDeleteProject(db, c.get("ownerId"), c.req.valid("param").id);
        return c.body(null, 204);
      })
      .get(routes.getFile.path, zValidator("param", routes.getFile.params), async (c) => {
        const { id, path } = c.req.valid("param");
        const payload = await readFile(db, who(c), id, path);
        if (!payload) return c.body(null, 404);
        if (payload.kind === "json") {
          return new Response(JSON.stringify(payload.json), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // A raw Response takes a Uint8Array body directly (Hono's own body type is narrower);
        // re-wrap so the element type is Uint8Array<ArrayBuffer> for the global BodyInit.
        return new Response(new Uint8Array(payload.bytes), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        });
      })
      .on("HEAD", routes.headFile.path, zValidator("param", routes.headFile.params), async (c) => {
        const { id, path } = c.req.valid("param");
        const present = await fileExists(db, who(c), id, path);
        return c.body(null, present ? 200 : 404);
      })
      .put(routes.putFile.path, zValidator("param", routes.putFile.params), limitBody, async (c) => {
        const { id, path } = c.req.valid("param");
        // Storage kind is decided by PATH, not the client's Content-Type: samples are binary
        // bytes, everything else is a JSON document parsed + shape-validated here, so a JSON
        // path can't be smuggled in as opaque bytes to skip validation.
        let payload: FilePayload;
        if (isBinaryPath(path)) {
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
        const result = await writeFile(db, who(c), id, path, payload);
        if (result.ok) return c.body(null, 204);
        return c.json({ error: result.reason }, result.reason === "conflict" ? 409 : 403);
      })
      .post(
        routes.appendEdits.path,
        zValidator("param", routes.appendEdits.params),
        limitBody,
        zValidator("json", routes.appendEdits.body),
        async (c) => {
          const { id } = c.req.valid("param");
          const { entries } = c.req.valid("json");
          const result = await appendEdits(db, who(c), id, entries);
          if (!result.ok) return c.json({ error: result.reason }, 403);
          return c.json({ maxSeq: result.maxSeq });
        },
      )
      .get(
        routes.getEdits.path,
        zValidator("param", routes.getEdits.params),
        zValidator("query", routes.getEdits.query),
        async (c) => {
          const { id } = c.req.valid("param");
          const { since, limit } = c.req.valid("query");
          const entries = await readEdits(db, who(c), id, since ?? -1, limit);
          return c.json({ entries });
        },
      )
      // --- Sharing: member management is owner-only (only the project's owner may invite/revoke). ---
      .get(routes.listMembers.path, zValidator("param", routes.listMembers.params), async (c) => {
        const { id } = c.req.valid("param");
        const denied = await requireOwner(c, id);
        if (denied) return denied;
        return c.json({ members: await listMembers(db, id) });
      })
      .post(
        routes.addMember.path,
        zValidator("param", routes.addMember.params),
        zValidator("json", routes.addMember.body),
        async (c) => {
          const { id } = c.req.valid("param");
          const denied = await requireOwner(c, id);
          if (denied) return denied;
          const { email, role } = c.req.valid("json");
          await addMember(db, id, email, role ?? "editor", c.get("ownerId"));
          return c.json({ ok: true } as const);
        },
      )
      .delete(routes.removeMember.path, zValidator("param", routes.removeMember.params), async (c) => {
        const { id, email } = c.req.valid("param");
        const denied = await requireOwner(c, id);
        if (denied) return denied;
        await removeMember(db, id, email);
        return c.body(null, 204);
      })
  );
}

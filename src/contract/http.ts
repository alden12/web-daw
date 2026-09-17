/**
 * The HTTP surface of the API, as plain data. Each route descriptor names its method,
 * path (Hono syntax, so the server registers it directly), param schema, and - for the
 * JSON control routes - its response schema. Both sides import this: the server mounts
 * and validates from it (server/api/app.ts), and the client derives its typed calls from
 * it (src/contract/client.ts). One definition, no drift.
 *
 * The three file routes carry raw bytes (JSON validated by path, or an octet-stream
 * sample), which don't fit a single response schema, so they are flagged `body: "raw"`
 * and the client gives them explicit typed methods. The full status contract for each is
 * documented in server/api/app.ts (the handlers) and preserved by the round-trip tests.
 *
 * Pure zod, DOM/Node-free - the server imports this.
 */
import { z } from "zod";
import { projectId, filePath } from "./errors";

const fileParams = z.object({ id: projectId, path: filePath });

export const routes = {
  /** List the caller's (non-deleted) project ids. */
  listProjects: {
    method: "GET",
    path: "/projects",
    response: z.object({ ids: z.array(z.string()) }),
  },
  /** Soft-delete a project (recoverable; files retained). */
  deleteProject: {
    method: "DELETE",
    path: "/projects/:id",
    params: z.object({ id: projectId }),
  },
  /** Read a bundle file: 200 (json or octet-stream) | 404. */
  getFile: {
    method: "GET",
    path: "/projects/:id/files/:path{.+}",
    params: fileParams,
    body: "raw",
  },
  /** Existence check: 200 | 404, body-less. */
  headFile: {
    method: "HEAD",
    path: "/projects/:id/files/:path{.+}",
    params: fileParams,
  },
  /** Write a bundle file: 204 | 400 invalid-json | 422 invalid-shape | 409 conflict | 403 forbidden. */
  putFile: {
    method: "PUT",
    path: "/projects/:id/files/:path{.+}",
    params: fileParams,
    body: "raw",
  },
} as const;

export type Routes = typeof routes;

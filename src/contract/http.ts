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
import { editEntrySchema } from "../audio/project/schema";

const fileParams = z.object({ id: projectId, path: filePath });
const idParams = z.object({ id: projectId });

/** Bundle paths under this prefix hold raw bytes (audio samples); everything else is JSON. */
export const SAMPLES_PREFIX = "samples/";

/**
 * Whether a bundle path stores binary bytes (a sample) vs a validated JSON document. The
 * server decides by PATH, not by the client's Content-Type header, so a JSON document can
 * never be smuggled in as opaque bytes to skip shape validation.
 */
export const isBinaryPath = (path: string): boolean => path.startsWith(SAMPLES_PREFIX);

/** A member's role on a project. "owner" is implicit (the project's owner); stored members are "editor"
 *  today, with room for a read-only "viewer" later. */
export const projectRole = z.enum(["owner", "editor"]);

/** One project in the caller's library listing: id + name + modifiedAt (mirrors meta.json, so the client
 *  needn't read each bundle) + the caller's role (owner vs shared-with-me), for owner-only UI gating. */
export const projectListing = z.object({
  id: z.string(),
  name: z.string(),
  modifiedAt: z.string(),
  role: projectRole,
});

export const routes = {
  /** List the caller's accessible (owned + shared, non-deleted) projects. */
  listProjects: {
    method: "GET",
    path: "/projects",
    response: z.object({ projects: z.array(projectListing) }),
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
  /** Append authored edits to the project's log (append-only; a re-sent seq is idempotent). */
  appendEdits: {
    method: "POST",
    path: "/projects/:id/edits",
    params: idParams,
    body: z.object({ entries: z.array(editEntrySchema) }),
    response: z.object({ maxSeq: z.number() }),
  },
  /** Fetch the edit stream with `seq > since` (default: from the start), oldest first. `limit` caps
   *  the result to the most recent N (for a bounded feed window); omit it for the full tail. */
  getEdits: {
    method: "GET",
    path: "/projects/:id/edits",
    params: idParams,
    query: z.object({ since: z.coerce.number().optional(), limit: z.coerce.number().optional() }),
    response: z.object({ entries: z.array(editEntrySchema) }),
  },
  /** List a project's members (owner-only): 200 | 403 not-owner | 404 no-such-project. */
  listMembers: {
    method: "GET",
    path: "/projects/:id/members",
    params: idParams,
    response: z.object({ members: z.array(z.object({ email: z.string(), role: z.string() })) }),
  },
  /** Share a project with someone by email (owner-only). Idempotent (re-invite updates the role). */
  addMember: {
    method: "POST",
    path: "/projects/:id/members",
    params: idParams,
    body: z.object({ email: z.email(), role: z.enum(["editor"]).optional() }),
    response: z.object({ ok: z.literal(true) }),
  },
  /** Revoke a member's access by email (owner-only). The email rides the path (a single segment). */
  removeMember: {
    method: "DELETE",
    path: "/projects/:id/members/:email",
    params: z.object({ id: projectId, email: z.string() }),
  },
} as const;

export type Routes = typeof routes;

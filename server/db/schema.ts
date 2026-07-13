/**
 * The sync-service database schema (Drizzle, Postgres). Pure data - no DOM, no app
 * imports - so it compiles under tsconfig.server.json and feeds drizzle-kit.
 *
 * The server is a thin bundle-path store: it does not understand project semantics,
 * it stores `(projectId, path) -> content`. Two tables:
 *  - `projects`: the index + access control. Soft-deleted (never hard-removed), so an
 *    accidental delete is recoverable - the durability guarantee this whole slice is for.
 *  - `files`: one row per bundle entry (project.json, log.json, history/commits/<id>.json,
 *    samples/<hash>, ...). FK to `projects` with ON DELETE RESTRICT so files can never be
 *    orphaned; deletion is soft, on the project row. A file holds EITHER `json` (text bundle
 *    entries, stored as jsonb so they are valid-JSON-checked, readable, and queryable) OR
 *    `bytes` (binary, e.g. samples) - a CHECK enforces exactly one.
 */
import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  primaryKey,
  customType,
  jsonb,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Raw binary column (Postgres `bytea`); Drizzle has no built-in, so define it once.
 * Typed as `Uint8Array` both ways (no Node `Buffer`) so this module stays importable
 * under the DOM-only client tsconfig - the postgres.js + pglite drivers both accept a
 * Uint8Array for bytea and return one (Buffer is a Uint8Array subclass) at runtime.
 */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (value) => value,
});

/**
 * Our own user records, keyed by the identity provider's stable subject id (a Supabase auth uuid, or
 * "local" in dev-stub mode). We deliberately keep this table rather than reaching into Supabase's
 * internal tables, so all domain data references an id we own - swapping the auth provider later stays
 * a contained change. Rows are provisioned just-in-time on the first authenticated request.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  /** From the JWT `email` claim; nullable (a provider may omit it). */
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull().default("Untitled"),
    /** Version of the project-document format last written (drives lazy upcasting). */
    projectSchema: integer("project_schema").notNull().default(0),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete: set on delete, filtered from listings, never hard-removed. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("projects_owner_idx").on(table.ownerId)],
);

export const files = pgTable(
  "files",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    path: text("path").notNull(),
    /** Text bundle entries (all JSON in our format), stored as jsonb. Null for binary files. */
    json: jsonb("json"),
    /** Binary bundle entries (samples). Null for JSON files. */
    bytes: bytea("bytes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.path] }),
    // Exactly one payload column is set: a file is either JSON or binary, never both/neither.
    check("files_one_payload", sql`(${table.json} is null) != (${table.bytes} is null)`),
  ],
);

/**
 * The edit log: one row per authored edit, keyed `(projectId, seq)` with the client's monotonic
 * `seq`. This is the delta stream - autosave appends new entries instead of re-uploading the whole
 * `project.json`, and load reconstructs HEAD by replaying entries after the last keyframe. The
 * working log is MUTABLE per `seq` (append is an upsert): a coalescing edit - a knob drag - folds
 * into its entry in place without minting a new seq, so a re-send updates it. (This is the working
 * stream; the durable write-once history is the commit DAG.) FK to `projects` with ON DELETE
 * RESTRICT (deletion is soft). The command payload is jsonb (valid-JSON-checked, queryable).
 */
export const edits = pgTable(
  "edits",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    seq: integer("seq").notNull(),
    command: jsonb("command").notNull(),
    author: text("author").notNull(),
    /** Client edit timestamp (ms since epoch); well within a JS-number-safe bigint. */
    time: bigint("time", { mode: "number" }).notNull(),
    /** "edit" | "undo" | "redo"; absent = a normal edit. */
    kind: text("kind"),
    /** Optional display override for non-edit (undo/redo) entries. */
    label: text("label"),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.seq] })],
);

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type EditRow = typeof edits.$inferSelect;

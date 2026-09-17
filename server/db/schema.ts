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
import { pgTable, text, integer, timestamp, primaryKey, customType, jsonb, check } from "drizzle-orm/pg-core";
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

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull().default("Untitled"),
  /** Version of the project-document format last written (drives lazy upcasting). */
  projectSchema: integer("project_schema").notNull().default(0),
  modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft delete: set on delete, filtered from listings, never hard-removed. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

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

export type ProjectRow = typeof projects.$inferSelect;
export type FileRow = typeof files.$inferSelect;

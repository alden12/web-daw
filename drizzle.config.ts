/**
 * drizzle-kit config: `yarn db:generate` diffs server/db/schema.ts and writes
 * versioned SQL under drizzle/ (checked into git); `yarn db:migrate` applies it.
 * Forward-only - see the sync-service slice's migration strategy.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://webdaw:webdaw@localhost:5432/webdaw",
  },
});

/**
 * Test harness for the sync service: an in-process Postgres (pglite) with the schema
 * migrated in, wrapped in the real Hono app. Same schema + queries as production
 * (postgres.js); only the driver differs, so route/store behavior is exercised for real
 * without Docker. Used by the server-route tests and the client round-trip test.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../server/db/schema";
import { createApp, type AppOptions } from "../../server/api/app";
import type { Db } from "../../server/db/types";

export interface SyncEnv {
  db: Db;
  app: ReturnType<typeof createApp>;
}

export async function makeSyncEnv(options?: AppOptions): Promise<SyncEnv> {
  const client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder: "./drizzle" });
  const db = pgliteDb as unknown as Db;
  return { db, app: createApp(db, options) };
}

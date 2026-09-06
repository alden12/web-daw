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
import { allowEmail } from "../../server/db/access";

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

/**
 * Invite the addresses a route test mints tokens for (HOST-20).
 *
 * A valid token is no longer a principal on its own - the allowlist decides - but these suites are
 * exercising routes, not the gate. `principal.test.ts` owns that. Without this they would all fail
 * for the same uninteresting reason, and the real assertion would be buried.
 */
export async function invite(db: Db, ...emails: string[]): Promise<void> {
  for (const email of emails) await allowEmail(db, email);
}

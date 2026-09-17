/**
 * The production database handle: a postgres.js connection wrapped in Drizzle.
 * Tests build a pglite-backed Drizzle instead (same schema + queries, different
 * driver), so everything downstream is typed against the shared `Db` base type
 * rather than the postgres.js concrete type.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./types";

export type { Db } from "./types";

/** Build a Drizzle handle over a postgres.js connection to `url`. */
export function createDb(url: string): Db {
  return drizzle(postgres(url), { schema });
}

let singleton: Db | null = null;

/** The app-wide database, from `DATABASE_URL`. */
export function getDb(): Db {
  if (!singleton) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    singleton = createDb(url);
  }
  return singleton;
}

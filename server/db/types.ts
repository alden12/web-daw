/**
 * The `Db` type alone, split from client.ts so it carries no runtime deps. store.ts and
 * app.ts type against `Db` without importing the postgres.js driver (which lives in
 * client.ts), so the app + its tests stay driver-free - the tests run the app over pglite
 * and must not pull postgres.js into their graph. client.ts (the real connection) imports
 * this back.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** The narrowest Drizzle type both the postgres.js and pglite drivers satisfy. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

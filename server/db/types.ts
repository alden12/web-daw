/**
 * The `Db` type alone, split from client.ts so it carries no runtime deps. The client
 * imports the Hono `AppType` (which transitively reaches this) for its typed RPC client;
 * keeping postgres.js / process out of this module means that type import stays clean
 * under the DOM-only client tsconfig. client.ts (the real connection) imports this back.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** The narrowest Drizzle type both the postgres.js and pglite drivers satisfy. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

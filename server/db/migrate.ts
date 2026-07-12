/**
 * Apply pending migrations from ./drizzle. Used two ways: `yarn db:migrate` runs this
 * file directly, and the API server calls `applyMigrations` on boot so a fresh dev DB is
 * ready without a separate step. Forward-only - see the sync-service migration strategy.
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function applyMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  } finally {
    await sql.end();
  }
}

// Run standalone (`yarn db:migrate`) but not when imported by the server on boot.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await applyMigrations(url);
  console.log("[web-daw] migrations applied");
}

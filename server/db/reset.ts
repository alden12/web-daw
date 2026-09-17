/**
 * `yarn db:reset`: wipe and recreate the local Postgres, then reapply migrations. DESTRUCTIVE - it
 * drops the docker volume, so ALL local project data is lost. Guarded by an explicit "y" confirmation
 * so it can never run by accident (Drizzle Kit has no built-in reset like Prisma's `migrate reset`,
 * so we script it). Intended for local dev only.
 */
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { applyMigrations } from "./migrate";

const url = process.env.DATABASE_URL ?? "postgres://webdaw:webdaw@localhost:5432/webdaw";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  "This DROPS the local Postgres volume - ALL local project data is lost. Type 'y' to continue: ",
);
rl.close();
if (answer.trim().toLowerCase() !== "y") {
  console.log("Aborted - nothing changed.");
  process.exit(0);
}

const run = (command: string) => execSync(command, { stdio: "inherit" });
run("docker compose down -v");
run("docker compose up -d --wait");
await applyMigrations(url);
console.log("[web-daw] local database reset and migrated.");

/**
 * Manage the allowlist from a terminal (HOST-20): `yarn allow`, `yarn allow <email> [note]`,
 * `yarn allow --remove <email>`.
 *
 * **This exists because an empty table means nobody, including you.** That is the right default -
 * it fails closed on a fresh deploy - but it means the very first invitation cannot come from
 * inside the app, because nobody can get in to send it. So it comes from here.
 *
 * Runs against whatever `DATABASE_URL` points at, so it manages production by connecting to
 * production. Deliberately not an HTTP endpoint: an "invite someone" route is a thing to get wrong
 * exactly once, and this list changes about as often as a person joins.
 */
import { getDb } from "./client";
import { allowEmail, listAllowedEmails, revokeEmail } from "./access";

const [first, ...rest] = process.argv.slice(2);
const db = getDb();

if (!first) {
  const allowed = await listAllowedEmails(db);
  if (allowed.length === 0) {
    console.log("The allowlist is EMPTY, so nobody can sign in. Add yourself:\n  yarn allow you@example.com");
  } else {
    console.log(`${allowed.length} address(es) allowed:`);
    for (const { email, note } of allowed) console.log(`  ${email}${note ? `  (${note})` : ""}`);
  }
} else if (first === "--remove" || first === "-r") {
  const [email] = rest;
  if (!email) throw new Error("usage: yarn allow --remove <email>");
  await revokeEmail(db, email);
  console.log(`Revoked ${email}. Takes effect on their next request; nothing is cached.`);
} else {
  await allowEmail(db, first, rest.join(" ") || undefined);
  console.log(`Allowed ${first}. They can sign in from now on.`);
}

process.exit(0);

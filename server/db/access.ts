/**
 * Who may use this deployment (HOST-20).
 *
 * Distinct from user provisioning, and the distinction is the point: `ensureUser` records who has
 * been through the door, this decides whether it opens. **Google's OAuth "testing mode" test-user
 * list does not gate sign-in** - it restricts sensitive scopes - so Google and Supabase both vouch
 * for people nobody invited, and this is the only participant in the chain that knows the answer.
 *
 * **Deliberately uncached.** One indexed lookup per request, on a path that already does one for
 * `ensureUser`. The whole reason for a table rather than a secret is that access changes take
 * effect when they are made; a cache reintroduces exactly the "why is this person still getting in"
 * lag that a restart used to have. Revisit only with a measurement, not a hunch.
 */
import { eq } from "drizzle-orm";
import { allowedEmails } from "./schema";
import type { Db } from "./types";

/** Compared and stored lower-cased, so the primary key agrees with the lookup. */
const normalise = (email: string): string => email.trim().toLowerCase();

/** Whether this address may use the server. An empty table means nobody, which is the safe default. */
export async function isEmailAllowed(db: Db, email: string): Promise<boolean> {
  const found = await db
    .select({ email: allowedEmails.email })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, normalise(email)));
  return found.length > 0;
}

/** Invite an address. Idempotent, so re-adding someone is not an error anyone has to think about. */
export async function allowEmail(db: Db, email: string, note?: string): Promise<void> {
  await db
    .insert(allowedEmails)
    .values({ email: normalise(email), note: note ?? null })
    .onConflictDoNothing();
}

/** Revoke an address. Takes effect on that caller's next request, since nothing is cached. */
export async function revokeEmail(db: Db, email: string): Promise<void> {
  await db.delete(allowedEmails).where(eq(allowedEmails.email, normalise(email)));
}

/** Every invited address, oldest first. For the CLI, and for seeing what the list actually says. */
export async function listAllowedEmails(db: Db): Promise<{ email: string; note: string | null }[]> {
  return db.select({ email: allowedEmails.email, note: allowedEmails.note }).from(allowedEmails);
}

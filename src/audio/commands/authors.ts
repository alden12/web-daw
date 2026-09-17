/**
 * Who an edit belongs to (DAW-34).
 *
 * An author is a free string, so a collaborator's id flows through the edit stream, the `edits`
 * table, and a project's authorship stamps untouched. Two shapes have fixed meaning:
 *
 *   `you`            the default id for a user who has not set one (solo)
 *   `agent:<userId>` an AI agent's edit, made on behalf of the user who drove it
 *
 * **Why an agent edit names its driver.** An agent does not act for itself - somebody asked it to.
 * So the edit is theirs: their undo can take it back, and nobody else's can. It used to be stamped
 * with a bare voice, which made an agent edit belong to everyone in a shared session and to no one
 * in particular, so undoing it could take back the work another person's agent had just done.
 *
 * It is one string rather than an author plus a `drivenBy` field because a project's authorship
 * stamps are a `Record<objectKey, author>` - one string per object, with nowhere for a second field
 * to ride along. Putting the driver IN the author means every layer that already carries an author
 * carries the driver too, at no schema cost.
 *
 * **Model-agnostic on purpose.** There is no per-model voice. The MCP bridge and the in-app agent
 * are both "an agent acting for a user", and which model is behind either is not the project's
 * business. (A `claude` voice existed before this and is gone; see the `9 -> 10` document upcaster.)
 */
import type { Author } from "./types";

/** Marks an author as an agent, with the driving user's id after it. */
export const AGENT_PREFIX = "agent:";

/** The agent voice with no driver recorded. Never written - only read, in data from before agent
 *  edits named the user who drove them. */
export const UNATTRIBUTED_AGENT = "agent";

/** The author to stamp on an agent's edit, given the user driving it. */
export const agentAuthor = (userId: string): Author => `${AGENT_PREFIX}${userId}`;

/** Whether this author is an AI agent rather than a person. */
export const isAgentAuthor = (author: string): boolean =>
  author === UNATTRIBUTED_AGENT || author.startsWith(AGENT_PREFIX);

/** The user an agent edit was made for, or null when the author is not an attributed agent. */
export const agentDriver = (author: string): string | null =>
  author.startsWith(AGENT_PREFIX) ? author.slice(AGENT_PREFIX.length) || null : null;

/**
 * Whether `author` is `userId`'s own work: their own edits, and an agent they drove.
 *
 * This is the test undo scopes by, which is why an unattributed agent edit is nobody's: with no
 * record of who drove it, taking it back could take back somebody else's work.
 */
export const isOwnWork = (author: string, userId: string): boolean =>
  author === userId || author === agentAuthor(userId);

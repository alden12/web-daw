/**
 * The data operations behind the sync API. Access is "owner OR member": a project is reachable by its
 * owner and by anyone whose (lowercased) email matches a `project_members` row for it - so most reads
 * and writes take an {@link Accessor} (`{ userId, email }`) and gate on {@link accessibleWhere} rather
 * than a bare owner id. The HTTP layer (api/app.ts) validates and maps these to status codes; here lives
 * the actual SQL intent:
 *  - listing hides soft-deleted projects; delete is soft (recoverable) and owner-only.
 *  - a first write to an unknown project id creates its row (owner-stamped); a later write is allowed for
 *    the owner or any member (never re-stamping the owner), else forbidden.
 *  - `history/commits/*` is write-once (append-only history); overwrites are refused.
 *  - writing manifest.json / meta.json syncs the queryable columns (schema / name+time).
 */
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./types";
import { edits, files, projectMembers, projects, users } from "./schema";

export type WriteResult = { ok: true } | { ok: false; reason: "conflict" | "forbidden" };

/** A caller's identity for access checks: their user id (owner match) plus best-effort email (member
 *  match). The room persists as the project's real owner, so it passes `{ userId: ownerId }` (no email). */
export type Accessor = { userId: string; email?: string | null };

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * SQL predicate: this `projects` row is accessible to `who` - they own it, or a member row matches their
 * lowercased email. Drops in wherever a query was previously `eq(projects.ownerId, ownerId)`. With no
 * email on the accessor it degrades to the plain owner check.
 */
function accessibleWhere(who: Accessor) {
  const owner = eq(projects.ownerId, who.userId);
  const email = who.email ? normalizeEmail(who.email) : "";
  if (!email) return owner;
  return or(
    owner,
    sql`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.email} = ${email})`,
  );
}

/** Whether `who` may access an existing project (owner or member). */
async function canAccess(db: Db, who: Accessor, projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), accessibleWhere(who)))
    .limit(1);
  return rows.length > 0;
}

/** A bundle file's content: JSON text entries as parsed JSON, binary entries as bytes. */
export type FilePayload = { kind: "json"; json: unknown } | { kind: "binary"; bytes: Uint8Array };

/** One authored edit as appended/read over the wire (structural; the command stays opaque here). */
export type EditEntryInput = {
  seq: number;
  command: unknown;
  author: string;
  time: number;
  kind?: string;
  label?: string;
};

const isCommitPath = (path: string) => path.startsWith("history/commits/");

/**
 * Provision a user row just-in-time (idempotent). Called from the principal seam on every resolved
 * request, so the `projects.owner_id` FK is always satisfied before any owner-stamped project write.
 * A conflicting id keeps the existing row (we do not overwrite a stored email with a possibly-absent
 * one). This is the same path that later provisions a real user on their first authenticated request.
 */
export async function ensureUser(db: Db, userId: string, email?: string): Promise<void> {
  await db
    .insert(users)
    .values({ id: userId, email: email ?? null })
    .onConflictDoNothing();
}

/** A project whose stored document version trails the current schema (needs upcasting). */
export type StaleProject = { id: string; name: string; projectSchema: number };

/**
 * Non-deleted projects whose `projectSchema` (backfilled from manifest.json on every write)
 * is below `currentVersion`. Spans all owners on purpose: this is an operator/health view of
 * document drift, not a user-facing listing. Lets a document-schema bump be *detected* - the
 * jsonb blobs are opaque to drizzle-kit's DDL migrations, so this queryable version column is
 * how stale stored data surfaces instead of drifting silently.
 */
export async function findStaleProjects(db: Db, currentVersion: number): Promise<StaleProject[]> {
  return db
    .select({ id: projects.id, name: projects.name, projectSchema: projects.projectSchema })
    .from(projects)
    .where(and(isNull(projects.deletedAt), lt(projects.projectSchema, currentVersion)))
    .orderBy(projects.projectSchema);
}

/** The caller's role on a project in a listing: their own, or one shared with them. */
export type ProjectRole = "owner" | "editor";
/** A project as returned to the client's library list: enough to render it without a per-project read
 *  (name + modifiedAt mirror meta.json), plus the caller's role so the UI can gate owner-only actions. */
export type ProjectListing = { id: string; name: string; modifiedAt: string; role: ProjectRole };

/** The caller's accessible (owned + shared, non-deleted) projects, newest first. */
export async function listProjects(db: Db, who: Accessor): Promise<ProjectListing[]> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, modifiedAt: projects.modifiedAt, ownerId: projects.ownerId })
    .from(projects)
    .where(and(accessibleWhere(who), isNull(projects.deletedAt)))
    .orderBy(sql`${projects.modifiedAt} desc`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    modifiedAt: row.modifiedAt instanceof Date ? row.modifiedAt.toISOString() : String(row.modifiedAt),
    role: row.ownerId === who.userId ? "owner" : "editor",
  }));
}

/** Soft-delete: stamp deletedAt so the project drops out of listings but its files remain. */
export async function softDeleteProject(db: Db, ownerId: string, projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
}

/** A file's content (JSON or binary), or null if absent / not accessible to the caller. */
export async function readFile(db: Db, who: Accessor, projectId: string, path: string): Promise<FilePayload | null> {
  const rows = await db
    .select({ json: files.json, bytes: files.bytes })
    .from(files)
    .innerJoin(projects, eq(files.projectId, projects.id))
    .where(and(eq(files.projectId, projectId), eq(files.path, path), accessibleWhere(who)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return row.bytes != null ? { kind: "binary", bytes: row.bytes } : { kind: "json", json: row.json };
}

/** Whether a file exists and is accessible to the caller (drives BundleStore.exists / sample dedup). */
export async function fileExists(db: Db, who: Accessor, projectId: string, path: string): Promise<boolean> {
  const rows = await db
    .select({ path: files.path })
    .from(files)
    .innerJoin(projects, eq(files.projectId, projects.id))
    .where(and(eq(files.projectId, projectId), eq(files.path, path), accessibleWhere(who)))
    .limit(1);
  return rows.length > 0;
}

/** Upsert a bundle file. Creates the project row on first write; enforces owner-or-member + append-only. */
export async function writeFile(
  db: Db,
  who: Accessor,
  projectId: string,
  path: string,
  payload: FilePayload,
): Promise<WriteResult> {
  // Exactly one payload column is set (mirrors the CHECK constraint).
  const columns = payload.kind === "json" ? { json: payload.json, bytes: null } : { json: null, bytes: payload.bytes };
  return db.transaction(async (tx) => {
    // First write to this id creates the project (stamped to the writer as owner); a repeat is a no-op,
    // so an existing project keeps its real owner and a member's write never re-stamps it.
    await tx.insert(projects).values({ id: projectId, ownerId: who.userId }).onConflictDoNothing();
    if (!(await canAccess(tx, who, projectId))) return { ok: false, reason: "forbidden" };

    if (isCommitPath(path)) {
      // Commits are immutable (append-only history). Insert, never update: the (projectId, path)
      // unique constraint makes exactly one concurrent insert win - the loser gets no row back
      // and is a conflict. This is atomic, unlike a check-then-upsert which two writers can race.
      const inserted = await tx
        .insert(files)
        .values({ projectId, path, ...columns })
        .onConflictDoNothing()
        .returning({ path: files.path });
      if (inserted.length === 0) return { ok: false, reason: "conflict" };
    } else {
      await tx
        .insert(files)
        .values({ projectId, path, ...columns })
        .onConflictDoUpdate({
          target: [files.projectId, files.path],
          set: { ...columns, updatedAt: sql`now()` },
        });
    }

    // Keep the queryable project columns in step with the bundle's own metadata.
    if (payload.kind === "json" && path === "meta.json") await syncMeta(tx, projectId, payload.json);
    if (payload.kind === "json" && path === "manifest.json") await syncManifest(tx, projectId, payload.json);
    return { ok: true };
  });
}

/**
 * Append authored edits to the project's log. Creates the project on first write and enforces
 * owner. Upserts by `seq` so a coalescing edit re-sent with the same `seq` updates in place (the
 * working log is mutable; see the schema). Returns the project's current max seq.
 */
export async function appendEdits(
  db: Db,
  who: Accessor,
  projectId: string,
  entries: EditEntryInput[],
): Promise<{ ok: true; maxSeq: number } | { ok: false; reason: "forbidden" }> {
  return db.transaction(async (tx) => {
    await tx.insert(projects).values({ id: projectId, ownerId: who.userId }).onConflictDoNothing();
    if (!(await canAccess(tx, who, projectId))) return { ok: false, reason: "forbidden" };

    if (entries.length > 0) {
      // Upsert by (projectId, seq): the working edit log is MUTABLE - a coalescing edit (a knob
      // drag) folds into its entry in place without a new seq, so a re-send must update it. This
      // is distinct from the write-once *commit* history (which stays append-only). Access is
      // gated above (owner or member), so only a collaborator on the project can touch its log.
      await tx
        .insert(edits)
        .values(
          entries.map((entry) => ({
            projectId,
            seq: entry.seq,
            command: entry.command,
            author: entry.author,
            time: entry.time,
            kind: entry.kind ?? null,
            label: entry.label ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [edits.projectId, edits.seq],
          set: {
            command: sql`excluded."command"`,
            author: sql`excluded."author"`,
            time: sql`excluded."time"`,
            kind: sql`excluded."kind"`,
            label: sql`excluded."label"`,
          },
        });
    }

    const rows = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${edits.seq}), -1)` })
      .from(edits)
      .where(eq(edits.projectId, projectId));
    return { ok: true, maxSeq: Number(rows[0]?.maxSeq ?? -1) };
  });
}

/**
 * The accessible project's authored edits with `seq > sinceSeq`, oldest first (the delta tail / feed
 * window). With `limit`, returns the most recent N (order desc + limit, then reversed to oldest-first) so
 * the caller gets a bounded recent window rather than the unbounded history.
 */
export async function readEdits(
  db: Db,
  who: Accessor,
  projectId: string,
  sinceSeq: number,
  limit?: number,
): Promise<EditEntryInput[]> {
  const select = () =>
    db
      .select({
        seq: edits.seq,
        command: edits.command,
        author: edits.author,
        time: edits.time,
        kind: edits.kind,
        label: edits.label,
      })
      .from(edits)
      .innerJoin(projects, eq(edits.projectId, projects.id))
      .where(and(eq(edits.projectId, projectId), accessibleWhere(who), gt(edits.seq, sinceSeq)));
  const rows =
    limit != null
      ? (await select().orderBy(desc(edits.seq)).limit(limit)).reverse()
      : await select().orderBy(edits.seq);
  // Drop null kind/label so the entries match the wire schema (optional, not nullable).
  return rows.map((row) => ({
    seq: row.seq,
    command: row.command,
    author: row.author,
    time: row.time,
    ...(row.kind != null ? { kind: row.kind } : {}),
    ...(row.label != null ? { label: row.label } : {}),
  }));
}

/** The project's highest authored edit `seq`, or -1 if it has none. The realtime authority uses this
 *  to resume seq assignment for a room without reading the whole edit stream. Owner-scoped. */
export async function maxEditSeq(db: Db, ownerId: string, projectId: string): Promise<number> {
  const rows = await db
    .select({ maxSeq: sql<number>`coalesce(max(${edits.seq}), -1)` })
    .from(edits)
    .innerJoin(projects, eq(edits.projectId, projects.id))
    .where(and(eq(edits.projectId, projectId), eq(projects.ownerId, ownerId)));
  return Number(rows[0]?.maxSeq ?? -1);
}

/** The project's real owner + whether `who` may open it, for the realtime room. Keyed by project id, so
 *  the room persists under the true owner (not whoever connects first). A not-yet-existing project is
 *  creatable by anyone (first-write-creates), with `who` as its owner. */
export type ProjectAccess = { allowed: boolean; ownerId: string };
export async function resolveProjectAccess(db: Db, who: Accessor, projectId: string): Promise<ProjectAccess> {
  const rows = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  const ownerId = rows[0]?.ownerId;
  if (ownerId == null) return { allowed: true, ownerId: who.userId };
  if (ownerId === who.userId) return { allowed: true, ownerId };
  return { allowed: await canAccess(db, who, projectId), ownerId };
}

/** The project's owner id, or null when it doesn't exist / is deleted. Drives the owner-only gate on
 *  member management (only the owner may share a project). */
export async function getProjectOwner(db: Db, projectId: string): Promise<string | null> {
  const rows = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  return rows[0]?.ownerId ?? null;
}

/** A project collaborator as returned to the owner's Share panel. */
export type MemberRecord = { email: string; role: string };

/** The project's members (excludes the owner), oldest invite first. */
export async function listMembers(db: Db, projectId: string): Promise<MemberRecord[]> {
  return db
    .select({ email: projectMembers.email, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt);
}

/** Add (or re-role) a member by email. Email is normalized lowercase to match the token email at query
 *  time. Idempotent: re-inviting the same address updates the role. */
export async function addMember(
  db: Db,
  projectId: string,
  email: string,
  role: string,
  invitedBy: string,
): Promise<void> {
  await db
    .insert(projectMembers)
    .values({ projectId, email: normalizeEmail(email), role, invitedBy })
    .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.email], set: { role } });
}

/** Remove a member by email (a no-op if they were not a member). */
export async function removeMember(db: Db, projectId: string, email: string): Promise<void> {
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.email, normalizeEmail(email))));
}

/** meta.json -> projects.name + modifiedAt (so the list is queryable without reading files). */
async function syncMeta(db: Db, projectId: string, json: unknown): Promise<void> {
  const meta = json as { name?: string; modifiedAt?: string } | null;
  const modifiedAt = meta?.modifiedAt ? new Date(meta.modifiedAt) : new Date();
  await db
    .update(projects)
    .set({ name: meta?.name || "Untitled", modifiedAt })
    .where(eq(projects.id, projectId));
}

/** manifest.json -> projects.projectSchema (so a stale document version is queryable). */
async function syncManifest(db: Db, projectId: string, json: unknown): Promise<void> {
  const manifest = json as { projectSchema?: number } | null;
  if (typeof manifest?.projectSchema === "number") {
    await db.update(projects).set({ projectSchema: manifest.projectSchema }).where(eq(projects.id, projectId));
  }
}

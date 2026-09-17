/**
 * The data operations behind the sync API - all owner-scoped, so multi-user later is
 * a change of principal, not of queries. The HTTP layer (api/app.ts) validates and maps
 * these to status codes; here lives the actual SQL intent:
 *  - listing hides soft-deleted projects; delete is soft (recoverable).
 *  - a first write to an unknown project id creates its row (owner-stamped).
 *  - `history/commits/*` is write-once (append-only history); overwrites are refused.
 *  - writing manifest.json / meta.json syncs the queryable columns (schema / name+time).
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "./types";
import { edits, files, projects } from "./schema";

export type WriteResult = { ok: true } | { ok: false; reason: "conflict" | "forbidden" };

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

/** Ids of the owner's non-deleted projects (newest first). */
export async function listProjectIds(db: Db, ownerId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.ownerId, ownerId), isNull(projects.deletedAt)))
    .orderBy(sql`${projects.modifiedAt} desc`);
  return rows.map((row) => row.id);
}

/** Soft-delete: stamp deletedAt so the project drops out of listings but its files remain. */
export async function softDeleteProject(db: Db, ownerId: string, projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
}

/** A file's content (JSON or binary), or null if absent / not the owner's. */
export async function readFile(db: Db, ownerId: string, projectId: string, path: string): Promise<FilePayload | null> {
  const rows = await db
    .select({ json: files.json, bytes: files.bytes })
    .from(files)
    .innerJoin(projects, eq(files.projectId, projects.id))
    .where(and(eq(files.projectId, projectId), eq(files.path, path), eq(projects.ownerId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return row.bytes != null ? { kind: "binary", bytes: row.bytes } : { kind: "json", json: row.json };
}

/** Whether a file exists for the owner (drives BundleStore.exists / sample dedup). */
export async function fileExists(db: Db, ownerId: string, projectId: string, path: string): Promise<boolean> {
  const rows = await db
    .select({ path: files.path })
    .from(files)
    .innerJoin(projects, eq(files.projectId, projects.id))
    .where(and(eq(files.projectId, projectId), eq(files.path, path), eq(projects.ownerId, ownerId)))
    .limit(1);
  return rows.length > 0;
}

/** Upsert a bundle file. Creates the project row on first write; enforces owner + append-only. */
export async function writeFile(
  db: Db,
  ownerId: string,
  projectId: string,
  path: string,
  payload: FilePayload,
): Promise<WriteResult> {
  // Exactly one payload column is set (mirrors the CHECK constraint).
  const columns = payload.kind === "json" ? { json: payload.json, bytes: null } : { json: null, bytes: payload.bytes };
  return db.transaction(async (tx) => {
    // First write to this id creates the project (owner-stamped); a repeat is a no-op.
    await tx.insert(projects).values({ id: projectId, ownerId }).onConflictDoNothing();
    const owned = await tx.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
    if (owned[0]?.ownerId !== ownerId) return { ok: false, reason: "forbidden" };

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
  ownerId: string,
  projectId: string,
  entries: EditEntryInput[],
): Promise<{ ok: true; maxSeq: number } | { ok: false; reason: "forbidden" }> {
  return db.transaction(async (tx) => {
    await tx.insert(projects).values({ id: projectId, ownerId }).onConflictDoNothing();
    const owned = await tx.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
    if (owned[0]?.ownerId !== ownerId) return { ok: false, reason: "forbidden" };

    if (entries.length > 0) {
      // Upsert by (projectId, seq): the working edit log is MUTABLE - a coalescing edit (a knob
      // drag) folds into its entry in place without a new seq, so a re-send must update it. This
      // is distinct from the write-once *commit* history (which stays append-only). Owner-scoped,
      // so a client can only ever rewrite its own working log.
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

/** The owner's authored edits with `seq > sinceSeq`, oldest first (the delta tail / feed window). */
export async function readEdits(
  db: Db,
  ownerId: string,
  projectId: string,
  sinceSeq: number,
): Promise<EditEntryInput[]> {
  const rows = await db
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
    .where(and(eq(edits.projectId, projectId), eq(projects.ownerId, ownerId), gt(edits.seq, sinceSeq)))
    .orderBy(edits.seq);
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

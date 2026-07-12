import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeSyncEnv } from "./support/syncEnv";
import { findStaleProjects } from "../server/db/store";
import { projects } from "../server/db/schema";

const put = (app: Awaited<ReturnType<typeof makeSyncEnv>>["app"], path: string, body: string) =>
  app.request(`/projects/${path}`, { method: "PUT", body });

const PROJECT = JSON.stringify({ groups: [], tracks: [], tempoBpm: 120, lengthBeats: 16, selectedTrackId: null });
const manifest = (projectId: string, projectSchema: number) =>
  JSON.stringify({ formatVersion: 1, projectId, projectSchema });

// Write a project whose stored document version is `version` (backfilled from its manifest,
// as production writes do). Omit `version` to leave the row at its default (an un-manifested write).
const seed = async (app: Awaited<ReturnType<typeof makeSyncEnv>>["app"], id: string, version?: number) => {
  await put(app, `${id}/files/project.json`, PROJECT);
  if (version != null) await put(app, `${id}/files/manifest.json`, manifest(id, version));
};

describe("findStaleProjects (document-schema drift report)", () => {
  it("returns non-deleted projects below the current version, lowest first", async () => {
    const { app, db } = await makeSyncEnv();
    await seed(app, "current", 9); // at the current version - not stale
    await seed(app, "old", 7); // trails - stale
    await seed(app, "unmanifested"); // never wrote a manifest, stays at default 0 - stale

    const stale = await findStaleProjects(db, 9);
    expect(stale.map((project) => [project.id, project.projectSchema])).toEqual([
      ["unmanifested", 0],
      ["old", 7],
    ]);
  });

  it("is empty when every project is at the current version", async () => {
    const { app, db } = await makeSyncEnv();
    await seed(app, "a", 9);
    await seed(app, "b", 9);
    expect(await findStaleProjects(db, 9)).toEqual([]);
  });

  it("excludes soft-deleted projects (a recoverable delete is not drift to act on)", async () => {
    const { app, db } = await makeSyncEnv();
    await seed(app, "gone", 7);
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, "gone"));
    expect(await findStaleProjects(db, 9)).toEqual([]);
  });
});

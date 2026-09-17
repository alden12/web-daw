import { beforeEach, describe, expect, it } from "vitest";
import { MemoryProjectStorage, setProjectStorage } from "../src/audio/bundleStore";
import { currentProjectId } from "../src/audio/projectRepository";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { VersionStore } from "../src/audio/commands/history";
import { attachAutosave } from "../src/audio/persistence";
import { listProjects, patchProjectName, refreshProjects, subscribeProjects } from "../src/audio/projects/library";
import {
  initProjects,
  createProject,
  switchProject,
  renameProject,
  deleteProject,
  forkProjectFromSnapshot,
} from "../src/audio/projects/operations";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh set of live objects sharing one repository (via the swapped global storage). */
function deps() {
  const projectStore = new ProjectStore();
  const editLog = new EditLog(projectStore);
  const versionStore = new VersionStore(projectStore, editLog);
  return { projectStore, editLog, versionStore };
}

describe("project library operations", () => {
  beforeEach(() => {
    setProjectStorage(new MemoryProjectStorage()); // isolated per test; repo + ops share it
  });

  it("init on an empty store seeds one project and makes it current", async () => {
    const d = deps();
    await initProjects(d);
    expect(listProjects()).toHaveLength(1);
    expect(currentProjectId()).toBe(listProjects()[0].id);
  });

  it("create switches to a new project; switching back restores each project's tracks", async () => {
    const d = deps();
    await initProjects(d);
    const first = currentProjectId();

    // Give the first project a distinctive second track.
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-first" });
    const firstCount = d.projectStore.getTracks().length;

    const second = await createProject(d, "Sketch 2");
    expect(second).not.toBe(first);
    expect(listProjects().map((meta) => meta.name)).toContain("Sketch 2");
    // The new project is a fresh default (does not have the first project's extra track).
    expect(d.projectStore.getTracks().some((track) => track.id === "t-first")).toBe(false);

    await switchProject(d, first);
    expect(currentProjectId()).toBe(first);
    expect(d.projectStore.getTracks()).toHaveLength(firstCount);
    expect(d.projectStore.getTracks().some((track) => track.id === "t-first")).toBe(true);
  });

  it("autosave follows the current project across a switch (no cross-project bleed)", async () => {
    // Reproduces the switch bug: attachAutosave must resolve the *current* repository
    // at save time, not capture the one bound at attach. With a captured repo, edits to
    // the second project were written into the first project's bundle, so switching back
    // showed the wrong project's tracks. The 300ms debounce means we wait past it.
    const d = deps();
    await initProjects(d);
    const dispose = attachAutosave(d.projectStore, d.editLog); // no repo -> follows getRepository()
    const first = currentProjectId();

    const second = await createProject(d, "Second");
    // Edit the second project and let autosave persist it into *its* bundle.
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-second" });
    await tick(400);

    await switchProject(d, first);
    // The first project must be untouched by the second project's autosaves.
    expect(d.projectStore.getTracks().some((track) => track.id === "t-second")).toBe(false);

    await switchProject(d, second);
    // The second project's edit persisted to its own bundle and comes back on return.
    expect(d.projectStore.getTracks().some((track) => track.id === "t-second")).toBe(true);
    dispose();
  });

  it("rename updates the library list", async () => {
    const d = deps();
    await initProjects(d);
    const id = currentProjectId();
    await renameProject(id, "My Beat");
    expect(listProjects().find((meta) => meta.id === id)?.name).toBe("My Beat");
  });

  it("forks a copy from a snapshot without switching the current project", async () => {
    const d = deps();
    await initProjects(d);
    const original = currentProjectId();

    // A snapshot carrying an edit the original bundle doesn't have (the "my offline state").
    d.editLog.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-mine" });
    const myState = d.projectStore.snapshot();
    // Rewind the live store so the original bundle is WITHOUT that track (simulating "take theirs" locally).
    d.editLog.undo();

    const copyId = await forkProjectFromSnapshot(myState, "My Track (copy)");
    expect(copyId).not.toBe(original);
    expect(currentProjectId()).toBe(original); // fork does NOT switch the current project
    expect(listProjects().find((meta) => meta.id === copyId)?.name).toBe("My Track (copy)");

    // Opening the copy shows the forked state (the edit that was only in the snapshot).
    await switchProject(d, copyId);
    expect(d.projectStore.getTracks().some((track) => track.id === "t-mine")).toBe(true);
  });

  it("deleting the current project falls back to another", async () => {
    const d = deps();
    await initProjects(d);
    const first = currentProjectId();
    const second = await createProject(d, "Second");
    expect(listProjects()).toHaveLength(2);

    await deleteProject(d, second);
    expect(listProjects().map((meta) => meta.id)).not.toContain(second);
    expect(currentProjectId()).toBe(first);
    expect(listProjects()).toHaveLength(1);
  });
});

describe("MemoryProjectStorage enumerate + delete", () => {
  it("lists written project ids and deletes a project's bytes", async () => {
    const storage = new MemoryProjectStorage();
    await storage.bundle("a").writeText("project.json", "{}");
    await storage.bundle("b").writeText("meta.json", '{"name":"B"}');
    const ids = async () => (await storage.listProjects()).map((project) => project.id);
    expect((await ids()).sort()).toEqual(["a", "b"]);
    // meta.json feeds the listing name; a bundle without one falls back to its id.
    expect((await storage.listProjects()).find((project) => project.id === "b")?.name).toBe("B");

    await storage.deleteProject("a");
    expect(await ids()).toEqual(["b"]);
    expect(await storage.bundle("a").readText("project.json")).toBeNull();
  });
});

describe("patchProjectName (live rename propagation)", () => {
  it("updates the cached label in place and notifies subscribers", async () => {
    const storage = new MemoryProjectStorage();
    setProjectStorage(storage);
    await storage.bundle("p1").writeText("meta.json", JSON.stringify({ name: "Old" }));
    await refreshProjects(storage);
    expect(listProjects().find((meta) => meta.id === "p1")?.name).toBe("Old");

    let notified = 0;
    const unsub = subscribeProjects(() => (notified += 1));
    patchProjectName("p1", "New");
    expect(listProjects().find((meta) => meta.id === "p1")?.name).toBe("New");
    expect(notified).toBe(1);

    patchProjectName("missing", "x"); // no-op: not in the cache, no notification
    expect(notified).toBe(1);
    unsub();
  });
});

/** Which track is selected is yours, not the project's: it survives a reload of the project. */
import { describe, it, expect, beforeEach } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { rememberSelection, restoreSelection } from "../src/ui/rememberedSelection";
import { resetPersistentCache } from "../src/ui/persistentStore";

/** A project with three tracks, the last one created (so selected) - as a server copy would be. */
function threeTracks(): { store: ProjectStore; ids: string[] } {
  const store = new ProjectStore(false);
  const ids = ["subtractive", "fm", "organ"].map((type) => store.addTrack(type).id);
  return { store, ids };
}

beforeEach(() => resetPersistentCache());

describe("reloading a project keeps the selection", () => {
  it("keeps the track you had selected, not the one the loaded copy names", () => {
    const { store, ids } = threeTracks();
    const serverCopy = store.snapshot(); // selected: the last track created
    store.selectTrack(ids[0]);
    store.load(serverCopy); // an undo, or a peer's edit rebuilding the project
    expect(store.selectedId).toBe(ids[0]);
  });

  it("falls back to the loaded copy's selection when yours is gone, then to the first track", () => {
    const { store, ids } = threeTracks();
    const withoutFirst = {
      ...store.snapshot(),
      tracks: store.snapshot().tracks.filter((track) => track.id !== ids[0]),
    };
    store.selectTrack(ids[0]);
    store.load(withoutFirst);
    expect(store.selectedId).toBe(ids[2]);
    store.load({ ...withoutFirst, selectedTrackId: null });
    expect(store.selectedId).toBe(ids[2]); // still there, so kept
  });
});

describe("the selection remembered on this device", () => {
  it("is put back when the project opens fresh (a page refresh)", () => {
    const { store, ids } = threeTracks();
    rememberSelection("p-1", ids[1]);
    const refreshed = new ProjectStore(false);
    refreshed.load(store.snapshot()); // opens on the last-created track
    restoreSelection("p-1", refreshed);
    expect(refreshed.selectedId).toBe(ids[1]);
  });

  it("is per project, and ignored if that track was removed", () => {
    const { store, ids } = threeTracks();
    rememberSelection("p-other", ids[0]);
    restoreSelection("p-1", store);
    expect(store.selectedId).toBe(ids[2]);
    rememberSelection("p-1", "t-gone");
    restoreSelection("p-1", store);
    expect(store.selectedId).toBe(ids[2]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { setSampleAssets, resolveSampleHash } from "../src/audio/samples/sampleRegistry";

// The import helper stores bytes + dispatches an edit; stub the OPFS-backed store.
vi.mock("../src/audio/audioStore", () => ({
  audioStorageAvailable: () => true,
  putAudio: vi.fn(async () => "hash-abc"),
  getAudioBuffer: vi.fn(),
}));
import { importSampleFile } from "../src/audio/samples/importSample";
import { putAudio } from "../src/audio/audioStore";
import type { EditCommand } from "../src/audio/commands/types";

describe("project sample library", () => {
  it("adds, dedupes by id, and removes; survives a snapshot round-trip", () => {
    const store = new ProjectStore(false);
    store.addSample({ id: "a", name: "Kick", contentHash: "h1", source: "import" });
    store.addSample({ id: "a", name: "Dup", contentHash: "h2" }); // same id -> ignored
    store.addSample({ id: "b", name: "Snare", contentHash: "h2" });
    expect(store.getSamples().map((sample) => sample.id)).toEqual(["a", "b"]);

    const restored = new ProjectStore(false);
    restored.load(store.snapshot());
    expect(restored.getSamples()).toEqual(store.getSamples());

    restored.removeSample("a");
    expect(restored.getSamples().map((sample) => sample.id)).toEqual(["b"]);
  });
});

describe("sample registry", () => {
  it("resolves an asset id to its content hash", () => {
    setSampleAssets([{ id: "x", name: "X", contentHash: "deadbeef" }]);
    expect(resolveSampleHash("x")).toBe("deadbeef");
    expect(resolveSampleHash("missing")).toBeUndefined();
    setSampleAssets([]); // replace, not merge
    expect(resolveSampleHash("x")).toBeUndefined();
  });
});

describe("importSampleFile", () => {
  const file = { name: "My Loop.wav" } as unknown as File;

  it("stores the file and dispatches addSample with a stable id", async () => {
    const dispatched: EditCommand[] = [];
    const dispatch = vi.fn((command: EditCommand) => dispatched.push(command));

    const ref = await importSampleFile(file, [], dispatch);

    expect(putAudio).toHaveBeenCalledOnce();
    expect(dispatched).toHaveLength(1);
    const added = dispatched[0] as Extract<EditCommand, { type: "addSample" }>;
    expect(added.type).toBe("addSample");
    expect(added.name).toBe("My Loop");
    expect(added.contentHash).toBe("hash-abc");
    expect(ref).toBe(`asset:${added.id}`);
  });

  it("dedupes: identical bytes reuse the existing asset, no new dispatch", async () => {
    const dispatch = vi.fn();
    const ref = await importSampleFile(file, [{ id: "existing", name: "Old", contentHash: "hash-abc" }], dispatch);
    expect(ref).toBe("asset:existing");
    expect(dispatch).not.toHaveBeenCalled();
  });
});

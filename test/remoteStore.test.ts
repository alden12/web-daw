import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSyncEnv, type SyncEnv } from "./support/syncEnv";
import { RemoteProjectStorage } from "../src/audio/remoteStore";

// Route the client's global `fetch` (used by the contract-derived createApiClient that
// RemoteBundleStore/RemoteProjectStorage wrap) at the real Hono app over pglite, so this
// exercises the client protocol end-to-end against the real server - not a hand-rolled
// mock that could drift from it.
let env: SyncEnv;
let realFetch: typeof globalThis.fetch;

beforeEach(async () => {
  env = await makeSyncEnv();
  realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => env.app.request(input, init)) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("RemoteBundleStore / RemoteProjectStorage", () => {
  it("round-trips text and blobs, reports existence, lists and deletes", async () => {
    const storage = new RemoteProjectStorage("http://localhost");
    const bundle = storage.bundle("p1");

    expect(await bundle.readText("project.json")).toBeNull();
    expect(await bundle.exists("project.json")).toBe(false);

    const project = JSON.stringify({ groups: [], tracks: [], tempoBpm: 120, lengthBeats: 16, selectedTrackId: null });
    await bundle.writeText("project.json", project);
    // jsonb may reorder keys server-side, so compare parsed values.
    expect(JSON.parse((await bundle.readText("project.json"))!)).toEqual(JSON.parse(project));
    expect(await bundle.exists("project.json")).toBe(true);

    const bytes = new Uint8Array([1, 2, 3, 4]);
    await bundle.writeBlob("samples/abc123", new Blob([bytes]));
    const read = await bundle.readBlob("samples/abc123");
    expect(read).not.toBeNull();
    expect(new Uint8Array(read!)).toEqual(bytes);

    expect((await storage.listProjects()).map((project) => project.id)).toEqual(["p1"]);

    await storage.deleteProject("p1");
    expect(await storage.listProjects()).toEqual([]);
  });

  it("treats a repeated commit write as idempotent (409 swallowed, no throw)", async () => {
    const bundle = new RemoteProjectStorage("http://localhost").bundle("p1");
    const c1 = JSON.stringify({
      id: "c1",
      parent: null,
      author: "you",
      message: "",
      time: 0,
      auto: true,
      entryCount: 0,
      entries: [],
      lastSeq: 0,
    });
    await bundle.writeText("history/commits/c1.json", c1);
    await expect(bundle.writeText("history/commits/c1.json", c1)).resolves.toBeUndefined();
  });

  it("appends and reads back edits through the seam", async () => {
    const bundle = new RemoteProjectStorage("http://localhost").bundle("p1");
    const edits = [
      { seq: 0, command: { type: "addNote" }, author: "you", time: 1 },
      { seq: 1, command: { type: "removeNote" }, author: "you", time: 2 },
    ] as unknown as Parameters<typeof bundle.appendEdits>[0];

    expect(await bundle.readEdits(-1)).toEqual([]);
    await bundle.appendEdits(edits);
    expect((await bundle.readEdits(-1)).map((entry) => entry.seq)).toEqual([0, 1]);
    expect((await bundle.readEdits(0)).map((entry) => entry.seq)).toEqual([1]);
  });

  it("sends the bearer token when configured", async () => {
    env = await makeSyncEnv({ token: "secret" }); // the fetch closure reads the current env
    const ok = new RemoteProjectStorage("http://localhost", "secret");
    expect(await ok.listProjects()).toEqual([]);

    const bad = new RemoteProjectStorage("http://localhost", "wrong");
    await expect(bad.listProjects()).rejects.toThrow();
  });
});

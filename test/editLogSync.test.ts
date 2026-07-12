import { describe, expect, it } from "vitest";
import { makeSyncEnv } from "./support/syncEnv";
import { createApp } from "../server/api/app";

const entry = (seq: number, type = "addNote") => ({ seq, command: { type }, author: "you", time: 1000 + seq });

const append = (app: Awaited<ReturnType<typeof makeSyncEnv>>["app"], id: string, entries: unknown[]) =>
  app.request(`/projects/${id}/edits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });

const readEntries = async (app: Awaited<ReturnType<typeof makeSyncEnv>>["app"], id: string, since?: number) => {
  const url = since != null ? `/projects/${id}/edits?since=${since}` : `/projects/${id}/edits`;
  return (await (await app.request(url)).json()).entries as Array<{ seq: number; command: { type: string } }>;
};

describe("edit log endpoints (server delta stream)", () => {
  it("appends edits and reads them back ordered, with maxSeq", async () => {
    const { app } = await makeSyncEnv();
    const res = await append(app, "p1", [entry(0), entry(1), entry(2)]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ maxSeq: 2 });

    const entries = await readEntries(app, "p1");
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(entries[0]?.command).toEqual({ type: "addNote" });
  });

  it("is idempotent: re-appending the same seqs adds nothing", async () => {
    const { app } = await makeSyncEnv();
    await append(app, "p1", [entry(0), entry(1)]);
    expect(await (await append(app, "p1", [entry(0), entry(1)])).json()).toEqual({ maxSeq: 1 });
    expect(await readEntries(app, "p1")).toHaveLength(2);
  });

  it("upserts by seq: a re-appended entry updates in place (coalescing re-sync)", async () => {
    const { app } = await makeSyncEnv();
    await append(app, "p1", [entry(0, "addNote")]);
    await append(app, "p1", [entry(0, "removeNote")]); // same seq, coalesced to a new command
    const entries = await readEntries(app, "p1");
    expect(entries).toHaveLength(1); // still one row - upsert, not a second insert
    expect(entries[0]?.command).toEqual({ type: "removeNote" }); // the latest value wins
  });

  it("?since= returns only the tail", async () => {
    const { app } = await makeSyncEnv();
    await append(app, "p1", [entry(0), entry(1), entry(2), entry(3)]);
    expect((await readEntries(app, "p1", 1)).map((e) => e.seq)).toEqual([2, 3]);
  });

  it("rejects an oversized append body with 413", async () => {
    const { app } = await makeSyncEnv({ maxJsonBytes: 50 });
    expect((await append(app, "p1", [entry(0), entry(1), entry(2), entry(3), entry(4)])).status).toBe(413);
  });

  it("rejects a wrong-shaped entry with 400 (shape-validated append body)", async () => {
    const { app } = await makeSyncEnv();
    const res = await app.request("/projects/p1/edits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ seq: 0 }] }), // missing command/author/time
    });
    expect(res.status).toBe(400);
  });

  it("scopes edits to the owner", async () => {
    const { db } = await makeSyncEnv({ ownerId: "a" });
    const appA = createApp(db, { ownerId: "a" });
    const appB = createApp(db, { ownerId: "b" });
    await append(appA, "p1", [entry(0)]);
    expect(await readEntries(appB, "p1")).toEqual([]);
  });
});

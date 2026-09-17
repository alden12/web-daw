import { describe, expect, it } from "vitest";
import { serializeOpfsWrite } from "../src/audio/bundleStore";

/** A write whose completion delay SHRINKS per call, so a later call would finish before an earlier one
 *  without serialization - the OPFS copy-on-write hazard (last-to-finish wins) in miniature. */
function racyWrite(log: string[], value: string, callIndex: number): () => Promise<void> {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 50 - callIndex * 12)));
    log.push(value);
  };
}

describe("serializeOpfsWrite", () => {
  it("runs writes to one key in ISSUE order even when they would complete out of order", async () => {
    const landed: string[] = [];
    // Fire 5 overlapping writes to the same path without awaiting between them (a drag's save burst).
    const writes = ["v0", "v1", "v2", "v3", "v4"].map((value, index) =>
      serializeOpfsWrite("proj/pending.json", racyWrite(landed, value, index)),
    );
    await Promise.all(writes);

    // Serialized -> issue order, so the LAST-issued write lands last (newest state wins on disk).
    expect(landed).toEqual(["v0", "v1", "v2", "v3", "v4"]);
  });

  it("keeps a failed write from wedging the path (the chain continues)", async () => {
    const landed: string[] = [];
    const ok = serializeOpfsWrite("proj/wedge.json", racyWrite(landed, "before", 0));
    const boom = serializeOpfsWrite("proj/wedge.json", async () => {
      throw new Error("write failed");
    });
    const after = serializeOpfsWrite("proj/wedge.json", racyWrite(landed, "after", 0));

    await ok;
    await expect(boom).rejects.toThrow("write failed"); // the failure surfaces to its own caller
    await after; // ...but the next write still runs
    expect(landed).toEqual(["before", "after"]);
  });

  it("does not serialize across different keys (independent files run concurrently)", async () => {
    const landed: string[] = [];
    // Key A's single write is slow; key B's is fast. Different keys -> B need not wait for A.
    const a = serializeOpfsWrite("proj/a.json", racyWrite(landed, "a", 0)); // ~50ms
    const b = serializeOpfsWrite("proj/b.json", racyWrite(landed, "b", 4)); // ~2ms
    await Promise.all([a, b]);
    expect(landed).toEqual(["b", "a"]); // b finished first because it wasn't chained behind a
  });
});

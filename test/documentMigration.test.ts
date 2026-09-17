import { describe, expect, it } from "vitest";
import {
  DOCUMENT_UPCASTERS,
  PROJECT_SCHEMA,
  firstMissingUpcaster,
  migrateDocument,
} from "../src/audio/project/documentMigration";

describe("migrateDocument", () => {
  it("chains upcasters from the bundle version to the current schema", () => {
    const upcasters = {
      8: (data: unknown) => ({ ...(data as object), addedInV9: true }),
    };
    const { data, version } = migrateDocument({ tempoBpm: 120 }, 8, 9, upcasters);
    expect(version).toBe(9);
    expect(data).toEqual({ tempoBpm: 120, addedInV9: true });
  });

  it("runs several upcasters in order", () => {
    const upcasters = {
      7: (data: unknown) => ({ ...(data as object), seven: true }),
      8: (data: unknown) => ({ ...(data as object), eight: true }),
    };
    const { data, version } = migrateDocument({}, 7, 9, upcasters);
    expect(version).toBe(9);
    expect(data).toEqual({ seven: true, eight: true });
  });

  it("is a no-op when the document is already current", () => {
    const doc = { x: 1 };
    const { data, version } = migrateDocument(doc, 9, 9, {});
    expect(version).toBe(9);
    expect(data).toBe(doc);
  });

  it("stops at the highest version reached when an upcaster is missing", () => {
    const upcasters = { 8: (data: unknown) => ({ ...(data as object), step: 9 }) };
    // Asked to reach 11, but only 8 -> 9 is registered: stop honestly at 9.
    const { data, version } = migrateDocument({}, 8, 11, upcasters);
    expect(version).toBe(9);
    expect(data).toEqual({ step: 9 });
  });
});

describe("firstMissingUpcaster (no-gaps guard)", () => {
  const noop = (data: unknown) => data;

  it("passes vacuously for an empty registry (nothing registered yet)", () => {
    expect(firstMissingUpcaster(9, {})).toBeNull();
  });

  it("passes when the registry chains contiguously up to the target", () => {
    expect(firstMissingUpcaster(11, { 8: noop, 9: noop, 10: noop })).toBeNull();
  });

  it("reports the first hole in the chain", () => {
    // 9 -> 10 is missing, so a v9 document would strand at v9.
    expect(firstMissingUpcaster(11, { 8: noop, 10: noop })).toBe(9);
  });

  it("guards the real registry against a PROJECT_SCHEMA bump with no matching upcaster", () => {
    // The invariant that keeps versioning honest: every version below the current schema
    // must be reachable. Fails in CI the moment someone bumps PROJECT_SCHEMA and forgets
    // the upcaster.
    expect(firstMissingUpcaster(PROJECT_SCHEMA, DOCUMENT_UPCASTERS)).toBeNull();
  });
});

// The registry's first real entry (DAW-34). A document written before this holds the retired
// per-model author voice; after it, an AI edit is the agent's.
describe("9 -> 10: the model voice is retired", () => {
  const upcast = (document: unknown) => migrateDocument(document, 9, 10).data as Record<string, unknown>;

  it("rewrites the top-level authorship stamps", () => {
    const result = upcast({ authorship: { "clip:c-1": "claude", "clip:c-2": "you", "clip:c-3": "alice" } });
    expect(result.authorship).toEqual({ "clip:c-1": "agent", "clip:c-2": "you", "clip:c-3": "alice" });
  });

  it("rewrites the stamp on a clip, wherever in the tracks it sits", () => {
    const result = upcast({
      tracks: [
        {
          id: "t-1",
          clips: [
            { id: "c-1", author: "claude" },
            { id: "c-2", author: "you" },
          ],
        },
        { id: "t-2", clips: [{ id: "c-3", author: "claude", fileId: "f-1" }] },
      ],
    });
    const tracks = result.tracks as { clips: { author: string }[] }[];
    expect(tracks[0].clips.map((clip) => clip.author)).toEqual(["agent", "you"]);
    expect(tracks[1].clips[0].author).toBe("agent");
  });

  // It runs on documents written by code that is gone, so a shape it does not recognise has to pass
  // through rather than throw or invent fields.
  it("leaves a document it does not recognise alone", () => {
    expect(upcast({ tracks: "not an array", authorship: 7 })).toEqual({ tracks: "not an array", authorship: 7 });
    expect(migrateDocument(null, 9, 10).data).toBeNull();
  });

  it("does not add an author to a clip that never had one", () => {
    const result = upcast({ tracks: [{ id: "t-1", clips: [{ id: "c-1" }] }] });
    expect((result.tracks as { clips: object[] }[])[0].clips[0]).not.toHaveProperty("author");
  });

  it("carries the rest of the document through untouched", () => {
    const result = upcast({ tempoBpm: 128, name: "Demo", authorship: { "clip:c-1": "claude" } });
    expect(result.tempoBpm).toBe(128);
    expect(result.name).toBe("Demo");
  });
});

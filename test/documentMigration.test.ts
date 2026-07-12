import { describe, expect, it } from "vitest";
import { migrateDocument } from "../src/audio/project/documentMigration";

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

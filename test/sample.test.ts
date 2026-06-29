import { describe, expect, it } from "vitest";
import { ParamStore } from "../src/audio/params/store";
import { specToZod } from "../src/audio/params/zod";
import { validateParam } from "../src/audio/params/validate";
import type { SampleSpec } from "../src/audio/params/types";
import { BUILTIN_SAMPLES, builtinRef, fileRef, parseRef, refLabel } from "../src/audio/samples/catalog";

const spec: SampleSpec = { id: "x.sample", label: "Sample", kind: "sample", default: "builtin:kick" };

describe("sample param kind", () => {
  it("coerces: trusts a string, falls back to the default otherwise", () => {
    const store = new ParamStore([spec]);
    expect(store.get("x.sample")).toBe("builtin:kick");
    store.set("x.sample", "builtin:snare");
    expect(store.get("x.sample")).toBe("builtin:snare");
    store.set("x.sample", "");
    expect(store.get("x.sample")).toBe("");
    // a non-string falls back to the spec default
    store.set("x.sample", 42 as unknown as string);
    expect(store.get("x.sample")).toBe("builtin:kick");
  });

  it("validates: empty or a tagged ref passes; junk is rejected with a message", () => {
    const zod = specToZod(spec);
    expect(zod.safeParse("").success).toBe(true);
    expect(zod.safeParse("builtin:kick").success).toBe(true);
    expect(zod.safeParse("file:abc123").success).toBe(true);
    expect(zod.safeParse("garbage").success).toBe(false);
    expect(zod.safeParse("builtin:").success).toBe(false);

    expect(validateParam(spec, "builtin:kick")).toBeNull();
    expect(validateParam(spec, "garbage")).toMatch(/sample reference/);
  });
});

describe("sample catalog refs", () => {
  it("builtin/file refs round-trip through parseRef", () => {
    expect(parseRef(builtinRef("kick"))).toEqual({ kind: "builtin", id: "kick" });
    expect(parseRef(fileRef("abc"))).toEqual({ kind: "file", fileId: "abc" });
    expect(parseRef("")).toEqual({ kind: "none" });
    expect(parseRef("nonsense")).toEqual({ kind: "none" });
  });

  it("built-in ids are unique and resolve to human labels", () => {
    const ids = BUILTIN_SAMPLES.map((sample) => sample.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(refLabel(builtinRef("kick"))).toBe("Kick");
    expect(refLabel("")).toBe("None");
  });
});

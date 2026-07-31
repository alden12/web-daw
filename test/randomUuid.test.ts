import { afterEach, describe, expect, it } from "vitest";
import { randomUuid } from "../src/audio/randomUuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const original = crypto.randomUUID;
afterEach(() => {
  Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
});

/** Hide `crypto.randomUUID`, exactly as an insecure context does. */
function asInsecureContext(): void {
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
}

describe("randomUuid", () => {
  it("uses the platform implementation where there is one", () => {
    expect(randomUuid()).toMatch(UUID_V4);
  });

  it("still produces a v4 uuid when randomUUID is missing", () => {
    // The whole point: served over plain http from a LAN address (how the touch shell is
    // tested on a real phone) `crypto.randomUUID` is undefined, and this used to throw on
    // the first id the app generated - blanking the page with no clue why.
    asInsecureContext();
    expect(randomUuid()).toMatch(UUID_V4);
  });

  it("does not repeat itself", () => {
    asInsecureContext();
    const ids = new Set(Array.from({ length: 500 }, () => randomUuid()));
    expect(ids.size).toBe(500);
  });

  it("sets the version and variant bits, not just the shape", () => {
    // A fallback that got these wrong would still match a loose regex while producing
    // ids that are not actually v4 - worth asserting on the bits themselves.
    asInsecureContext();
    Array.from({ length: 50 }, () => randomUuid()).forEach((id) => {
      expect(id[14]).toBe("4");
      expect("89ab").toContain(id[19]);
    });
  });
});

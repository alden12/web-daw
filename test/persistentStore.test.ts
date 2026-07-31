import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPersistent, writePersistent, subscribePersistent, resetPersistentCache } from "../src/ui/persistentStore";

// localStorage-backed, and the node test env has none, so install a minimal shim.
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

describe("persistentStore", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = installLocalStorage();
    resetPersistentCache();
  });

  it("reads through to storage, then caches", () => {
    storage.set("k", "seeded");
    expect(readPersistent("k")).toBe("seeded");

    // Cached: a change made behind our back is not picked up, which is what makes the
    // cache authoritative rather than localStorage.
    storage.set("k", "changed elsewhere");
    expect(readPersistent("k")).toBe("seeded");
  });

  it("returns null for a key never set", () => {
    expect(readPersistent("absent")).toBeNull();
  });

  it("writes through to storage", () => {
    writePersistent("k", "value");
    expect(storage.get("k")).toBe("value");
    expect(readPersistent("k")).toBe("value");
  });

  // The point of the whole module: every reader of a key sees one value. Two independent
  // `useState`s seeded from storage (the previous design) diverged here - the second kept
  // whatever it read on mount, forever.
  it("notifies every subscriber of a key when it changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribePersistent("shared", first);
    subscribePersistent("shared", second);

    writePersistent("shared", "true");

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(readPersistent("shared")).toBe("true");
  });

  it("does not notify subscribers of other keys", () => {
    const other = vi.fn();
    subscribePersistent("other", other);
    writePersistent("shared", "true");
    expect(other).not.toHaveBeenCalled();
  });

  it("does not notify when the value is unchanged", () => {
    writePersistent("k", "same");
    const listener = vi.fn();
    subscribePersistent("k", listener);

    writePersistent("k", "same");
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePersistent("k", listener);
    unsubscribe();
    writePersistent("k", "value");
    expect(listener).not.toHaveBeenCalled();
  });

  // Private mode: storage throws, but the session must still work.
  it("keeps the value in memory when storage throws", () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    resetPersistentCache();

    const listener = vi.fn();
    subscribePersistent("k", listener);
    writePersistent("k", "in-memory");

    expect(readPersistent("k")).toBe("in-memory");
    expect(listener).toHaveBeenCalledOnce();
  });
});

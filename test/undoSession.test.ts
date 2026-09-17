/**
 * DAW-34 stage E: the undo/redo stacks are per-tab session state, not project data.
 *
 * They were `undo.json` in the bundle, which made them durable and shared. Neither is right: a redo
 * can never be invalid (it names a tombstone, and lifting one is always well-defined), so it needs
 * no permanence; and two tabs on one project would fight over a single list.
 */
import { describe, expect, it } from "vitest";
import { clearUndoSession, readUndoSession, writeUndoSession, type SessionStore } from "../src/audio/undoSession";

/** A `sessionStorage` stand-in, since the unit suite runs without a DOM. */
function fakeStore(initial: Record<string, string> = {}): SessionStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => void (data[key] = value),
    removeItem: (key) => void delete data[key],
  };
}

/** A store that throws on every access, as a private window or blocked site data does. */
const hostileStore = (): SessionStore => ({
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
});

describe("the per-tab undo store", () => {
  it("round-trips the two stacks, keyed by project", () => {
    const store = fakeStore();
    writeUndoSession("p-1", { undo: ["a", "b"], redo: ["c"] }, store);
    writeUndoSession("p-2", { undo: ["z"], redo: [] }, store);

    expect(readUndoSession("p-1", store)).toEqual({ undo: ["a", "b"], redo: ["c"] });
    expect(readUndoSession("p-2", store)).toEqual({ undo: ["z"], redo: [] });
  });

  it("reads as absent for a project it holds nothing for, so a fresh tab can derive instead", () => {
    expect(readUndoSession("p-unknown", fakeStore())).toBeNull();
  });

  it("forgets a project on request, so a re-created id does not inherit a stack", () => {
    const store = fakeStore();
    writeUndoSession("p-1", { undo: ["a"], redo: [] }, store);
    clearUndoSession("p-1", store);

    expect(readUndoSession("p-1", store)).toBeNull();
  });

  // Stored text is not to be trusted: it survives across app versions, and a shape change here
  // must cost one tab's undo rather than the project failing to open.
  it("treats unreadable or out-of-shape content as absent", () => {
    expect(readUndoSession("p-1", fakeStore({ "web-daw:undo:p-1": "{ not json at all" }))).toBeNull();
    // The shape an older build wrote: seqs rather than ids.
    expect(
      readUndoSession("p-1", fakeStore({ "web-daw:undo:p-1": JSON.stringify({ undo: [0, 1], redo: [] }) })),
    ).toEqual({ undo: [], redo: [] });
    // And the shape before that: a base snapshot and steps.
    expect(
      readUndoSession("p-1", fakeStore({ "web-daw:undo:p-1": JSON.stringify({ undo: { base: null }, redo: null }) })),
    ).toEqual({ undo: [], redo: [] });
  });

  // Undo being unavailable must never stop a project from opening, and these throw rather than
  // returning null in a private window or with site data blocked.
  it("survives a store that throws on every access", () => {
    const hostile = hostileStore();
    expect(readUndoSession("p-1", hostile)).toBeNull();
    expect(() => writeUndoSession("p-1", { undo: ["a"], redo: [] }, hostile)).not.toThrow();
    expect(() => clearUndoSession("p-1", hostile)).not.toThrow();
  });

  it("does nothing at all where there is no window, rather than throwing", () => {
    expect(readUndoSession("p-1", null)).toBeNull();
    expect(() => writeUndoSession("p-1", { undo: [], redo: [] }, null)).not.toThrow();
  });
});

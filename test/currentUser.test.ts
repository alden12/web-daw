import { afterEach, describe, expect, it } from "vitest";
import { readCurrentUser, writeCurrentUser, subscribeCurrentUser, DEFAULT_USER } from "../src/ui/currentUser";

// The unit env is node (no localStorage): the store degrades to its in-memory `cached` value, which is
// what these assert. Reset it between cases so module-level state doesn't leak.
afterEach(() => {
  writeCurrentUser(DEFAULT_USER);
});

describe("currentUser store", () => {
  it("defaults to the solo user", () => {
    writeCurrentUser("");
    expect(readCurrentUser()).toBe(DEFAULT_USER);
  });

  it("sets, trims, and bounds a chosen id", () => {
    writeCurrentUser("  alice  ");
    expect(readCurrentUser()).toBe("alice");
    expect(readCurrentUser()).toBe("alice"); // stable reference across reads
  });

  it("resets an empty id to the default", () => {
    writeCurrentUser("bob");
    writeCurrentUser("   ");
    expect(readCurrentUser()).toBe(DEFAULT_USER);
  });

  it("notifies subscribers on change", () => {
    let hits = 0;
    const unsubscribe = subscribeCurrentUser(() => hits++);
    writeCurrentUser("carol");
    expect(hits).toBe(1);
    unsubscribe();
    writeCurrentUser("dave");
    expect(hits).toBe(1); // no longer notified
  });
});

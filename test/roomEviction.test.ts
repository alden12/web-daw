/**
 * Rooms opened without anyone joining them - the hosted MCP server's, which edits through a room but
 * is not a connected client - are dropped once idle, so they do not pile up in memory until a restart.
 */
import { describe, expect, it } from "vitest";
import { makeSyncEnv, seedEdits } from "./support/syncEnv";
import { RoomRegistry, type RoomClient } from "../server/api/rooms";

const IDLE_MS = 10 * 60 * 1000;
const owner = { userId: "local" };

async function registryWithClock() {
  const { db } = await makeSyncEnv();
  await seedEdits(db, "p1", 1);
  let time = 0;
  const registry = new RoomRegistry(db, { idleMs: IDLE_MS, sweepMs: 0, now: () => time });
  return { registry, advance: (ms: number) => void (time += ms) };
}

describe("idle rooms", () => {
  it("drops a room nobody joined once it has gone unused, and loads it back on the next use", async () => {
    const { registry, advance } = await registryWithClock();
    const first = await registry.get("p1", owner);

    advance(IDLE_MS);
    await registry.sweep();
    const next = await registry.get("p1", owner);

    expect(next).not.toBeNull();
    expect(next).not.toBe(first); // a fresh load
    expect(next!.snapshot()).toEqual(first!.snapshot()); // of the same project
  });

  it("keeps a room that was used within the idle time", async () => {
    const { registry, advance } = await registryWithClock();
    const first = await registry.get("p1", owner);

    advance(IDLE_MS - 1);
    await registry.sweep();

    expect(await registry.get("p1", owner)).toBe(first);
  });

  it("each use restarts the clock, so an agent working steadily keeps its room", async () => {
    const { registry, advance } = await registryWithClock();
    const first = await registry.get("p1", owner);

    advance(IDLE_MS - 1);
    await registry.get("p1", owner);
    advance(IDLE_MS - 1);
    await registry.sweep();

    expect(await registry.get("p1", owner)).toBe(first);
  });

  it("never drops a room someone is connected to, however long it sits", async () => {
    const { registry, advance } = await registryWithClock();
    const room = (await registry.get("p1", owner))!;
    const tab: RoomClient = { send: () => {} };
    await room.subscribe(tab);

    advance(IDLE_MS * 10);
    await registry.sweep();

    expect(await registry.get("p1", owner)).toBe(room);
  });
});

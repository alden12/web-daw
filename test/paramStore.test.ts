/** ParamStore.reschema: how a track's settings survive its custom device being edited. */
import { describe, it, expect } from "vitest";
import { ParamStore } from "../src/audio/params/store";
import type { ParamSchema } from "../src/audio/params/types";

const level = { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 } as const;
const tone = { id: "tone", label: "Tone", kind: "number", min: 0, max: 100, default: 50 } as const;

describe("ParamStore.reschema", () => {
  it("keeps surviving values, starts new params at their default, and drops removed ones", () => {
    const store = new ParamStore([level, tone]);
    store.set("level", 0.3);
    store.set("tone", 70);
    const drive = { id: "drive", label: "Drive", kind: "number", min: 0, max: 1, default: 0.1 } as const;
    store.reschema([level, drive]);
    expect(store.snapshot()).toEqual({ level: 0.3, drive: 0.1 });
    expect(store.has("tone")).toBe(false);
  });

  it("fits a kept value to its new range", () => {
    const store = new ParamStore([tone]);
    store.set("tone", 90);
    store.reschema([{ ...tone, max: 60 }]);
    expect(store.get("tone")).toBe(60);
  });

  it("tells subscribers about each value that changed, and nothing for an unchanged schema", () => {
    const schema: ParamSchema = [level, tone];
    const store = new ParamStore(schema);
    store.set("tone", 90);
    const heard: [string, unknown][] = [];
    store.subscribe((id, value) => heard.push([id, value]));
    store.reschema([level, { ...tone, max: 60 }]);
    expect(heard).toEqual([["tone", 60]]);
    store.reschema([level, { ...tone, max: 60 }]);
    expect(heard).toHaveLength(1);
  });
});

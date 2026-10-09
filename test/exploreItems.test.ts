import { describe, expect, it } from "vitest";
import { exploreItems, matchesQuery, tagsIn, type ExploreItem } from "../src/ui/explore/exploreItems";
import { pickableInstrumentInfos } from "../src/audio/instruments/catalog";
import { effectInfos } from "../src/audio/effects/catalog";
import { midiDeviceInfos } from "../src/audio/midi/device/catalog";
import { FACTORY_PATCHES } from "../src/audio/patches/factory";
import type { Patch } from "../src/audio/patches/library";

const saved: Patch = {
  id: "mine",
  name: "My Bass",
  author: "you",
  instrumentType: "nimbus",
  params: {},
  effects: [],
  createdAt: 1,
};

const items = exploreItems({ savedPatches: [saved], samples: [{ id: "kick", name: "Kick 01" }] });
const named = (name: string) => items.find((item) => item.name === name) as ExploreItem;

describe("exploreItems", () => {
  it("iterates the catalogs rather than listing devices", () => {
    const count = (category: ExploreItem["category"]) => items.filter((item) => item.category === category).length;
    expect(count("instruments")).toBe(pickableInstrumentInfos().length);
    expect(count("effects")).toBe(effectInfos().length);
    expect(count("midi")).toBe(midiDeviceInfos().length);
    expect(count("patches")).toBe(FACTORY_PATCHES.length + 1);
    expect(count("samples")).toBe(1);
  });

  it("tags every built-in, so none is invisible to a tag filter", () => {
    const untagged = items.filter((item) => item.builtin && item.tags.length === 0).map((item) => item.name);
    expect(untagged).toEqual([]);
  });

  it("marks what is yours as not built-in", () => {
    expect(named("My Bass").builtin).toBe(false);
    expect(named("Kick 01").builtin).toBe(false);
    expect(named("Reverb").builtin).toBe(true);
  });
});

describe("matchesQuery", () => {
  it("matches a name or a tag, every word", () => {
    expect(matchesQuery(named("Glass Pad"), "glass")).toBe(true);
    expect(matchesQuery(named("Glass Pad"), "airy")).toBe(true);
    expect(matchesQuery(named("Glass Pad"), "glass bass")).toBe(false);
  });

  it("matches only tags for a #word", () => {
    expect(matchesQuery(named("Deep Sub"), "#bass")).toBe(true);
    // "My Bass" has bass in its name but no tag.
    expect(matchesQuery(named("My Bass"), "#bass")).toBe(false);
    expect(matchesQuery(named("My Bass"), "bass")).toBe(true);
  });
});

describe("tagsIn", () => {
  it("offers only tags that something carries, in vocabulary order", () => {
    expect(tagsIn([named("Reverb"), named("Distortion")])).toEqual(["space", "gritty", "airy", "lush", "aggressive"]);
    expect(tagsIn([named("Kick 01")])).toEqual([]);
  });
});

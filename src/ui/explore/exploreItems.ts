/**
 * Explore's contents as data (COMM-1.9.1): every device you can take, flattened into one list of
 * items, each in a category. Built from the catalogs, factory patches, your saved patches and the
 * project's samples, never a hardcoded list, so a newly registered device shows up here on its
 * own. Published devices (COMM-1.9.2 on) join the same list later.
 *
 * Pure: the component supplies the live inputs (saved patches, samples) and decides what a pick
 * does from the item's `source`.
 */
import { pickableInstrumentInfos } from "../../audio/instruments/catalog";
import { effectInfos } from "../../audio/effects/catalog";
import { midiDeviceInfos } from "../../audio/midi/device/catalog";
import { FACTORY_PATCHES } from "../../audio/patches/factory";
import type { Patch } from "../../audio/patches/library";
import { TAG_KEYS, type Tag } from "../../audio/tags";

export type ExploreCategory = "favourites" | "instruments" | "patches" | "effects" | "midi" | "samples";
export type ItemCategory = Exclude<ExploreCategory, "favourites">;

/**
 * The tiles, in the order the home grid lays them out. `hue` tints the placeholder artwork until
 * sound portraits arrive (COMM-1.9.2); `kind` is the short label a row in mixed results carries.
 */
export const CATEGORIES: Record<ExploreCategory, { label: string; kind: string; hue: number }> = {
  favourites: { label: "Favourites", kind: "Favourite", hue: 345 },
  instruments: { label: "Instruments", kind: "Instrument", hue: 178 },
  patches: { label: "Patches", kind: "Patch", hue: 205 },
  effects: { label: "Effects", kind: "Effect", hue: 14 },
  midi: { label: "MIDI devices", kind: "MIDI", hue: 262 },
  samples: { label: "Samples", kind: "Sample", hue: 38 },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES) as ExploreCategory[];

/** Where an item came from, which is also what picking it does. */
export type ItemSource =
  | { kind: "instrument"; type: string }
  | { kind: "patch"; patch: Patch }
  | { kind: "effect"; type: string }
  | { kind: "midi"; type: string }
  | { kind: "sample"; id: string };

export interface ExploreItem {
  key: string;
  category: ItemCategory;
  name: string;
  /** The line under the name: what it is, or whose. */
  meta: string;
  tags: readonly Tag[];
  /** Shipped with the app, so it cannot be deleted. */
  builtin: boolean;
  source: ItemSource;
}

export function exploreItems({
  savedPatches,
  samples,
}: {
  savedPatches: Patch[];
  samples: { id: string; name: string }[];
}): ExploreItem[] {
  const instruments = pickableInstrumentInfos();
  const instrumentLabel = (type: string) => instruments.find((info) => info.type === type)?.label ?? type;
  return [
    ...instruments.map(
      (info): ExploreItem => ({
        key: `instrument:${info.type}`,
        category: "instruments",
        name: info.label,
        meta: "Instrument",
        tags: info.tags ?? [],
        builtin: true,
        source: { kind: "instrument", type: info.type },
      }),
    ),
    ...[...FACTORY_PATCHES, ...savedPatches].map(
      (patch): ExploreItem => ({
        key: `patch:${patch.id}`,
        category: "patches",
        name: patch.name,
        meta: patch.builtin
          ? `${instrumentLabel(patch.instrumentType)} · ${patch.category}`
          : `${instrumentLabel(patch.instrumentType)} · yours`,
        tags: patch.tags ?? [],
        builtin: !!patch.builtin,
        source: { kind: "patch", patch },
      }),
    ),
    ...effectInfos().map(
      (info): ExploreItem => ({
        key: `effect:${info.type}`,
        category: "effects",
        name: info.label,
        meta: "Audio effect",
        tags: info.tags ?? [],
        builtin: true,
        source: { kind: "effect", type: info.type },
      }),
    ),
    ...midiDeviceInfos().map(
      (info): ExploreItem => ({
        key: `midi:${info.type}`,
        category: "midi",
        name: info.label,
        meta: "MIDI device",
        tags: info.tags ?? [],
        builtin: true,
        source: { kind: "midi", type: info.type },
      }),
    ),
    ...samples.map(
      (sample): ExploreItem => ({
        key: `sample:${sample.id}`,
        category: "samples",
        name: sample.name,
        meta: "In this project",
        tags: [],
        builtin: false,
        source: { kind: "sample", id: sample.id },
      }),
    ),
  ];
}

/**
 * Search: every word must match the name or a tag. A word written `#warm` matches only a tag, so
 * a tag search is not tripped up by a device that happens to have the word in its name.
 */
export function matchesQuery(item: ExploreItem, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) =>
    word.startsWith("#")
      ? item.tags.some((tag) => tag.startsWith(word.slice(1)))
      : item.name.toLowerCase().includes(word) || item.tags.some((tag) => tag.startsWith(word)),
  );
}

/** The tags at least one of `items` carries, in vocabulary order: the chips worth offering. */
export const tagsIn = (items: ExploreItem[]): Tag[] =>
  TAG_KEYS.filter((tag) => items.some((item) => item.tags.includes(tag)));

export const byName = (left: ExploreItem, right: ExploreItem) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

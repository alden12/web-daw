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
import { byTagOrder, type Tag } from "../../audio/tags";
import { PORTRAIT_KEYS } from "../../audio/portraits/keys";
import type { Portrait } from "../../audio/portraits/draw";
import PORTRAITS from "./portraits.json";

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
  /**
   * Its sound portrait (COMM-1.9.2), drawn from a render of it. Built-ins have one from
   * `portraits.json` (`yarn portraits`); your patches and samples do not yet, and show the
   * category's glyph instead.
   */
  portrait?: Portrait;
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
  const items: ExploreItem[] = [
    ...instruments.map(
      (info): ExploreItem => ({
        key: PORTRAIT_KEYS.instrument(info.type),
        category: "instruments",
        name: info.label,
        meta: info.custom ? "Instrument · custom" : "Instrument",
        tags: info.tags ?? [],
        builtin: !info.custom,
        source: { kind: "instrument", type: info.type },
      }),
    ),
    ...[...FACTORY_PATCHES, ...savedPatches].map(
      (patch): ExploreItem => ({
        key: PORTRAIT_KEYS.patch(patch.id),
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
        key: PORTRAIT_KEYS.effect(info.type),
        category: "effects",
        name: info.label,
        meta: info.custom ? "Audio effect · custom" : "Audio effect",
        tags: info.tags ?? [],
        builtin: !info.custom,
        source: { kind: "effect", type: info.type },
      }),
    ),
    ...midiDeviceInfos().map(
      (info): ExploreItem => ({
        key: PORTRAIT_KEYS.midi(info.type),
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
  return items.map((item) => ({ ...item, portrait: (PORTRAITS as Record<string, Portrait>)[item.key] }));
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

/** Every tag `items` carry, known ones first in vocabulary order, then the rest A to Z. */
export const tagsIn = (items: ExploreItem[]): Tag[] =>
  [...new Set(items.flatMap((item) => item.tags))].sort(byTagOrder);

/** Whether an item carries every one of `tags` (picked chips narrow together). */
export const hasTags = (item: ExploreItem, tags: readonly Tag[]) => tags.every((tag) => item.tags.includes(tag));

/** How many unpicked chips the row offers before "More tags". */
export const CHIP_LIMIT = 8;

/**
 * The chips worth offering for `items`, the list on screen: the picked ones first, so what is
 * filtering is always in view, then the tags that best **split** the list.
 *
 * A tag's score is the smaller side of the cut it makes, so one on half the items scores highest,
 * and one on every item (which narrows nothing) or on none scores zero and is left out. Picking a
 * tag shrinks the list, so the row re-ranks to the tags that go with it: drilling down rather than
 * a flat menu. Ties keep `tagsIn`'s order (the sort is stable), which puts known roles first.
 *
 * Counting is a pass per tag over what is on screen, cheap at any size this list will reach. The
 * published catalogue (COMM-1.9.2 on) moves the counting server-side, and usage (COMM-1.2's
 * events) can then rank by what people actually take rather than by the split alone.
 */
export function rankTags(items: ExploreItem[], picked: readonly Tag[], limit = CHIP_LIMIT): Tag[] {
  const split = (tag: Tag) => {
    const count = items.filter((item) => item.tags.includes(tag)).length;
    return Math.min(count, items.length - count);
  };
  const offered = tagsIn(items)
    .filter((tag) => !picked.includes(tag))
    .map((tag) => ({ tag, score: split(tag) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ tag }) => tag);
  return [...picked, ...offered];
}

export const byName = (left: ExploreItem, right: ExploreItem) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

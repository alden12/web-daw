/**
 * How you have arranged the chord pads (MOBILE-12): which variations come first, which are hidden,
 * and which are favourites. Pure, so every edit is a function from one arrangement to the next and
 * the pads, their tests and a later agent tool all read it the same way.
 *
 * **Two layers.** A global order and hidden set that every column follows, and per-column overrides
 * for a degree you have rearranged on its own - the ii chord wanting sus2 first, say. A column is
 * **keyed by degree, not by note**, so an arrangement follows you into any key, the way the pads are
 * labelled by interval. An "All" change reaches every column, the rearranged ones included (it would
 * be a strange "all" that skipped the columns you had touched), and "Reset column" hands one back
 * to the global order.
 *
 * **Favourites** are per degree and family. Starring one moves it to the front of its column (a
 * favourite you have to raise the sheet to reach is not much of one) and tints its pad; the tint is
 * the favourite, the move is only a convenience you can undo with the arrows.
 *
 * **Three ways to arrange them, chosen per browser: Popular, Type and Custom** (`ChordArrangeSettings`).
 * Popular is curated per degree (chordPopular.ts), Type is one order for every column, and Custom is
 * yours, **per scale** - a minor key's columns want different things from a major key's, so an
 * arrangement made in one does not rearrange the other. Editing while on Popular or Type switches to
 * Custom, starting from what was on show, so nothing jumps.
 */
import { z } from "zod";
import {
  CHORD_FAMILIES,
  DEFAULT_CHORD_ORDER,
  arrangementFor,
  favouriteKey,
  type ChordArrangement,
  type ChordFamily,
  type ChordPrefs,
} from "./chords";
import { completeOrder, popularPrefs } from "./chordPopular";
import { SCALE_NAMES, type ScaleName } from "./scales";

export const DEFAULT_CHORD_PREFS: ChordPrefs = { order: DEFAULT_CHORD_ORDER, hidden: [], columns: {}, favourites: [] };

/** Which order a move or a hide edits: the chord's own column, or every column's default. */
export type ChordScope = "column" | "all";

/** Swap `family` with `other` (the chord beside it in the column) in the order `scope` names. */
export function swapFamilies(
  prefs: ChordPrefs,
  degree: number,
  family: ChordFamily,
  other: ChordFamily,
  scope: ChordScope,
): ChordPrefs {
  const swap = (order: ChordFamily[]) =>
    order.map((entry) => (entry === family ? other : entry === other ? family : entry));
  return edit(prefs, degree, scope, (arrangement) => ({ ...arrangement, order: swap(arrangement.order) }));
}

export function setHidden(
  prefs: ChordPrefs,
  degree: number,
  family: ChordFamily,
  hidden: boolean,
  scope: ChordScope,
): ChordPrefs {
  return edit(prefs, degree, scope, (arrangement) => ({
    ...arrangement,
    hidden: hidden
      ? [...arrangement.hidden.filter((entry) => entry !== family), family]
      : arrangement.hidden.filter((entry) => entry !== family),
  }));
}

/** Star or unstar a chord. Starring a variation also moves it to the front of its column. */
export function toggleFavourite(prefs: ChordPrefs, degree: number, family: ChordFamily | "triad"): ChordPrefs {
  const key = favouriteKey(degree, family);
  if (prefs.favourites.includes(key))
    return { ...prefs, favourites: prefs.favourites.filter((entry) => entry !== key) };
  const starred = { ...prefs, favourites: [...prefs.favourites, key] };
  if (family === "triad") return starred;
  return edit(starred, degree, "column", (arrangement) => ({
    ...arrangement,
    order: [family, ...arrangement.order.filter((entry) => entry !== family)],
  }));
}

/** Hand a column back to how `base` (the arrangement a Custom one started from) has it. */
export function resetColumn(prefs: ChordPrefs, degree: number, base: ChordPrefs = DEFAULT_CHORD_PREFS): ChordPrefs {
  const others = Object.entries(prefs.columns).filter(([column]) => Number(column) !== degree);
  const baseColumn = base.columns[degree];
  return {
    ...prefs,
    columns: Object.fromEntries(baseColumn ? [...others, [degree, baseColumn]] : others),
    favourites: prefs.favourites.filter((key) => !key.startsWith(`${degree}:`)),
  };
}

/** Apply `change` to the column's own arrangement (creating it from the global one), or to the
 *  global one and every column's own. */
function edit(
  prefs: ChordPrefs,
  degree: number,
  scope: ChordScope,
  change: (arrangement: ChordArrangement) => ChordArrangement,
): ChordPrefs {
  if (scope === "all")
    return {
      ...prefs,
      ...change({ order: prefs.order, hidden: prefs.hidden }),
      columns: Object.fromEntries(Object.entries(prefs.columns).map(([column, own]) => [column, change(own)])),
    };
  return { ...prefs, columns: { ...prefs.columns, [degree]: change(arrangementFor(prefs, degree)) } };
}

/** How the chords are arranged: a curated order per degree, one order for all, or your own. */
export const CHORD_ARRANGE_MODES = ["popular", "type", "custom"] as const;
export type ChordArrangeMode = (typeof CHORD_ARRANGE_MODES)[number];
/** What a Custom arrangement started from, so "Reset column" hands a column back to it. */
export type ChordArrangeBase = Exclude<ChordArrangeMode, "custom">;

export interface ChordArrangeSettings {
  mode: ChordArrangeMode;
  /** Your arrangements, per scale, each with what it started from. */
  custom: Partial<Record<ScaleName, { from: ChordArrangeBase; prefs: ChordPrefs }>>;
}

export const DEFAULT_ARRANGE_SETTINGS: ChordArrangeSettings = { mode: "popular", custom: {} };

/** The arrangement a base names, for a scale. */
export const basePrefs = (base: ChordArrangeBase, scale: ScaleName): ChordPrefs =>
  base === "type" ? DEFAULT_CHORD_PREFS : popularPrefs(scale);

/** What a Custom arrangement for `scale` starts from (or started from). */
export const customBase = (settings: ChordArrangeSettings, scale: ScaleName): ChordArrangeBase =>
  settings.custom[scale]?.from ?? (settings.mode === "type" ? "type" : "popular");

/** The arrangement on show for a scale. Custom with nothing saved for it is Popular, untouched. */
export function prefsFor(settings: ChordArrangeSettings, scale: ScaleName): ChordPrefs {
  if (settings.mode !== "custom") return basePrefs(settings.mode, scale);
  return settings.custom[scale]?.prefs ?? basePrefs(customBase(settings, scale), scale);
}

/** Save an edit as the scale's Custom arrangement, switching to Custom if it was not already. */
export function customise(settings: ChordArrangeSettings, scale: ScaleName, prefs: ChordPrefs): ChordArrangeSettings {
  return { mode: "custom", custom: { ...settings.custom, [scale]: { from: customBase(settings, scale), prefs } } };
}

/** Forget a scale's Custom arrangement: it goes back to what it started from. */
export function resetScale(settings: ChordArrangeSettings, scale: ScaleName): ChordArrangeSettings {
  const { [scale]: forgotten, ...custom } = settings.custom;
  return { mode: forgotten?.from ?? settings.mode, custom };
}

const family = z.enum(Object.keys(CHORD_FAMILIES) as [ChordFamily, ...ChordFamily[]]);
const arrangement = z.object({ order: z.array(family), hidden: z.array(family) });
const prefsSchema = z.object({
  order: z.array(family),
  hidden: z.array(family),
  columns: z.record(z.string(), arrangement),
  favourites: z.array(z.string()),
});
// Keyed by any string and filtered to real scale names on read: a record keyed by an enum would
// demand every scale, and one removed later should be dropped rather than fail the whole setting.
const settingsSchema = z.object({
  mode: z.enum(CHORD_ARRANGE_MODES),
  custom: z.record(z.string(), z.object({ from: z.enum(["popular", "type"]), prefs: prefsSchema })),
});

/** A stored arrangement made whole: an order missing a family (one added since it was saved) gets
 *  it on the end, so a new family is offered rather than lost. */
function complete(prefs: z.infer<typeof prefsSchema>): ChordPrefs {
  const columns = Object.fromEntries(
    Object.entries(prefs.columns).map(([degree, column]) => [
      Number(degree),
      { ...column, order: completeOrder(column.order) },
    ]),
  );
  return { ...prefs, order: completeOrder(prefs.order), columns };
}

/**
 * Read the stored arrangement settings, which come from this browser's storage and so from any
 * version of the app: anything unreadable is the defaults. A single arrangement from before there
 * were modes (the first chord-arranging build) becomes the Custom one for the major scale.
 */
export function parseChordArrangeSettings(raw: string | null): ChordArrangeSettings {
  if (raw === null) return DEFAULT_ARRANGE_SETTINGS;
  try {
    const json: unknown = JSON.parse(raw);
    const settings = settingsSchema.safeParse(json);
    if (settings.success)
      return {
        mode: settings.data.mode,
        custom: Object.fromEntries(
          Object.entries(settings.data.custom)
            .filter(([scale]) => (SCALE_NAMES as string[]).includes(scale))
            .map(([scale, entry]) => [scale, { ...entry, prefs: complete(entry.prefs) }]),
        ),
      };
    const single = prefsSchema.safeParse(json);
    return single.success
      ? { mode: "custom", custom: { major: { from: "type", prefs: complete(single.data) } } }
      : DEFAULT_ARRANGE_SETTINGS;
  } catch {
    return DEFAULT_ARRANGE_SETTINGS;
  }
}

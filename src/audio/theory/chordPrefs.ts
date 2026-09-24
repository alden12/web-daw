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

export function resetColumn(prefs: ChordPrefs, degree: number): ChordPrefs {
  return {
    ...prefs,
    columns: Object.fromEntries(Object.entries(prefs.columns).filter(([column]) => Number(column) !== degree)),
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

const family = z.enum(Object.keys(CHORD_FAMILIES) as [ChordFamily, ...ChordFamily[]]);
const arrangement = z.object({ order: z.array(family), hidden: z.array(family) });
const prefsSchema = z.object({
  order: z.array(family),
  hidden: z.array(family),
  columns: z.record(z.string(), arrangement),
  favourites: z.array(z.string()),
});

/**
 * Read stored prefs, which come from this browser's storage and so from any version of the app:
 * anything unreadable is the defaults. An order missing a family (one added since it was saved)
 * gets it on the end, so a new family is offered rather than lost.
 */
export function parseChordPrefs(raw: string | null): ChordPrefs {
  if (raw === null) return DEFAULT_CHORD_PREFS;
  try {
    const parsed = prefsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_CHORD_PREFS;
    const complete = (order: ChordFamily[]) => [
      ...order,
      ...DEFAULT_CHORD_ORDER.filter((entry) => !order.includes(entry)),
    ];
    const columns = Object.fromEntries(
      Object.entries(parsed.data.columns).map(([degree, column]) => [
        Number(degree),
        { ...column, order: complete(column.order) },
      ]),
    );
    return { ...parsed.data, order: complete(parsed.data.order), columns };
  } catch {
    return DEFAULT_CHORD_PREFS;
  }
}

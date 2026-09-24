import { describe, expect, it } from "vitest";
import { chordRows, type ChordPrefs } from "../src/audio/theory/chords";
import {
  DEFAULT_CHORD_PREFS,
  parseChordPrefs,
  resetColumn,
  setHidden,
  swapFamilies,
  toggleFavourite,
} from "../src/audio/theory/chordPrefs";

/** C major from C3; returns each column's chord names, low to high. */
const columns = (prefs: ChordPrefs, editing = false) => {
  const rows = chordRows({ tonic: 0, scale: "major", lowOctave: 3, prefs, editing });
  return rows[0].map((_base, column) => rows.flatMap((row) => (row[column] ? [row[column]!.name] : [])));
};

const II = 1; // the ii chord's degree

describe("chord arrangement", () => {
  it("moves a chord within its own column only, leaving the others on the global order", () => {
    const prefs = swapFamilies(DEFAULT_CHORD_PREFS, II, "sus2", "sus4", "column");
    const [tonic, second] = columns(prefs);
    expect(second.slice(0, 4)).toEqual(["Dm", "Dm7", "Dsus2", "Dsus4"]);
    expect(tonic.slice(0, 4)).toEqual(["C", "Cmaj7", "Csus4", "Csus2"]);
  });

  it("moves it in every column when the scope is all", () => {
    const prefs = swapFamilies(DEFAULT_CHORD_PREFS, II, "sus2", "sus4", "all");
    expect(columns(prefs)[0].slice(0, 4)).toEqual(["C", "Cmaj7", "Csus2", "Csus4"]);
  });

  it("makes an All change in a rearranged column too, keeping the rest of its arrangement", () => {
    const own = swapFamilies(DEFAULT_CHORD_PREFS, II, "sus2", "sus4", "column");
    const later = swapFamilies(own, 0, "seventh", "sus4", "all");
    const [tonic, second] = columns(later);
    expect(tonic.slice(1, 4)).toEqual(["Csus4", "Cmaj7", "Csus2"]);
    expect(second.slice(1, 4)).toEqual(["Dsus4", "Dsus2", "Dm7"]);
  });

  it("hides a chord, and lays it out again (flagged) while editing so it can be shown", () => {
    const prefs = setHidden(DEFAULT_CHORD_PREFS, II, "seventh", true, "column");
    expect(columns(prefs)[1]).not.toContain("Dm7");
    const editing = chordRows({ tonic: 0, scale: "major", lowOctave: 3, prefs, editing: true });
    expect(editing[1][1]).toMatchObject({ name: "Dm7", hidden: true });
    expect(columns(setHidden(prefs, II, "seventh", false, "column"))[1]).toContain("Dm7");
  });

  it("stars a chord: tints it and moves it to the front of its column", () => {
    const prefs = toggleFavourite(DEFAULT_CHORD_PREFS, II, "add9");
    const rows = chordRows({ tonic: 0, scale: "major", lowOctave: 3, prefs });
    expect(rows[1][1]).toMatchObject({ name: "Dmadd9", favourite: true });
    // Unstarring takes the tint off and leaves it where it is.
    const unstarred = chordRows({ tonic: 0, scale: "major", lowOctave: 3, prefs: toggleFavourite(prefs, II, "add9") });
    expect(unstarred[1][1]).toMatchObject({ name: "Dmadd9", favourite: false });
  });

  it("stars the closing tonic with the first, since they are the same degree", () => {
    const rows = chordRows({
      tonic: 0,
      scale: "major",
      lowOctave: 3,
      prefs: toggleFavourite(DEFAULT_CHORD_PREFS, 0, "triad"),
    });
    expect(rows[0][0]?.favourite).toBe(true);
    expect(rows[0][7]?.favourite).toBe(true);
  });

  it("resets a column to the global order, favourites and all", () => {
    const edited = toggleFavourite(swapFamilies(DEFAULT_CHORD_PREFS, II, "sus2", "sus4", "column"), II, "add9");
    const reset = resetColumn(edited, II);
    expect(columns(reset)[1]).toEqual(columns(DEFAULT_CHORD_PREFS)[1]);
    expect(reset.favourites).toEqual([]);
  });
});

describe("parseChordPrefs", () => {
  it("round-trips what it is given", () => {
    const prefs = toggleFavourite(setHidden(DEFAULT_CHORD_PREFS, II, "power", true, "all"), II, "add9");
    expect(parseChordPrefs(JSON.stringify(prefs))).toEqual(prefs);
  });

  it("falls back to the defaults for anything unreadable", () => {
    expect(parseChordPrefs(null)).toEqual(DEFAULT_CHORD_PREFS);
    expect(parseChordPrefs("not json")).toEqual(DEFAULT_CHORD_PREFS);
    expect(parseChordPrefs(JSON.stringify({ order: ["nonsense"] }))).toEqual(DEFAULT_CHORD_PREFS);
  });

  it("adds a family missing from a saved order on the end, so a new one is offered", () => {
    const saved = { ...DEFAULT_CHORD_PREFS, order: ["sus2", "seventh"] };
    const parsed = parseChordPrefs(JSON.stringify(saved));
    expect(parsed.order.slice(0, 2)).toEqual(["sus2", "seventh"]);
    expect(new Set(parsed.order)).toEqual(new Set(DEFAULT_CHORD_PREFS.order));
  });
});

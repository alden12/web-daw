import { describe, expect, it } from "vitest";
import { chordRows, type ChordPrefs } from "../src/audio/theory/chords";
import {
  DEFAULT_ARRANGE_SETTINGS,
  DEFAULT_CHORD_PREFS,
  customise,
  parseChordArrangeSettings,
  prefsFor,
  resetColumn,
  resetScale,
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

describe("arranging by Popular, Type or Custom", () => {
  it("starts on Popular, whose columns each lead with their own favourites", () => {
    const prefs = prefsFor(DEFAULT_ARRANGE_SETTINGS, "major");
    const [tonic, second, third, , fifth] = columns(prefs);
    expect(tonic[1]).toBe("Cmaj7");
    expect(second.slice(1, 3)).toEqual(["Dm7", "D"]); // the ii's m7, then V of V
    expect(third[1]).toBe("E"); // V of vi, pop's way into the relative minor
    expect(fifth.slice(1, 3)).toEqual(["G7", "Gsus4"]);
  });

  it("gives a minor key's V its major chord first, the cadence it wants", () => {
    const prefs = prefsFor(DEFAULT_ARRANGE_SETTINGS, "minor");
    const rows = chordRows({ tonic: 9, scale: "minor", lowOctave: 3, prefs });
    expect(rows[0][4]?.name).toBe("Em");
    expect(rows[1][4]?.name).toBe("E");
    expect(rows[2][4]?.name).toBe("E7");
  });

  it("lines a pentatonic up by interval, so its V gets the V's list", () => {
    const prefs = prefsFor(DEFAULT_ARRANGE_SETTINGS, "major pentatonic");
    const rows = chordRows({ tonic: 0, scale: "major pentatonic", lowOctave: 3, prefs });
    // G is the pentatonic's fourth note; with no triad it stands on Gsus4, and G's list comes next.
    expect(rows[0][3]?.name).toBe("Gsus4");
  });

  it("uses one order for every column on Type", () => {
    const prefs = prefsFor({ ...DEFAULT_ARRANGE_SETTINGS, mode: "type" }, "major");
    expect(prefs).toEqual(DEFAULT_CHORD_PREFS);
  });

  it("switches to Custom on an edit, starting from what was on show, per scale", () => {
    const popular = prefsFor(DEFAULT_ARRANGE_SETTINGS, "major");
    const edited = customise(DEFAULT_ARRANGE_SETTINGS, "major", toggleFavourite(popular, II, "add9"));
    expect(edited.mode).toBe("custom");
    expect(columns(prefsFor(edited, "major"))[1][1]).toBe("Dmadd9");
    // Other scales are untouched: a Custom scale with nothing saved is its Popular arrangement.
    expect(prefsFor(edited, "minor")).toEqual(prefsFor(DEFAULT_ARRANGE_SETTINGS, "minor"));
  });

  it("resets a column to what the Custom arrangement started from", () => {
    const popular = prefsFor(DEFAULT_ARRANGE_SETTINGS, "major");
    const moved = swapFamilies(popular, II, "flip", "seventh", "column");
    expect(columns(resetColumn(moved, II, popular))[1]).toEqual(columns(popular)[1]);
  });

  it("forgets a scale's Custom arrangement, back to the mode it started from", () => {
    const onType = { ...DEFAULT_ARRANGE_SETTINGS, mode: "type" as const };
    const edited = customise(onType, "major", swapFamilies(DEFAULT_CHORD_PREFS, II, "sus2", "sus4", "all"));
    const reset = resetScale(edited, "major");
    expect(reset.mode).toBe("type");
    expect(reset.custom.major).toBeUndefined();
  });
});

describe("parseChordArrangeSettings", () => {
  it("round-trips what it is given", () => {
    const settings = customise(DEFAULT_ARRANGE_SETTINGS, "dorian", toggleFavourite(DEFAULT_CHORD_PREFS, II, "add9"));
    expect(parseChordArrangeSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it("falls back to the defaults for anything unreadable", () => {
    expect(parseChordArrangeSettings(null)).toEqual(DEFAULT_ARRANGE_SETTINGS);
    expect(parseChordArrangeSettings("not json")).toEqual(DEFAULT_ARRANGE_SETTINGS);
    expect(parseChordArrangeSettings(JSON.stringify({ mode: "nonsense" }))).toEqual(DEFAULT_ARRANGE_SETTINGS);
  });

  it("keeps an arrangement from before there were modes, as the major scale's Custom one", () => {
    const old = toggleFavourite(DEFAULT_CHORD_PREFS, II, "add9");
    const parsed = parseChordArrangeSettings(JSON.stringify(old));
    expect(parsed.mode).toBe("custom");
    expect(parsed.custom.major?.prefs.favourites).toEqual(old.favourites);
  });

  it("adds a family missing from a saved order on the end, so a new one is offered", () => {
    const saved = {
      mode: "custom",
      custom: { major: { from: "type", prefs: { ...DEFAULT_CHORD_PREFS, order: ["sus2", "seventh"] } } },
    };
    const order = parseChordArrangeSettings(JSON.stringify(saved)).custom.major!.prefs.order;
    expect(order.slice(0, 2)).toEqual(["sus2", "seventh"]);
    expect(new Set(order)).toEqual(new Set(DEFAULT_CHORD_PREFS.order));
  });
});

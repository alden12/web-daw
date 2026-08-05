import { describe, expect, it } from "vitest";
import {
  ACCIDENTAL_HEIGHT,
  EDITOR_CHROME,
  MAX_PAD_ROWS,
  PAD_HEIGHT,
  ROW_GAP,
  fitPads,
  padRowHeight,
} from "../src/ui/pads/geometry";

/**
 * The editor room each shape actually has, measured in the browser at the committed detent
 * (workspace height x the detent fraction, less the sheet's header). These are the numbers
 * the fitting has to be right about, so they are the numbers it is tested against.
 */
const ROOM = {
  phoneHalf: 372,
  phoneFull: 666,
  landscapeHalf: 133,
  landscapeFull: 251,
  tabletPortraitFull: 815,
};

describe("padRowHeight", () => {
  it("counts the accidental band only when the accidentals are on", () => {
    expect(padRowHeight(true)).toBe(PAD_HEIGHT + ACCIDENTAL_HEIGHT + ROW_GAP);
    expect(padRowHeight(false)).toBe(PAD_HEIGHT + ROW_GAP);
  });
});

describe("fitPads", () => {
  it("gives a phone at Half a row, with the controls in a row of their own", () => {
    const fit = fitPads(ROOM.phoneHalf, true);
    expect(fit.rows).toBeGreaterThanOrEqual(1);
    expect(fit.inlineControls).toBe(false);
  });

  it("gives a landscape phone at Half nothing at all, rather than a clipped row", () => {
    // ~133px of editor is not one row plus the controls to drive it, however it is shuffled.
    expect(fitPads(ROOM.landscapeHalf, true)).toEqual({ rows: 0, inlineControls: true });
  });

  it("buys landscape a row at Full by folding the controls into the header", () => {
    const fit = fitPads(ROOM.landscapeFull, true);
    expect(fit.rows).toBe(1);
    expect(fit.inlineControls).toBe(true);
  });

  it("only folds the controls away as a last resort", () => {
    // Anywhere a row fits with the controls stacked, they stay stacked - the fold is what
    // landscape needs, not a size the layout drifts into whenever things get tight.
    [ROOM.phoneHalf, ROOM.phoneFull, ROOM.tabletPortraitFull].forEach((room) => {
      expect(fitPads(room, true).inlineControls).toBe(false);
    });
  });

  it("caps at four rows however much room there is", () => {
    expect(fitPads(5000, true).rows).toBe(MAX_PAD_ROWS);
    expect(fitPads(ROOM.tabletPortraitFull, true).rows).toBe(MAX_PAD_ROWS);
  });

  it("fits more rows with the accidentals off, in the same room", () => {
    expect(fitPads(ROOM.phoneHalf, false).rows).toBeGreaterThan(fitPads(ROOM.phoneHalf, true).rows);
  });

  it("never asks for more than the room it was given", () => {
    // The section is content-sized, so a row too many is a row clipped by the sheet.
    const chrome = { stacked: 36 + 38 + 8, inline: 36 + 8 };
    [100, 133, 200, 251, 372, 500, 666, 815].forEach((room) => {
      const fit = fitPads(room, true);
      if (!fit.rows) return;
      const used = fit.rows * padRowHeight(true) + (fit.inlineControls ? chrome.inline : chrome.stacked);
      expect(used + EDITOR_CHROME).toBeLessThanOrEqual(room);
    });
  });

  it("grows monotonically with the room", () => {
    const rooms = [100, 200, 300, 400, 600, 900];
    const rows = rooms.map((room) => fitPads(room, true).rows);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
  });
});

import { describe, expect, it } from "vitest";
import {
  drumkitSchema,
  DRUMKIT_PADS,
  DRUMKIT_BASE_NOTE,
  noteForPad,
  instrumentSchema,
  hasInstrument,
} from "../src/audio/instruments/catalog";

describe("drumkit catalog", () => {
  it("is a registered instrument", () => {
    expect(hasInstrument("drumkit")).toBe(true);
    expect(instrumentSchema("drumkit")).toBe(drumkitSchema);
  });

  it("has sample/note/level/tune per pad plus a master level", () => {
    for (let pad = 1; pad <= DRUMKIT_PADS; pad++) {
      const sample = drumkitSchema.find((spec) => spec.id === `pad${pad}.sample`);
      const note = drumkitSchema.find((spec) => spec.id === `pad${pad}.note`);
      const level = drumkitSchema.find((spec) => spec.id === `pad${pad}.level`);
      const tune = drumkitSchema.find((spec) => spec.id === `pad${pad}.tune`);
      expect(sample?.kind, `pad${pad}.sample`).toBe("sample");
      expect(note?.kind, `pad${pad}.note`).toBe("number");
      expect(level?.kind, `pad${pad}.level`).toBe("number");
      expect(tune?.kind, `pad${pad}.tune`).toBe("number");
    }
    expect(drumkitSchema.find((spec) => spec.id === "amp.level")).toBeTruthy();
  });

  it("defaults each pad's note to the contiguous layout from the base note", () => {
    for (let pad = 1; pad <= DRUMKIT_PADS; pad++) {
      const note = drumkitSchema.find((spec) => spec.id === `pad${pad}.note`);
      expect(note?.kind === "number" && note.default, `pad${pad}.note default`).toBe(noteForPad(pad - 1));
    }
    expect(noteForPad(0)).toBe(DRUMKIT_BASE_NOTE);
    expect(noteForPad(3)).toBe(DRUMKIT_BASE_NOTE + 3);
  });

  it("seeds the first pads with the built-in kit and leaves the rest empty", () => {
    const pad1 = drumkitSchema.find((spec) => spec.id === "pad1.sample");
    expect(pad1?.kind === "sample" && pad1.default).toBe("builtin:kick");
    const pad16 = drumkitSchema.find((spec) => spec.id === "pad16.sample");
    expect(pad16?.kind === "sample" && pad16.default).toBe(""); // only 7 built-ins, rest empty
  });
});

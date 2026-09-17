import { describe, expect, it } from "vitest";
import {
  drumkitSchema,
  DRUMKIT_PADS,
  DRUMKIT_BASE_NOTE,
  noteForPad,
  instrumentSchema,
  hasInstrument,
} from "../src/audio/instruments/catalog";
import { BUILTIN_SAMPLES } from "../src/audio/samples/catalog";

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

  it("defaults built-in pads to the General MIDI drum note, extra pads to the contiguous fallback", () => {
    // The built-in kit follows the GM map (kick = 36, snare = 38, ...).
    BUILTIN_SAMPLES.forEach((sample, index) => {
      const note = drumkitSchema.find((spec) => spec.id === `pad${index + 1}.note`);
      expect(note?.kind === "number" && note.default, `pad${index + 1}.note default`).toBe(sample.gmNote);
    });
    expect(BUILTIN_SAMPLES[0].gmNote).toBe(36); // kick
    expect(BUILTIN_SAMPLES[1].gmNote).toBe(38); // snare (not a contiguous 37)

    // Pads past the built-in kit fall back to a contiguous layout from the base note.
    const firstExtra = drumkitSchema.find((spec) => spec.id === `pad${BUILTIN_SAMPLES.length + 1}.note`);
    expect(firstExtra?.kind === "number" && firstExtra.default).toBe(noteForPad(BUILTIN_SAMPLES.length));
    expect(noteForPad(0)).toBe(DRUMKIT_BASE_NOTE);
  });

  it("seeds the first pads with the built-in kit and leaves the rest empty", () => {
    const pad1 = drumkitSchema.find((spec) => spec.id === "pad1.sample");
    expect(pad1?.kind === "sample" && pad1.default).toBe("builtin:kick");
    const pad16 = drumkitSchema.find((spec) => spec.id === "pad16.sample");
    expect(pad16?.kind === "sample" && pad16.default).toBe(""); // only 7 built-ins, rest empty
  });
});

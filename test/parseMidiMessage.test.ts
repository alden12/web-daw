import { describe, it, expect } from "vitest";
import { parseMidiMessage, SUSTAIN_CC } from "../src/audio/midi/parseMidiMessage";

describe("parseMidiMessage", () => {
  it("parses a note-on with normalised velocity", () => {
    expect(parseMidiMessage([0x90, 60, 127])).toEqual({ type: "noteOn", note: 60, velocity: 1 });
    expect(parseMidiMessage([0x90, 64, 64])).toEqual({ type: "noteOn", note: 64, velocity: 64 / 127 });
  });

  it("treats a note-on at velocity 0 as a note-off", () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: "noteOff", note: 60 });
  });

  it("parses an explicit note-off", () => {
    expect(parseMidiMessage([0x80, 60, 40])).toEqual({ type: "noteOff", note: 60 });
  });

  it("ignores the channel nibble in the status byte", () => {
    expect(parseMidiMessage([0x93, 62, 100])).toEqual({ type: "noteOn", note: 62, velocity: 100 / 127 });
    expect(parseMidiMessage([0x85, 62, 0])).toEqual({ type: "noteOff", note: 62 });
  });

  it("parses control change (sustain pedal) with a normalised value", () => {
    expect(parseMidiMessage([0xb0, SUSTAIN_CC, 127])).toEqual({
      type: "controlChange",
      controller: SUSTAIN_CC,
      value: 1,
    });
    expect(parseMidiMessage([0xb0, SUSTAIN_CC, 0])).toEqual({
      type: "controlChange",
      controller: SUSTAIN_CC,
      value: 0,
    });
  });

  it("parses pitch bend centred at 0", () => {
    expect(parseMidiMessage([0xe0, 0, 64])).toEqual({ type: "pitchBend", value: 0 }); // 8192 -> 0
    expect(parseMidiMessage([0xe0, 0, 0])).toEqual({ type: "pitchBend", value: -1 }); // 0 -> -1
  });

  it("ignores messages we do not act on and empty data", () => {
    expect(parseMidiMessage([0xf8])).toBeNull(); // timing clock
    expect(parseMidiMessage([0xc0, 5])).toBeNull(); // program change
    expect(parseMidiMessage([])).toBeNull();
  });
});

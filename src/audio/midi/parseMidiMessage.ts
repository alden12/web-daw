/**
 * Parse a raw Web MIDI message into a semantic event. Pure and DOM-free, so it is
 * unit-testable and independent of the Web MIDI transport that delivers the bytes.
 *
 * We follow the MIDI wire conventions: a note-on with velocity 0 is a note-off;
 * velocities and 7-bit controller values are normalised to 0..1; pitch bend is the
 * 14-bit value centred at 8192, normalised to roughly -1..1. Messages we do not act
 * on yet (aftertouch, program change, clock, sysex, ...) parse to null and are ignored.
 */

/** The sustain-pedal controller number (MIDI CC64), by convention. */
export const SUSTAIN_CC = 64;

export type MidiMessage =
  | { type: "noteOn"; note: number; velocity: number } // velocity 0..1
  | { type: "noteOff"; note: number }
  | { type: "controlChange"; controller: number; value: number } // value 0..1
  | { type: "pitchBend"; value: number }; // -1..1 (0 = centre)

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const PITCH_BEND = 0xe0;

export function parseMidiMessage(data: Uint8Array | number[]): MidiMessage | null {
  if (data.length < 1) return null;
  const status = data[0] & 0xf0; // strip the channel nibble
  const data1 = data[1] ?? 0;
  const data2 = data[2] ?? 0;

  if (status === NOTE_ON) {
    // A note-on at velocity 0 is the conventional "note-off" many keyboards send.
    return data2 === 0 ? { type: "noteOff", note: data1 } : { type: "noteOn", note: data1, velocity: data2 / 127 };
  }
  if (status === NOTE_OFF) return { type: "noteOff", note: data1 };
  if (status === CONTROL_CHANGE) return { type: "controlChange", controller: data1, value: data2 / 127 };
  if (status === PITCH_BEND) {
    const value = (data1 | (data2 << 7)) - 8192; // 14-bit, centred at 8192
    return { type: "pitchBend", value: value / 8192 };
  }
  return null;
}

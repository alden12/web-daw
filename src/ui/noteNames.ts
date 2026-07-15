/**
 * MIDI pitch helpers shared by the piano roll and the drum roll: a pitch's note name
 * (C4 = 60, matching the roll's octave numbering) and whether it is a black key.
 */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const pitchName = (pitch: number) => `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

export const isBlackKey = (pitch: number) => [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);

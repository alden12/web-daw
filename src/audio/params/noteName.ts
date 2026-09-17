/**
 * MIDI pitch helpers (pure, DOM-free): a pitch's note name (C4 = 60, matching the piano
 * roll's octave numbering) and whether it is a black key. Shared by the UI (piano/drum
 * rolls, knobs) and the agent tools (so a drum kit's pad map reads as note names).
 */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const pitchName = (pitch: number) => `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

export const isBlackKey = (pitch: number) => [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);

/**
 * MIDI pitch helpers for the UI (piano roll, drum roll, knobs). The pure implementation
 * lives in the audio layer so the agent tools can share it; re-exported here so existing
 * UI imports keep their path.
 */
export { pitchName, isBlackKey } from "../audio/params/noteName";

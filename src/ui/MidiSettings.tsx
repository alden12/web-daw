/**
 * MIDI settings section: turn hardware MIDI input on/off and see the connected input
 * devices. All inputs play the *selected* track's instrument (like the computer
 * keyboard); the sustain pedal (CC64) is supported. One tab of SettingsPanel.tsx.
 * Enabling requests Web MIDI access from this click (a user gesture).
 */
import type { MidiInput } from "../audio/midi/midiInput";
import { useMidiInput } from "./useMidiInput";

export function MidiSettings({ midiInput }: { midiInput: MidiInput }) {
  const state = useMidiInput(midiInput);

  if (!state.supported) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-ink">MIDI input isn't available in this browser.</p>
        <p className="text-[11px] text-faint leading-relaxed">
          The Web MIDI API is supported in Chrome and Edge, but not Safari. Open the app there to play from a hardware
          keyboard.
        </p>
      </div>
    );
  }

  const enabled = state.access === "granted";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (enabled ? midiInput.disable() : void midiInput.enable())}
          aria-pressed={enabled}
          className={`px-3 py-1.5 rounded-md text-[12px] cursor-pointer border ${
            enabled ? "bg-you/15 border-you text-bright" : "border-line text-ink hover:border-muted"
          }`}
        >
          {enabled ? "MIDI input on" : "Enable MIDI input"}
        </button>
        {state.access === "requesting" && <span className="text-[11px] text-faint">Requesting access…</span>}
        {state.error && <span className="text-[11px] text-claude">{state.error}</span>}
      </div>

      {enabled && (
        <div className="flex flex-col gap-1.5" aria-label="MIDI input devices">
          <span className="text-[11px] uppercase tracking-wide text-faint">Devices</span>
          {state.devices.length === 0 ? (
            <p className="text-[12px] text-muted">No MIDI devices detected. Plug one in - it appears here.</p>
          ) : (
            state.devices.map((device) => (
              <div key={device.id} className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${device.connected ? "bg-you" : "bg-line"}`}
                  title={device.connected ? "connected" : "disconnected"}
                />
                <span className="text-[12.5px] text-ink">{device.name}</span>
              </div>
            ))
          )}
        </div>
      )}

      <p className="text-[11px] text-faint leading-relaxed">
        Every connected input plays the selected track's instrument, with velocity and the sustain pedal (CC64). Pitch
        bend and other controllers aren't mapped yet.
      </p>
    </div>
  );
}

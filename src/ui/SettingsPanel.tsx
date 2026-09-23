/**
 * The settings modal: a small tabbed panel opened from the gear at the bottom of the activity
 * rail. "Account" is everyone in the project and how they are coloured, you first, plus the way
 * out; "Agent" holds the BYOK provider/key/model config; "MIDI" holds hardware MIDI input;
 * "Appearance" holds the theme.
 *
 * Account used to be a modal of its own, opened from the rail avatar, and the colours of everyone
 * else were a separate Authors tab - with your own identity and colour living in whichever of the
 * two a build flag chose. One tab now, because they were always one subject. `initialTab` is how a
 * caller that means "account" opens straight to it; Agent stays the default so BYOK is unchanged.
 */
import { useState } from "react";
import { AccountSettings } from "./AccountSettings";
import { AgentSettingsSection } from "./AgentSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { MidiSettings } from "./MidiSettings";
import { RecordingSettings } from "./RecordingSettings";
import type { AgentConfig } from "../audio/agent/config";
import type { AuthorColorConfig } from "./authorColors";
import type { EditLog } from "../audio/commands/editLog";
import type { MidiInput } from "../audio/midi/midiInput";
import type { Recorder } from "../audio/recording/recorder";
import type { AudioEngine } from "../audio/engine/AudioEngine";

export type SettingsTab = "account" | "agent" | "midi" | "recording" | "appearance";
const TABS: { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "agent", label: "Agent" },
  { id: "midi", label: "MIDI" },
  { id: "recording", label: "Recording" },
  { id: "appearance", label: "Appearance" },
];

export function SettingsPanel({
  agentConfig,
  authorColors,
  editLog,
  midiInput,
  recorder,
  engine,
  initialTab = "agent",
  onClose,
}: {
  agentConfig: AgentConfig;
  authorColors: AuthorColorConfig;
  editLog: EditLog;
  midiInput: MidiInput;
  recorder: Recorder;
  engine: AudioEngine;
  /** Which tab to open on. "account" is what the rail's mark asks for; everything else gets Agent. */
  initialTab?: SettingsTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-panel border border-line rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 id="settings-title" className="text-[15px] font-semibold text-strong">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            title="Close"
            className="ml-auto text-lg leading-none text-muted hover:text-ink cursor-pointer px-1"
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-line" role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-[12px] cursor-pointer border-b-2 -mb-px ${
                tab === id ? "border-agent text-strong" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "account" && <AccountSettings config={authorColors} editLog={editLog} onClose={onClose} />}
        {tab === "agent" && <AgentSettingsSection config={agentConfig} onClose={onClose} />}
        {tab === "midi" && <MidiSettings midiInput={midiInput} />}
        {tab === "recording" && <RecordingSettings recorder={recorder} engine={engine} />}
        {tab === "appearance" && <AppearanceSettings />}
      </div>
    </div>
  );
}

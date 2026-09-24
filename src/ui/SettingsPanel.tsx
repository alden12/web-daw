/**
 * The settings modal, opened from the logo (the rail's on a desktop, the library sheet's on a phone).
 * "Account" is everyone in the project and how they are coloured, you first, plus the way out;
 * "Agent" holds the BYOK provider/key/model config; "MIDI" holds hardware MIDI input; "Recording"
 * the input and count-in; "Appearance" the theme.
 *
 * **One size, whatever the tab.** The categories run down the left and the panel scrolls beside them,
 * so switching tabs no longer resizes the dialog under the pointer.
 *
 * **It opens where you left it.** The last tab is remembered across openings and reloads; a caller
 * that means a particular one (the agent panel's link to its own settings) names it instead.
 *
 * **On a narrow screen it is a list, then a page.** There is no room for both columns, so the
 * categories come first and a tap opens one, with a back arrow to the list - unless you have been
 * in one before, when it reopens there with the arrow already showing the way back.
 */
import { useState } from "react";
import { usePersistentString } from "./usePersistent";
import { AccountSettings } from "./AccountSettings";
import { BrandMark } from "./BrandMark";
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
const TAB_IDS = ["account", "agent", "midi", "recording", "appearance"] as const satisfies readonly SettingsTab[];
const TABS: { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "agent", label: "Agent" },
  { id: "midi", label: "MIDI" },
  { id: "recording", label: "Recording" },
  { id: "appearance", label: "Appearance" },
];

/** The remembered tab, or "" before there is one: a first opening on a phone starts at the list. */
const useRememberedTab = () => usePersistentString<SettingsTab | "">("corrente:settings-tab", "", ["", ...TAB_IDS]);

export function SettingsPanel({
  agentConfig,
  authorColors,
  editLog,
  midiInput,
  recorder,
  engine,
  initialTab,
  onClose,
}: {
  agentConfig: AgentConfig;
  authorColors: AuthorColorConfig;
  editLog: EditLog;
  midiInput: MidiInput;
  recorder: Recorder;
  engine: AudioEngine;
  /** The tab a caller means, if it means one. Omitted, the panel opens on the one you left it on. */
  initialTab?: SettingsTab;
  onClose: () => void;
}) {
  const [remembered, setRemembered] = useRememberedTab();
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? (remembered || "account"));
  // Narrow screens only: whether the category list is showing rather than a tab's page.
  const [listing, setListing] = useState(!initialTab && !remembered);
  const label = TABS.find((candidate) => candidate.id === tab)?.label ?? "";

  const choose = (id: SettingsTab) => {
    setTab(id);
    setRemembered(id);
    setListing(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl h-[min(560px,calc(100dvh-2rem))] bg-panel border border-line rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-line">
          {/* The way back to the list, on a narrow screen showing a page. */}
          {!listing && (
            <button
              type="button"
              onClick={() => setListing(true)}
              aria-label="All settings"
              title="All settings"
              className="sm:hidden -ml-1 w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-ink cursor-pointer"
            >
              <BackArrow />
            </button>
          )}
          <span className={listing ? "contents" : "hidden sm:contents"}>
            <BrandMark size={30} />
          </span>
          <h2 id="settings-title" className="text-[17px] font-semibold text-strong">
            <span className={listing ? "" : "hidden sm:inline"}>Settings</span>
            {!listing && <span className="sm:hidden">{label}</span>}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            title="Close"
            className="ml-auto w-7 h-7 flex items-center justify-center text-xl leading-none text-muted hover:text-ink cursor-pointer"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings"
            className={`${listing ? "flex" : "hidden sm:flex"} flex-col gap-0.5 p-2 sm:p-3 w-full sm:w-44 shrink-0 sm:border-r border-line overflow-y-auto`}
          >
            {TABS.map(({ id, label: tabLabel }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => choose(id)}
                className={`flex items-center justify-between text-left px-3 py-2.5 sm:py-1.5 rounded-lg text-[14px] sm:text-[13px] cursor-pointer ${
                  tab === id ? "sm:bg-you/10 sm:text-strong text-ink" : "text-muted hover:text-ink hover:bg-card"
                }`}
              >
                {tabLabel}
                <span aria-hidden="true" className="sm:hidden text-lg leading-none text-faint">
                  ›
                </span>
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            aria-label={label}
            className={`${listing ? "hidden sm:flex" : "flex"} flex-1 min-w-0 flex-col gap-4 p-4 sm:p-6 overflow-y-auto`}
          >
            {tab === "account" && <AccountSettings config={authorColors} editLog={editLog} onClose={onClose} />}
            {tab === "agent" && <AgentSettingsSection config={agentConfig} onClose={onClose} />}
            {tab === "midi" && <MidiSettings midiInput={midiInput} />}
            {tab === "recording" && <RecordingSettings recorder={recorder} engine={engine} />}
            {tab === "appearance" && <AppearanceSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

function BackArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[18px] h-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

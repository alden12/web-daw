/**
 * The settings modal: a small tabbed panel opened from the gear at the bottom of the activity
 * rail. "Agent" holds the BYOK provider/key/model config; "Authors" holds the per-voice colour
 * swatches. Each tab renders its own section (AgentSettingsSection / AuthorColorSettings); Agent
 * is the default so the BYOK flow opens straight to it.
 */
import { useState } from "react";
import { AgentSettingsSection } from "./AgentSettings";
import { AuthorColorSettings } from "./AuthorColorSettings";
import type { AgentConfig } from "../audio/agent/config";
import type { AuthorColorConfig } from "./authorColors";

type Tab = "agent" | "authors";
const TABS: { id: Tab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "authors", label: "Authors" },
];

export function SettingsPanel({
  agentConfig,
  authorColors,
  onClose,
}: {
  agentConfig: AgentConfig;
  authorColors: AuthorColorConfig;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("agent");

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
          <h2 id="settings-title" className="text-[15px] font-semibold text-bright">
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
                tab === id ? "border-agent text-bright" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "agent" ? (
          <AgentSettingsSection config={agentConfig} onClose={onClose} />
        ) : (
          <AuthorColorSettings config={authorColors} />
        )}
      </div>
    </div>
  );
}

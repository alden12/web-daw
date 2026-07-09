/**
 * Agent settings: where the user brings their own model API key (BYOK). The key is held
 * only in this browser's localStorage and sent only to the provider (Google Gemini) - the
 * app has no server and never sees it. Opened from the gear at the bottom of the activity
 * rail. See docs/AGENT.md and src/audio/agent/config.ts.
 */
import { useState } from "react";
import { DEFAULT_MODEL, GET_KEY_URL, writeAgentConfig, type AgentConfig } from "../audio/agent/config";

export function AgentSettings({ config, onClose }: { config: AgentConfig; onClose: () => void }) {
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [model, setModel] = useState(config.model);
  const [reveal, setReveal] = useState(false);

  const save = () => {
    writeAgentConfig({ apiKey: apiKey.trim(), model: model.trim() });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-settings-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-panel border border-line rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-agent shrink-0" />
          <h2 id="agent-settings-title" className="text-[15px] font-semibold text-bright">
            Agent settings
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

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted">Gemini API key</span>
          <div className="flex items-stretch gap-1.5">
            <input
              type={reveal ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder="AIza..."
              aria-label="Gemini API key"
              className="flex-1 min-w-0 rounded-md bg-ground border border-line px-2.5 py-2 text-[12.5px] font-mono text-ink placeholder:text-faint focus-visible:[outline:2px_solid_var(--color-agent)] focus-visible:outline-offset-1"
            />
            <button
              type="button"
              onClick={() => setReveal((show) => !show)}
              aria-label={reveal ? "Hide key" : "Show key"}
              title={reveal ? "Hide key" : "Show key"}
              className="shrink-0 rounded-md border border-line bg-card px-2.5 text-[11px] font-mono text-muted hover:text-ink cursor-pointer"
            >
              {reveal ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted">Model</span>
          <input
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder={DEFAULT_MODEL}
            aria-label="Model"
            className="rounded-md bg-ground border border-line px-2.5 py-2 text-[12.5px] font-mono text-ink placeholder:text-faint focus-visible:[outline:2px_solid_var(--color-agent)] focus-visible:outline-offset-1"
          />
        </label>

        <p className="text-[11px] text-faint leading-relaxed">
          Your key is stored only in this browser and sent only to Google to run the model - it never reaches a server
          we run.{" "}
          <a href={GET_KEY_URL} target="_blank" rel="noreferrer" className="text-agent hover:underline">
            Get a free key
          </a>
          .
        </p>

        <div className="flex items-center gap-2 pt-1">
          {config.apiKey && (
            <button
              type="button"
              onClick={() => {
                setApiKey("");
                writeAgentConfig({ apiKey: "", model: model.trim() });
                onClose();
              }}
              className="mr-auto text-[11px] font-mono text-faint hover:text-warn cursor-pointer"
            >
              Clear key
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-line bg-card px-3 py-1.5 text-[12px] text-muted hover:text-ink cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded-md border border-agent/55 bg-agent/15 px-3 py-1.5 text-[12px] text-bright hover:bg-agent/25 cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

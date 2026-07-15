/**
 * Agent settings: pick a provider (Gemini / OpenAI / Anthropic) and bring your own key
 * for it (BYOK). Keys and per-provider model choices are held only in this browser's
 * localStorage and sent only to the chosen provider - the app has no server and never
 * sees them. Several providers' keys can be saved at once; the selected one drives the
 * agent. Opened from the gear at the bottom of the activity rail. See docs/AGENT.md,
 * src/audio/agent/config.ts, and src/audio/agent/providers.ts.
 */
import { useState } from "react";
import { writeAgentConfig, type AgentConfig } from "../audio/agent/config";
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from "../audio/agent/providers";

const fieldClass =
  "rounded-md bg-ground border border-line px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint focus-visible:[outline:2px_solid_var(--color-agent)] focus-visible:outline-offset-1";

export function AgentSettings({ config, onClose }: { config: AgentConfig; onClose: () => void }) {
  const [provider, setProvider] = useState<ProviderId>(config.provider);
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>(config.keys);
  const [models, setModels] = useState<Partial<Record<ProviderId, string>>>(config.models);
  const [reveal, setReveal] = useState(false);

  const info = PROVIDERS[provider];
  const modelListId = `agent-models-${provider}`;

  const setKey = (value: string) => setKeys((prev) => ({ ...prev, [provider]: value }));
  const setModel = (value: string) => setModels((prev) => ({ ...prev, [provider]: value }));

  const save = () => {
    writeAgentConfig({ provider, keys, models });
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
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted">Provider</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as ProviderId)}
            aria-label="Provider"
            className={`${fieldClass} cursor-pointer`}
          >
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted">API key</span>
          <div className="flex items-stretch gap-1.5">
            <input
              type={reveal ? "text" : "password"}
              value={keys[provider] ?? ""}
              onChange={(event) => setKey(event.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={`${info.label} key`}
              aria-label="API key"
              className={`${fieldClass} flex-1 min-w-0 font-mono`}
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
            value={models[provider] ?? ""}
            onChange={(event) => setModel(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder={info.defaultModel}
            aria-label="Model"
            list={modelListId}
            className={`${fieldClass} font-mono`}
          />
          <datalist id={modelListId}>
            {info.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>

        <p className="text-[11px] text-faint leading-relaxed">
          Your key is stored only in this browser and sent only to {info.label} to run the model - it never reaches a
          server we run.{" "}
          <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-agent hover:underline">
            Get a {info.label} key
          </a>
          .
        </p>

        <div className="flex items-center gap-2 pt-1">
          {(keys[provider] ?? "") !== "" && (
            <button
              type="button"
              onClick={() => setKey("")}
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

/**
 * The model providers the agent can drive, as data. All three expose an
 * OpenAI-compatible `/chat/completions` endpoint that allows direct browser calls (CORS),
 * so one generic provider ([provider.ts](./provider.ts)) speaks to any of them - the only
 * differences are the base URL, the default model, and (for Anthropic) an extra opt-in
 * header. Adding a provider is one entry here; nothing else hardcodes the list. See
 * docs/AGENT.md.
 */

export type ProviderId = "gemini" | "openai" | "anthropic";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** OpenAI-compatible base URL (no trailing slash); we POST `${baseUrl}/chat/completions`. */
  baseUrl: string;
  /** Model used when the user has not overridden it. */
  defaultModel: string;
  /** A few well-known model ids for the picker; the field stays free-text. */
  models: string[];
  /** Where the user gets an API key. */
  keyUrl: string;
  /** Extra request headers (Anthropic requires opting in to browser calls). */
  extraHeaders?: Record<string, string>;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    // Anthropic blocks browser calls unless the caller opts in explicitly.
    extraHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
  },
};

/** Provider ids in display order (insertion order of PROVIDERS). */
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/** A known provider id, or the default (gemini) for anything unrecognised. */
export function toProviderId(value: unknown): ProviderId {
  return typeof value === "string" && value in PROVIDERS ? (value as ProviderId) : "gemini";
}

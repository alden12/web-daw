/**
 * The agent's model access, held in the browser (BYOK - bring your own key). The user
 * pastes their own provider API key in Settings; it lives only in this browser's
 * localStorage and is sent only to the provider (Google Gemini by default), never to any
 * server we run. This is what replaced the old dev-only key-proxy: with CORS open on the
 * provider, the browser can call it directly, so local == deployed and there is no server
 * secret to hold. See docs/AGENT.md (phase 1).
 *
 * Pure data + localStorage + a subscribe seam (no DOM, no React), mirroring the patch
 * library store. A cached snapshot keeps `readAgentConfig` referentially stable between
 * writes, so it is safe as a `useSyncExternalStore` getSnapshot.
 */

/** Gemini's OpenAI-compatible base URL (no trailing slash). */
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Default model: gemini-2.5-flash has free-tier quota (gemini-2.0-flash can report 0). */
export const DEFAULT_MODEL = "gemini-2.5-flash";

/** Where to get a key, shown in the settings panel. */
export const GET_KEY_URL = "https://aistudio.google.com/apikey";

export interface AgentConfig {
  /** The user's provider API key (Bearer token). Empty until they set one. */
  apiKey: string;
  /** Model id; blank falls back to DEFAULT_MODEL. */
  model: string;
}

const STORAGE_KEY = "web-daw:agent-config:v1";
const EMPTY: AgentConfig = { apiKey: "", model: "" };
const listeners = new Set<() => void>();

function store(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // localStorage can throw (privacy mode); degrade to no config
  }
}

function readFromStorage(): AgentConfig {
  const raw = store()?.getItem(STORAGE_KEY);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return EMPTY;
  }
}

let cached: AgentConfig = readFromStorage();

/** The current config (a stable reference until the next write). */
export function readAgentConfig(): AgentConfig {
  return cached;
}

/** Replace the config and notify subscribers. */
export function writeAgentConfig(config: AgentConfig): void {
  cached = { apiKey: config.apiKey, model: config.model };
  store()?.setItem(STORAGE_KEY, JSON.stringify(cached));
  for (const listener of listeners) listener();
}

/** The model to actually use (the configured one, or the default). */
export function resolveModel(config: AgentConfig): string {
  return config.model.trim() || DEFAULT_MODEL;
}

/** Subscribe to config changes. Returns an unsubscribe fn. */
export function subscribeAgentConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

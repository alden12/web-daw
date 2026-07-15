/**
 * The agent's model access, held in the browser (BYOK - bring your own key). The user
 * picks a provider and pastes their own key for it in Settings; keys and per-provider
 * model choices live only in this browser's localStorage and are sent only to the chosen
 * provider, never to any server we run. With CORS open on every provider, the browser
 * calls them directly, so local == deployed and there is no server secret to hold. See
 * [providers.ts](./providers.ts) and docs/AGENT.md.
 *
 * Pure data + localStorage + a subscribe seam (no DOM, no React), mirroring the patch
 * library store. A cached snapshot keeps `readAgentConfig` referentially stable between
 * writes, so it is safe as a `useSyncExternalStore` getSnapshot.
 */
import { PROVIDERS, toProviderId, type ProviderId } from "./providers";

export interface AgentConfig {
  /** The provider currently driving the agent. */
  provider: ProviderId;
  /** API key per provider (so several can be saved at once). */
  keys: Partial<Record<ProviderId, string>>;
  /** Model override per provider; blank falls back to that provider's default. */
  models: Partial<Record<ProviderId, string>>;
}

const STORAGE_KEY = "web-daw:agent-config:v2";
const EMPTY: AgentConfig = { provider: "gemini", keys: {}, models: {} };
const listeners = new Set<() => void>();

function store(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // localStorage can throw (privacy mode); degrade to no config
  }
}

/** Keep only string values keyed by a known provider id. */
function cleanMap(value: unknown): Partial<Record<ProviderId, string>> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, entry]) => key in PROVIDERS && typeof entry === "string"),
  ) as Partial<Record<ProviderId, string>>;
}

function readFromStorage(): AgentConfig {
  const raw = store()?.getItem(STORAGE_KEY);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    return {
      provider: toProviderId(parsed.provider),
      keys: cleanMap(parsed.keys),
      models: cleanMap(parsed.models),
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
  cached = { provider: config.provider, keys: { ...config.keys }, models: { ...config.models } };
  store()?.setItem(STORAGE_KEY, JSON.stringify(cached));
  for (const listener of listeners) listener();
}

/** The active provider's API key (trimmed), or "" if none is set. */
export function activeKey(config: AgentConfig): string {
  return (config.keys[config.provider] ?? "").trim();
}

/** The model to use for the active provider (its override, or the provider default). */
export function resolveModel(config: AgentConfig): string {
  return (config.models[config.provider] ?? "").trim() || PROVIDERS[config.provider].defaultModel;
}

/** Subscribe to config changes. Returns an unsubscribe fn. */
export function subscribeAgentConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * React binding for the agent's BYOK config store (src/audio/agent/config.ts). The
 * snapshot is referentially stable between writes, so it is a safe external store.
 */
import { useSyncExternalStore } from "react";
import { readAgentConfig, subscribeAgentConfig, type AgentConfig } from "../audio/agent/config";

export function useAgentConfig(): AgentConfig {
  return useSyncExternalStore(subscribeAgentConfig, readAgentConfig, readAgentConfig);
}

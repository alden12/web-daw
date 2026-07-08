/**
 * Shared contract for the in-app agent (see docs/AGENT.md). Provider-agnostic and
 * OpenAI-shaped, so any OpenAI-compatible backend fits behind the key-proxy. This module
 * is DOM-free and is the one place the browser and the server-side proxy agree on the
 * endpoint path (mirrors how `mcp/protocol.ts` is shared with the Node MCP server).
 */

/** Where the browser posts a chat request; the key-proxy relays it to the provider. */
export const AGENT_CHAT_PATH = "/api/agent/chat";

/** One turn in the conversation. OpenAI-compatible roles. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/**
 * What a provider returns for one `chat` call. Today it is assistant text; tool calls
 * arrive with the tool-calling section (invariant: the loop only ever awaits this seam,
 * so widening it later does not touch callers that ignore the new field).
 */
export interface ProviderReply {
  text: string;
}

/**
 * The one narrow seam the agent loop talks to. A provider turns a conversation into a
 * reply; vendor dialects (Gemini, OpenAI, ...) live inside the implementation, never in
 * the loop. A `tools` argument joins `chat` when tool-calling lands.
 */
export interface AgentProvider {
  chat(messages: ChatMessage[]): Promise<ProviderReply>;
}

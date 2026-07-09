/**
 * The default AgentProvider: talks to an OpenAI-compatible chat-completions API through
 * the key-proxy (`/api/agent/chat`), so the browser never holds the model key. Despite
 * the name it is provider-agnostic - the proxy decides the actual backend (Gemini by
 * default) via env; this side only speaks the OpenAI request/response shape, including
 * function-calling (tools in, `tool_calls` out). See docs/AGENT.md (phase 1).
 */
import {
  AGENT_CHAT_PATH,
  type AgentProvider,
  type ChatMessage,
  type ProviderReply,
  type ProviderToolCall,
  type ToolSpec,
} from "./types";

/** Parse an OpenAI-shaped chat-completions response body into a provider reply. */
export function parseReply(raw: string): ProviderReply {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The model returned a response that was not valid JSON.");
  }
  const message = firstChoiceMessage(data);
  if (message === null) throw new Error("The model response contained no choices.");
  const text = typeof message.content === "string" ? message.content : "";
  const toolCalls = readToolCalls(message);
  if (text === "" && !toolCalls) throw new Error("The model response contained no assistant text or tool calls.");
  return toolCalls ? { text, toolCalls } : { text };
}

function firstChoiceMessage(data: unknown): { content?: unknown; tool_calls?: unknown } | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  return typeof message === "object" && message !== null
    ? (message as { content?: unknown; tool_calls?: unknown })
    : null;
}

function readToolCalls(message: { tool_calls?: unknown }): ProviderToolCall[] | undefined {
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) return undefined;
  const calls = message.tool_calls
    .map((entry): ProviderToolCall | null => {
      const call = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const name = call.function?.name;
      if (typeof name !== "string") return null;
      const args = call.function?.arguments;
      return {
        id: typeof call.id === "string" ? call.id : name,
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      };
    })
    .filter((call): call is ProviderToolCall => call !== null);
  return calls.length > 0 ? calls : undefined;
}

/** Turn a proxy/upstream error body into a message worth showing the user. Handles both
 *  the proxy's `{ error: string }` and an upstream OpenAI-style `{ error: { message } }`. */
export function providerErrorMessage(raw: string, status: number): string {
  try {
    const error = (JSON.parse(raw) as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (error !== null && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  } catch {
    // Not JSON - fall through to a generic message.
  }
  return `The agent request failed (HTTP ${status}).`;
}

export function createGeminiProvider(): AgentProvider {
  return {
    async chat(messages: ChatMessage[], tools?: ToolSpec[]): Promise<ProviderReply> {
      const body: Record<string, unknown> = { messages };
      if (tools && tools.length > 0) {
        body.tools = tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
        body.tool_choice = "auto";
      }
      const response = await fetch(AGENT_CHAT_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(providerErrorMessage(raw, response.status));
      return parseReply(raw);
    },
  };
}

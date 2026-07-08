/**
 * The default AgentProvider: talks to an OpenAI-compatible chat-completions API through
 * the key-proxy (`/api/agent/chat`), so the browser never holds the model key. Despite
 * the name it is provider-agnostic - the proxy decides the actual backend (Gemini by
 * default) via env; this side only speaks the OpenAI request/response shape. Swapping
 * models is a `.env` change, not a code change here. See docs/AGENT.md (phase 1).
 */
import { AGENT_CHAT_PATH, type AgentProvider, type ChatMessage, type ProviderReply } from "./types";

/** Pull the assistant text out of an OpenAI-shaped chat-completions response body. */
export function parseAssistantText(raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The model returned a response that was not valid JSON.");
  }
  const content = readChoiceContent(data);
  if (content === null) throw new Error("The model response contained no assistant text.");
  return content;
}

function readChoiceContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
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
    async chat(messages: ChatMessage[]): Promise<ProviderReply> {
      const response = await fetch(AGENT_CHAT_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(providerErrorMessage(raw, response.status));
      return { text: parseAssistantText(raw) };
    },
  };
}

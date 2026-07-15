/**
 * The AgentProvider: talks to an OpenAI-compatible chat-completions API directly from the
 * browser, authenticated with the user's own key (BYOK - see config.ts). It is
 * provider-agnostic - it speaks only the OpenAI request/response shape, including
 * function-calling (tools in, `tool_calls` out) - so Gemini, OpenAI, and Anthropic all
 * fit; the active provider only changes the base URL, model, and headers (see
 * providers.ts). See docs/AGENT.md (phase 1).
 */
import { activeKey, readAgentConfig, resolveModel } from "./config";
import { PROVIDERS } from "./providers";
import type { AgentProvider, ChatMessage, ProviderReply, ProviderToolCall, ToolSpec } from "./types";

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
  if (text === "" && !toolCalls) throw new EmptyReplyError(readFinishReason(data));
  const usage = readUsage(data);
  return { text, ...(toolCalls ? { toolCalls } : {}), ...(usage ? { usage } : {}) };
}

/** The model returned a candidate with no text and no tool call. This is usually
 *  non-deterministic (a truncated/malformed generation), so the loop retries it before
 *  giving up; `finishReason` (when the provider gives one) says why. */
export class EmptyReplyError extends Error {
  readonly finishReason?: string;
  constructor(finishReason?: string) {
    super(emptyReplyMessage(finishReason));
    this.name = "EmptyReplyError";
    this.finishReason = finishReason;
  }
}

/** A user-facing note for an empty candidate, specific to the finish reason when known.
 *  Gemini in particular returns these intermittently on complex tool calls. */
function emptyReplyMessage(finishReason?: string): string {
  const byReason: Record<string, string> = {
    length:
      "The model ran out of output tokens before replying (it may have spent them reasoning). Try again, or ask for a smaller change.",
    max_tokens:
      "The model ran out of output tokens before replying (it may have spent them reasoning). Try again, or ask for a smaller change.",
    content_filter: "The model blocked its own response (a safety filter). Try rephrasing the request.",
    safety: "The model blocked its own response (a safety filter). Try rephrasing the request.",
    malformed_function_call:
      "The model produced a malformed tool call - a known hiccup on complex edits. Retrying usually fixes it.",
  };
  const message = finishReason ? byReason[finishReason.toLowerCase()] : undefined;
  return message ?? "The model returned an empty response. This can happen intermittently; retrying usually fixes it.";
}

function readFinishReason(data: unknown): string | undefined {
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? reason : undefined;
}

function readUsage(data: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const usage = (data as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const input = (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const output = (usage as { completion_tokens?: unknown }).completion_tokens;
  if (typeof input !== "number" && typeof output !== "number") return undefined;
  return { inputTokens: typeof input === "number" ? input : 0, outputTokens: typeof output === "number" ? output : 0 };
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

/** An error from the provider, surfaced to the user in the chat. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Turn a provider error body into a message worth showing the user. Handles a plain
 *  `{ error: string }`, an OpenAI-style `{ error: { message } }`, and gives rate limiting
 *  (429) a friendly note instead of the verbose quota dump. Free tiers often enforce a low
 *  daily request cap (not just per-minute), so the note names it. */
export function providerErrorMessage(raw: string, status: number): string {
  if (status === 429) {
    return "Rate limited - you've hit the provider's request limit. Wait a bit and try again; note that free tiers often enforce a low daily limit as well.";
  }
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

export function createProvider(): AgentProvider {
  return {
    async chat(messages: ChatMessage[], tools?: ToolSpec[]): Promise<ProviderReply> {
      const config = readAgentConfig();
      const info = PROVIDERS[config.provider];
      const apiKey = activeKey(config);
      if (!apiKey) {
        throw new ProviderError(
          `No API key set for ${info.label}. Open Settings (the gear at the bottom of the left rail) and add one.`,
        );
      }
      const body: Record<string, unknown> = { messages, model: resolveModel(config), stream: false };
      if (tools && tools.length > 0) {
        body.tools = tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
        body.tool_choice = "auto";
      }
      const response = await fetch(`${info.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          ...(info.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new ProviderError(providerErrorMessage(raw, response.status));
      }
      return parseReply(raw);
    },
  };
}

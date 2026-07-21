/**
 * The AgentProvider: talks to an OpenAI-compatible chat-completions API directly from the
 * browser, authenticated with the user's own key (BYOK - see config.ts). It is
 * provider-agnostic - it speaks only the OpenAI request/response shape, including
 * function-calling (tools in, `tool_calls` out) - so Gemini, OpenAI, and Anthropic all
 * fit; the active provider only changes the base URL, model, and headers (see
 * providers.ts). See docs/AGENT.md (phase 1).
 */
import { z } from "zod";
import { activeKey, readAgentConfig, resolveModel } from "./config";
import { PROVIDERS } from "./providers";
import type { AgentProvider, ChatMessage, ChatOptions, ProviderReply, ProviderToolCall, ToolSpec } from "./types";

/** The slice of the OpenAI chat-completions response we read. A model response is an
 *  untrusted boundary like any other (MCP inputs, loaded bundles), so we validate it with
 *  zod - `safeParse` at the edge, typed inward - rather than an `as`-cast + `typeof` ladder.
 *  Fields the model may legitimately omit are optional; unknown extras are ignored. */
const toolCallSchema = z.object({
  id: z.string().optional(),
  function: z.object({ name: z.string().optional(), arguments: z.unknown().optional() }).optional(),
});
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({ content: z.unknown().optional(), tool_calls: z.array(toolCallSchema).optional() })
          .optional(),
        finish_reason: z.string().optional(),
      }),
    )
    .optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
});

/** Parse an OpenAI-shaped chat-completions response body into a provider reply. */
export function parseReply(raw: string): ProviderReply {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("The model returned a response that was not valid JSON.");
  }
  const parsed = completionSchema.safeParse(json);
  if (!parsed.success) throw new Error("The model returned a response in an unexpected shape.");
  const choice = parsed.data.choices?.[0];
  if (!choice || !choice.message) throw new Error("The model response contained no choices.");
  const text = typeof choice.message.content === "string" ? choice.message.content : "";
  const toolCalls = readToolCalls(choice.message.tool_calls);
  if (text === "" && !toolCalls) throw new EmptyReplyError(choice.finish_reason);
  const usage = readUsage(parsed.data.usage);
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

function readUsage(
  usage: z.infer<typeof completionSchema>["usage"],
): { inputTokens: number; outputTokens: number } | undefined {
  if (!usage) return undefined;
  const { prompt_tokens: input, completion_tokens: output } = usage;
  if (input === undefined && output === undefined) return undefined;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

function readToolCalls(toolCalls: z.infer<typeof toolCallSchema>[] | undefined): ProviderToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  const calls = toolCalls
    .map((call): ProviderToolCall | null => {
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
    async chat(messages: ChatMessage[], tools?: ToolSpec[], options?: ChatOptions): Promise<ProviderReply> {
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
        signal: options?.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new ProviderError(providerErrorMessage(raw, response.status));
      }
      return parseReply(raw);
    },
  };
}

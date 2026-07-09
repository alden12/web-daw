/**
 * Shared contract for the in-app agent (see docs/AGENT.md). Provider-agnostic and
 * OpenAI-shaped, so any OpenAI-compatible backend fits behind the `AgentProvider` seam.
 * DOM-free: pure types the loop, the provider, and the UI all agree on.
 */

/** A tool call the model wants run, as returned by the provider (OpenAI shape). */
export interface ProviderToolCall {
  id: string;
  name: string;
  /** Raw JSON string of arguments from the model (parsed + validated by the tool). */
  arguments: string;
}

/**
 * One turn in the conversation. OpenAI-compatible, including the fields needed to
 * round-trip a tool call: an assistant turn may carry `tool_calls`, and a `tool` turn
 * carries the `tool_call_id` it answers.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** Token counts for one exchange (from the provider's `usage`), for display. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** What a provider returns for one `chat` call: assistant text and/or tool calls. */
export interface ProviderReply {
  text: string;
  toolCalls?: ProviderToolCall[];
  usage?: TokenUsage;
}

/** The minimal tool description a provider needs to offer function-calling (no `run`). */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

/**
 * The one narrow seam the agent loop talks to. A provider turns a conversation (plus the
 * available tools) into a reply; vendor dialects (Gemini, OpenAI, ...) live inside the
 * implementation, never in the loop.
 */
export interface AgentProvider {
  chat(messages: ChatMessage[], tools?: ToolSpec[]): Promise<ProviderReply>;
}

/**
 * An executable tool. `run` always returns a Promise and takes/returns plain
 * serializable data - the invariants (see docs/AGENT.md) that let a tool later be backed
 * by a Worker actor without touching the loop. `jsonSchema` is the provider-facing
 * argument schema; the same zod schema behind it validates the model's arguments.
 */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: Record<string, unknown>;
  run(rawArgs: unknown): Promise<unknown>;
}

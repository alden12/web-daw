/**
 * The reason-act (ReAct) loop: the agent's brain. It asks the provider what to do,
 * runs any tool calls it returns, feeds the results back, and repeats until the provider
 * answers with plain text (or a step cap is hit). The loop only ever knows the tool
 * boundary - it never reaches past a tool into a store or a worker - so tools can later
 * be backed by actors with no change here (see docs/AGENT.md invariants).
 */
import { EmptyReplyError } from "./provider";
import type { AgentProvider, ChatMessage, ProviderReply, ToolSpec, AgentTool, TokenUsage } from "./types";

/** Total attempts per provider round when the model returns an empty candidate (no text,
 *  no tool call). These are non-deterministic - a plain reroll almost always succeeds - so
 *  the loop retries rather than surfacing the error on the first miss. */
const EMPTY_REPLY_ATTEMPTS = 3;

/** A record of one tool the loop ran, for display + tests. */
export interface ToolInvocation {
  name: string;
  args: unknown;
  ok: boolean;
  /** JSON string of the result (or the error) that was fed back to the model. */
  result: string;
}

export interface AgentRunResult {
  text: string;
  invocations: ToolInvocation[];
  /** Tokens summed across every provider round-trip this run made. */
  usage: TokenUsage;
}

export interface RunAgentOptions {
  messages: ChatMessage[];
  provider: AgentProvider;
  tools: AgentTool[];
  /** Safety cap on provider round-trips (each may run several tools). Default 8. */
  maxSteps?: number;
  /** Fired as each tool starts, so the UI can show activity live. */
  onToolStart?: (invocation: { name: string; args: unknown }) => void;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { provider, tools, messages, onToolStart } = options;
  const maxSteps = options.maxSteps ?? 8;
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolSpecs = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.jsonSchema,
  }));

  const conversation = [...messages];
  const invocations: ToolInvocation[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  for (let step = 0; step < maxSteps; step++) {
    const reply = await chatWithRetry(provider, conversation, toolSpecs);
    if (reply.usage) {
      usage.inputTokens += reply.usage.inputTokens;
      usage.outputTokens += reply.usage.outputTokens;
    }
    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      return { text: reply.text, invocations, usage };
    }

    // Record the assistant turn that requested the calls, then answer each one.
    conversation.push({
      role: "assistant",
      content: reply.text,
      tool_calls: reply.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of reply.toolCalls) {
      const args = safeParseArgs(call.arguments);
      onToolStart?.({ name: call.name, args });
      const { ok, result } = await runOne(toolByName.get(call.name), call.name, args);
      invocations.push({ name: call.name, args, ok, result });
      conversation.push({ role: "tool", content: result, tool_call_id: call.id });
    }
  }

  return {
    text: "I hit the step limit while working on that. Tell me to keep going and I will continue.",
    invocations,
    usage,
  };
}

/** One provider round, retrying only the non-deterministic empty-candidate case. Any
 *  other error (auth, rate limit, malformed body) propagates immediately. */
async function chatWithRetry(
  provider: AgentProvider,
  conversation: ChatMessage[],
  toolSpecs: ToolSpec[],
): Promise<ProviderReply> {
  let lastError: unknown;
  for (let attempt = 0; attempt < EMPTY_REPLY_ATTEMPTS; attempt++) {
    try {
      return await provider.chat(conversation, toolSpecs);
    } catch (error) {
      if (!(error instanceof EmptyReplyError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function safeParseArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function runOne(
  tool: AgentTool | undefined,
  name: string,
  args: unknown,
): Promise<{ ok: boolean; result: string }> {
  if (!tool) return { ok: false, result: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  try {
    const output = await tool.run(args);
    return { ok: true, result: JSON.stringify(output ?? { ok: true }) };
  } catch (error) {
    return { ok: false, result: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) };
  }
}

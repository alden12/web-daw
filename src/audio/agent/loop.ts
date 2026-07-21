/**
 * The reason-act (ReAct) loop: the agent's brain. It asks the provider what to do,
 * runs any tool calls it returns, feeds the results back, and repeats until the provider
 * answers with plain text (or a step cap is hit). The loop only ever knows the tool
 * boundary - it never reaches past a tool into a store or a worker - so tools can later
 * be backed by actors with no change here (see docs/AGENT.md invariants).
 *
 * The run is interruptible: pass an `AbortSignal` and a user "stop" cancels the in-flight
 * provider request and returns the work done so far (`stopped: true`) rather than throwing.
 * Each act round (a narration + the tools it ran) is surfaced as an `AgentStep`, both in the
 * result and live via `onStep`, so the UI can show the think-act-observe trail as it unfolds.
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

/** One act round: the model's narration before it acted, plus the tools that round ran. The
 *  loop's terminal text reply is NOT a step - it is the run's `text`; steps are the trail
 *  above it. */
export interface AgentStep {
  /** The assistant narration that preceded this round's tool calls (may be empty). */
  text: string;
  activity: { name: string; ok: boolean }[];
}

export interface AgentRunResult {
  text: string;
  /** The act rounds, in order, that led to `text`. */
  steps: AgentStep[];
  invocations: ToolInvocation[];
  /** Tokens summed across every provider round-trip this run made. */
  usage: TokenUsage;
  /** True when the run was interrupted (user stop) before a natural finish. */
  stopped?: boolean;
}

export interface RunAgentOptions {
  messages: ChatMessage[];
  provider: AgentProvider;
  tools: AgentTool[];
  /** Safety cap on provider round-trips (each may run several tools). Default 8. */
  maxSteps?: number;
  /** Interrupt the run. When it fires, the in-flight request is cancelled and the loop
   *  returns what it has so far with `stopped: true`. */
  signal?: AbortSignal;
  /** Fired as each tool starts, so the UI can show activity live. */
  onToolStart?: (invocation: { name: string; args: unknown }) => void;
  /** Fired once per completed act round (after its tools resolve), so the UI can grow the
   *  trail live instead of only at the end. */
  onStep?: (step: AgentStep & { index: number }) => void;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { provider, tools, messages, signal, onToolStart, onStep } = options;
  const maxSteps = options.maxSteps ?? 8;
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolSpecs = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.jsonSchema,
  }));

  const conversation = [...messages];
  const invocations: ToolInvocation[] = [];
  const steps: AgentStep[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const stopped = (): AgentRunResult => ({ text: "", steps, invocations, usage, stopped: true });

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return stopped();

    let reply: ProviderReply;
    try {
      reply = await chatWithRetry(provider, conversation, toolSpecs, signal);
    } catch (error) {
      if (isAbortError(error)) return stopped();
      throw error;
    }
    if (reply.usage) {
      usage.inputTokens += reply.usage.inputTokens;
      usage.outputTokens += reply.usage.outputTokens;
    }
    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      return { text: reply.text, steps, invocations, usage };
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

    const activity: { name: string; ok: boolean }[] = [];
    let aborted = false;
    for (const call of reply.toolCalls) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      const args = safeParseArgs(call.arguments);
      onToolStart?.({ name: call.name, args });
      const { ok, result } = await runOne(toolByName.get(call.name), call.name, args);
      invocations.push({ name: call.name, args, ok, result });
      conversation.push({ role: "tool", content: result, tool_call_id: call.id });
      activity.push({ name: call.name, ok });
    }

    const completed: AgentStep = { text: reply.text, activity };
    steps.push(completed);
    onStep?.({ index: step, ...completed });
    if (aborted) return stopped();
  }

  return {
    text: "I hit the step limit while working on that. Tell me to keep going and I will continue.",
    steps,
    invocations,
    usage,
  };
}

/** One provider round, retrying only the non-deterministic empty-candidate case. Any
 *  other error (auth, rate limit, malformed body) - and an abort - propagates immediately. */
async function chatWithRetry(
  provider: AgentProvider,
  conversation: ChatMessage[],
  toolSpecs: ToolSpec[],
  signal?: AbortSignal,
): Promise<ProviderReply> {
  let lastError: unknown;
  for (let attempt = 0; attempt < EMPTY_REPLY_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await provider.chat(conversation, toolSpecs, { signal });
    } catch (error) {
      if (isAbortError(error) || !(error instanceof EmptyReplyError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** A cancelled `fetch` rejects with an `AbortError` (a DOMException in the browser). We
 *  match on the name so a user stop unwinds cleanly to a partial result. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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

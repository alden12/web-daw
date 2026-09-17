import { describe, expect, it } from "vitest";
import { runAgent } from "../src/audio/agent/loop";
import { EmptyReplyError } from "../src/audio/agent/provider";
import type { AgentProvider, AgentTool, ChatMessage, ProviderReply, ToolSpec } from "../src/audio/agent/types";

/** A provider that replays a script of replies and records what it was asked. */
function scriptedProvider(replies: ProviderReply[]) {
  const seen: { messages: ChatMessage[]; tools?: ToolSpec[] }[] = [];
  let index = 0;
  const provider: AgentProvider = {
    async chat(messages, tools) {
      seen.push({ messages: messages.map((message) => ({ ...message })), tools });
      return replies[Math.min(index++, replies.length - 1)];
    },
  };
  return { provider, seen };
}

const echoTool: AgentTool = {
  name: "echo",
  description: "echoes its args",
  jsonSchema: { type: "object" },
  run: async (args) => ({ echoed: args }),
};

const boomTool: AgentTool = {
  name: "boom",
  description: "always throws",
  jsonSchema: { type: "object" },
  run: async () => {
    throw new Error("kaboom");
  },
};

const seed: ChatMessage[] = [{ role: "user", content: "do the thing" }];

describe("runAgent", () => {
  it("runs a tool call, feeds the result back, and returns the final text", async () => {
    const { provider, seen } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "echo", arguments: '{"x":1}' }] },
      { text: "all done" },
    ]);

    const result = await runAgent({ messages: seed, provider, tools: [echoTool] });

    expect(result.text).toBe("all done");
    expect(result.invocations).toHaveLength(1);
    expect(result.invocations[0]).toMatchObject({ name: "echo", ok: true });
    expect(result.invocations[0].args).toEqual({ x: 1 });

    // The second provider call must have seen the assistant tool_calls + the tool result.
    const secondCall = seen[1].messages;
    expect(secondCall.some((message) => message.role === "assistant" && message.tool_calls?.length)).toBe(true);
    const toolMessage = secondCall.find((message) => message.role === "tool");
    expect(toolMessage?.tool_call_id).toBe("c1");
    expect(toolMessage?.content).toContain("echoed");
    // Tools were offered to the provider.
    expect(seen[0].tools?.map((tool) => tool.name)).toEqual(["echo"]);
  });

  it("captures a tool error and keeps going", async () => {
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "boom", arguments: "{}" }] },
      { text: "recovered" },
    ]);

    const result = await runAgent({ messages: seed, provider, tools: [boomTool] });

    expect(result.text).toBe("recovered");
    expect(result.invocations[0]).toMatchObject({ name: "boom", ok: false });
    expect(result.invocations[0].result).toContain("kaboom");
  });

  it("reports an unknown tool without crashing", async () => {
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "nope", arguments: "{}" }] },
      { text: "ok" },
    ]);

    const result = await runAgent({ messages: seed, provider, tools: [echoTool] });
    expect(result.invocations[0]).toMatchObject({ name: "nope", ok: false });
    expect(result.invocations[0].result).toContain("Unknown tool");
  });

  it("stops at the step cap when the model never settles", async () => {
    const { provider } = scriptedProvider([{ text: "", toolCalls: [{ id: "c", name: "echo", arguments: "{}" }] }]);
    const result = await runAgent({ messages: seed, provider, tools: [echoTool], maxSteps: 3 });
    expect(result.invocations).toHaveLength(3);
    expect(result.text).toMatch(/step limit/i);
  });

  it("accumulates token usage across rounds", async () => {
    const { provider } = scriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "c1", name: "echo", arguments: "{}" }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      { text: "done", usage: { inputTokens: 8, outputTokens: 3 } },
    ]);
    const result = await runAgent({ messages: seed, provider, tools: [echoTool] });
    expect(result.usage).toEqual({ inputTokens: 18, outputTokens: 8 });
  });

  it("retries an empty-reply (non-deterministic) round and then settles", async () => {
    let calls = 0;
    const provider: AgentProvider = {
      async chat() {
        calls += 1;
        if (calls < 3) throw new EmptyReplyError("MALFORMED_FUNCTION_CALL");
        return { text: "got there on the third try" };
      },
    };
    const result = await runAgent({ messages: seed, provider, tools: [echoTool] });
    expect(calls).toBe(3);
    expect(result.text).toBe("got there on the third try");
  });

  it("gives up (propagates) if every attempt returns an empty reply", async () => {
    const provider: AgentProvider = {
      async chat() {
        throw new EmptyReplyError();
      },
    };
    await expect(runAgent({ messages: seed, provider, tools: [echoTool] })).rejects.toBeInstanceOf(EmptyReplyError);
  });

  it("fires onToolStart before running each tool", async () => {
    const { provider } = scriptedProvider([
      { text: "", toolCalls: [{ id: "c1", name: "echo", arguments: '{"a":2}' }] },
      { text: "done" },
    ]);
    const started: { name: string; args: unknown }[] = [];
    await runAgent({ messages: seed, provider, tools: [echoTool], onToolStart: (info) => started.push(info) });
    expect(started).toEqual([{ name: "echo", args: { a: 2 } }]);
  });

  it("records each act round as a step (narration + tools) and fires onStep per round", async () => {
    const { provider } = scriptedProvider([
      { text: "first I will echo", toolCalls: [{ id: "c1", name: "echo", arguments: '{"n":1}' }] },
      { text: "now once more", toolCalls: [{ id: "c2", name: "echo", arguments: '{"n":2}' }] },
      { text: "done" },
    ]);
    const emitted: unknown[] = [];
    const result = await runAgent({
      messages: seed,
      provider,
      tools: [echoTool],
      onStep: (step) => emitted.push(step),
    });

    expect(emitted).toEqual([
      { index: 0, text: "first I will echo", activity: [{ name: "echo", ok: true }] },
      { index: 1, text: "now once more", activity: [{ name: "echo", ok: true }] },
    ]);
    expect(result.steps).toHaveLength(2);
    expect(result.text).toBe("done");
    expect(result.stopped).toBeUndefined();
  });

  it("returns immediately (stopped) when the signal is already aborted, without calling the provider", async () => {
    const controller = new AbortController();
    controller.abort();
    const { provider, seen } = scriptedProvider([{ text: "hi" }]);
    const result = await runAgent({ messages: seed, provider, tools: [echoTool], signal: controller.signal });

    expect(result.stopped).toBe(true);
    expect(result.text).toBe("");
    expect(result.steps).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it("returns a partial, stopped result when interrupted mid-run", async () => {
    const controller = new AbortController();
    const cutTool: AgentTool = {
      name: "cut",
      description: "aborts the run",
      jsonSchema: { type: "object" },
      run: async () => {
        controller.abort();
        return { ok: true };
      },
    };
    const { provider, seen } = scriptedProvider([
      { text: "working on it", toolCalls: [{ id: "c1", name: "cut", arguments: "{}" }] },
      { text: "should not be reached" },
    ]);
    const result = await runAgent({ messages: seed, provider, tools: [cutTool], signal: controller.signal });

    expect(result.stopped).toBe(true);
    expect(result.invocations).toHaveLength(1);
    expect(result.steps).toEqual([{ text: "working on it", activity: [{ name: "cut", ok: true }] }]);
    // The loop stops before the second provider round.
    expect(seen).toHaveLength(1);
  });

  it("treats an AbortError as a stop only when our signal actually aborted", async () => {
    // The provider aborts the controller mid-request, then throws AbortError - a real user stop.
    const controller = new AbortController();
    const provider: AgentProvider = {
      async chat() {
        controller.abort();
        const error = new Error("The user aborted a request.");
        error.name = "AbortError";
        throw error;
      },
    };
    const result = await runAgent({ messages: seed, provider, tools: [echoTool], signal: controller.signal });

    expect(result.stopped).toBe(true);
    expect(result.text).toBe("");
  });

  it("surfaces an unexpected AbortError (signal never aborted) as an error, not a silent stop", async () => {
    // An AbortError while our signal was never aborted = a network drop / dev reload, not a user
    // stop. It must not masquerade as a clean stop (that is the "empty and stopped" bug).
    const provider: AgentProvider = {
      async chat() {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    };
    const controller = new AbortController();
    await expect(runAgent({ messages: seed, provider, tools: [echoTool], signal: controller.signal })).rejects.toThrow(
      /interrupted unexpectedly/i,
    );
  });
});

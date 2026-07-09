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
});

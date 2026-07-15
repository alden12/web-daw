import { describe, expect, it } from "vitest";
import { EmptyReplyError, parseReply, providerErrorMessage } from "../src/audio/agent/provider";

describe("parseReply", () => {
  it("pulls assistant text from an OpenAI-shaped response", () => {
    const raw = JSON.stringify({ choices: [{ message: { role: "assistant", content: "four on the floor" } }] });
    expect(parseReply(raw)).toEqual({ text: "four on the floor" });
  });

  it("pulls tool calls (with empty content) from the response", () => {
    const raw = JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "c1", type: "function", function: { name: "set_tempo", arguments: '{"bpm":128}' } }],
          },
        },
      ],
    });
    const reply = parseReply(raw);
    expect(reply.text).toBe("");
    expect(reply.toolCalls).toEqual([{ id: "c1", name: "set_tempo", arguments: '{"bpm":128}' }]);
  });

  it("reads token usage when the response includes it", () => {
    const raw = JSON.stringify({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    expect(parseReply(raw).usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("throws on non-JSON", () => {
    expect(() => parseReply("<html>gateway error</html>")).toThrow(/not valid JSON/);
  });

  it("throws when there are no choices", () => {
    expect(() => parseReply(JSON.stringify({ choices: [] }))).toThrow(/no choices/);
  });

  it("throws a retryable EmptyReplyError when a choice has neither text nor tool calls", () => {
    try {
      parseReply(JSON.stringify({ choices: [{ message: { content: "" } }] }));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EmptyReplyError);
      expect((error as Error).message).toMatch(/empty response/i);
    }
  });

  it("maps a finish_reason to a specific empty-reply message", () => {
    const lengthCase = () =>
      parseReply(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }));
    expect(lengthCase).toThrow(/output tokens/i);

    const malformed = () =>
      parseReply(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "MALFORMED_FUNCTION_CALL" }] }));
    expect(malformed).toThrow(/malformed tool call/i);
  });
});

describe("providerErrorMessage", () => {
  it("surfaces a plain-string error body", () => {
    const raw = JSON.stringify({ error: "Service temporarily unavailable." });
    expect(providerErrorMessage(raw, 503)).toMatch(/temporarily unavailable/i);
  });

  it("surfaces an upstream OpenAI-style { error: { message } }", () => {
    const raw = JSON.stringify({ error: { message: "model not found", code: 404 } });
    expect(providerErrorMessage(raw, 404)).toBe("model not found");
  });

  it("falls back to a generic message when the body is not JSON", () => {
    expect(providerErrorMessage("boom", 502)).toBe("The agent request failed (HTTP 502).");
  });

  it("gives 429 a friendly rate-limit message (naming the daily cap) instead of the quota dump", () => {
    const raw = JSON.stringify({ error: { code: 429, message: "You exceeded your current quota, blah blah" } });
    const message = providerErrorMessage(raw, 429);
    expect(message).toMatch(/rate limited/i);
    expect(message).toMatch(/per-day|daily/i);
    expect(message).not.toMatch(/quota/i);
  });
});

import { describe, expect, it } from "vitest";
import { parseReply, providerErrorMessage } from "../src/audio/agent/geminiProvider";

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

  it("throws on non-JSON", () => {
    expect(() => parseReply("<html>gateway error</html>")).toThrow(/not valid JSON/);
  });

  it("throws when there are no choices", () => {
    expect(() => parseReply(JSON.stringify({ choices: [] }))).toThrow(/no choices/);
  });

  it("throws when a choice has neither text nor tool calls", () => {
    expect(() => parseReply(JSON.stringify({ choices: [{ message: { content: "" } }] }))).toThrow(
      /no assistant text or tool calls/,
    );
  });
});

describe("providerErrorMessage", () => {
  it("surfaces the proxy's plain-string error (e.g. the missing-key hint)", () => {
    const raw = JSON.stringify({ error: "AGENT_API_KEY is not set. Add it to .env (see .env.example)." });
    expect(providerErrorMessage(raw, 503)).toMatch(/AGENT_API_KEY/);
  });

  it("surfaces an upstream OpenAI-style { error: { message } }", () => {
    const raw = JSON.stringify({ error: { message: "quota exceeded", code: 429 } });
    expect(providerErrorMessage(raw, 429)).toBe("quota exceeded");
  });

  it("falls back to a generic message when the body is not JSON", () => {
    expect(providerErrorMessage("boom", 502)).toBe("The agent request failed (HTTP 502).");
  });
});

import { describe, expect, it } from "vitest";
import { parseAssistantText, providerErrorMessage } from "../src/audio/agent/geminiProvider";

describe("parseAssistantText", () => {
  it("pulls the assistant content from an OpenAI-shaped response", () => {
    const raw = JSON.stringify({ choices: [{ message: { role: "assistant", content: "four on the floor it is" } }] });
    expect(parseAssistantText(raw)).toBe("four on the floor it is");
  });

  it("throws on non-JSON", () => {
    expect(() => parseAssistantText("<html>gateway error</html>")).toThrow(/not valid JSON/);
  });

  it("throws when there is no assistant text", () => {
    expect(() => parseAssistantText(JSON.stringify({ choices: [] }))).toThrow(/no assistant text/);
    expect(() => parseAssistantText(JSON.stringify({ choices: [{ message: {} }] }))).toThrow(/no assistant text/);
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

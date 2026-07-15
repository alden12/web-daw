import { describe, expect, it } from "vitest";
import { agentProxyConfig, AgentProxyError, buildUpstreamRequest, type AgentProxyConfig } from "../server/agentProxy";

const config: AgentProxyConfig = {
  apiKey: "test-key",
  baseUrl: "https://example.test/v1",
  model: "test-model",
};

describe("agentProxyConfig", () => {
  it("defaults the base url + model and strips trailing slashes", () => {
    const resolved = agentProxyConfig({ AGENT_API_KEY: "k", AGENT_BASE_URL: "https://host/v1//" });
    expect(resolved.apiKey).toBe("k");
    expect(resolved.baseUrl).toBe("https://host/v1");
    expect(resolved.model).toBe("gemini-2.5-flash");
  });

  it("reads an empty key when unset (so the proxy can report it cleanly)", () => {
    expect(agentProxyConfig({}).apiKey).toBe("");
  });
});

describe("buildUpstreamRequest", () => {
  const validBody = { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function" }] };

  it("throws 503 when the key is missing", () => {
    const attempt = () => buildUpstreamRequest(validBody, { ...config, apiKey: "" });
    expect(attempt).toThrow(AgentProxyError);
    expect(attempt).toThrow(/AGENT_API_KEY/);
    try {
      attempt();
    } catch (err) {
      expect((err as AgentProxyError).status).toBe(503);
    }
  });

  it("throws 400 on a malformed body (no messages)", () => {
    try {
      buildUpstreamRequest({ messages: [] }, config);
      expect.unreachable("should have rejected an empty message list");
    } catch (err) {
      expect((err as AgentProxyError).status).toBe(400);
    }
  });

  it("targets the chat-completions endpoint with a bearer key", () => {
    const { url, init } = buildUpstreamRequest(validBody, config);
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
  });

  it("injects the server-owned model and forwards the original body (incl. tools)", () => {
    const { init } = buildUpstreamRequest(validBody, config);
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("test-model");
    expect(sent.messages).toEqual(validBody.messages);
    expect(sent.tools).toEqual(validBody.tools);
    expect(sent.stream).toBe(false);
  });
});

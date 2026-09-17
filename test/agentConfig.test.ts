import { describe, expect, it } from "vitest";
import { activeKey, resolveModel, type AgentConfig } from "../src/audio/agent/config";
import { PROVIDERS, PROVIDER_IDS, toProviderId } from "../src/audio/agent/providers";

const base: AgentConfig = { provider: "gemini", keys: {}, models: {} };

describe("provider registry", () => {
  it("every provider has the fields the generic provider needs", () => {
    for (const id of PROVIDER_IDS) {
      const info = PROVIDERS[id];
      expect(info.baseUrl).toMatch(/^https:\/\//);
      expect(info.defaultModel).not.toBe("");
      expect(info.models).toContain(info.defaultModel);
      expect(info.keyUrl).toMatch(/^https:\/\//);
    }
  });

  it("only Anthropic opts in to direct browser calls", () => {
    expect(PROVIDERS.anthropic.extraHeaders).toMatchObject({ "anthropic-dangerous-direct-browser-access": "true" });
    expect(PROVIDERS.gemini.extraHeaders).toBeUndefined();
    expect(PROVIDERS.openai.extraHeaders).toBeUndefined();
  });

  it("toProviderId keeps known ids and defaults the rest to gemini", () => {
    expect(toProviderId("openai")).toBe("openai");
    expect(toProviderId("nope")).toBe("gemini");
    expect(toProviderId(undefined)).toBe("gemini");
  });
});

describe("resolveModel", () => {
  it("falls back to the active provider's default", () => {
    expect(resolveModel({ ...base, provider: "openai" })).toBe(PROVIDERS.openai.defaultModel);
  });

  it("uses the per-provider override (trimmed) when set", () => {
    expect(resolveModel({ ...base, provider: "openai", models: { openai: "  gpt-4o  " } })).toBe("gpt-4o");
  });

  it("ignores a blank override", () => {
    expect(resolveModel({ ...base, models: { gemini: "   " } })).toBe(PROVIDERS.gemini.defaultModel);
  });
});

describe("activeKey", () => {
  it("returns the active provider's key, trimmed", () => {
    expect(activeKey({ ...base, provider: "anthropic", keys: { anthropic: " sk-abc " } })).toBe("sk-abc");
  });

  it("returns empty when the active provider has no key (even if others do)", () => {
    expect(activeKey({ ...base, provider: "openai", keys: { gemini: "g-key" } })).toBe("");
  });
});

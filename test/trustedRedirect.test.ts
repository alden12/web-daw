/**
 * The consent page hands access only to Claude (AGENT-28): judged by the redirect, which an app
 * cannot fake, rather than the name it registered with, which it can.
 */
import { describe, expect, it } from "vitest";
import { isTrustedRedirect } from "../src/auth/trustedRedirect";

describe("isTrustedRedirect", () => {
  it("trusts Claude on the web and in the apps", () => {
    expect(isTrustedRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isTrustedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
  });

  it("trusts Claude Code's local listener, on any port", () => {
    expect(isTrustedRedirect("http://localhost:54321/callback")).toBe(true);
    expect(isTrustedRedirect("http://127.0.0.1:8080/callback")).toBe(true);
    expect(isTrustedRedirect("http://[::1]:9000/callback")).toBe(true);
  });

  it("refuses anywhere else, however close it looks", () => {
    expect(isTrustedRedirect("https://evil.example/callback")).toBe(false);
    expect(isTrustedRedirect("https://claude.ai.evil.example/callback")).toBe(false);
    expect(isTrustedRedirect("https://evil-claude.ai/callback")).toBe(false);
    expect(isTrustedRedirect("https://sub.claude.ai/callback")).toBe(false);
    expect(isTrustedRedirect("https://claude.ai@evil.example/callback")).toBe(false);
    expect(isTrustedRedirect("https://localhost.evil.example/callback")).toBe(false);
  });

  it("refuses Claude's host without HTTPS, and anything that is not a web address", () => {
    expect(isTrustedRedirect("http://claude.ai/api/mcp/auth_callback")).toBe(false);
    expect(isTrustedRedirect("javascript:alert(1)")).toBe(false);
    expect(isTrustedRedirect("claude://callback")).toBe(false);
    expect(isTrustedRedirect("not a url")).toBe(false);
  });
});

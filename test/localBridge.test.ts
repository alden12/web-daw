import { describe, expect, it } from "vitest";
import { localBridgeReachable } from "../src/audio/mcp/bridge";

describe("localBridgeReachable", () => {
  it("connects to the local MCP server only from a page served on this machine", () => {
    expect(localBridgeReachable("localhost")).toBe(true);
    expect(localBridgeReachable("127.0.0.1")).toBe(true);
    expect(localBridgeReachable("[::1]")).toBe(true);
    // The hosted app, and a phone on the LAN, could only fail to connect and retry forever.
    expect(localBridgeReachable("web-daw.fly.dev")).toBe(false);
    expect(localBridgeReachable("192.168.1.20")).toBe(false);
  });
});

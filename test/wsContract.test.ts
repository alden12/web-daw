import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage } from "../src/contract/ws";

// The WS contract is validated the same way the server will validate an inbound frame and
// the client an inbound reply: parse against the discriminated union. These guard the
// bidirectional typed pipe (and that message payloads reference the canonical schema).
describe("ws message contract", () => {
  it("accepts well-formed client messages", () => {
    expect(parseClientMessage({ type: "ping" }).success).toBe(true);
    expect(parseClientMessage({ type: "edit", projectId: "p1", command: { type: "addNote" } }).success).toBe(true);
  });

  it("rejects malformed client messages", () => {
    expect(parseClientMessage({ type: "bogus" }).success).toBe(false); // unknown discriminant
    expect(parseClientMessage({ type: "edit", projectId: "p1" }).success).toBe(false); // missing command
    expect(parseClientMessage("not an object").success).toBe(false);
    expect(parseClientMessage(null).success).toBe(false);
  });

  it("accepts well-formed server messages", () => {
    expect(parseServerMessage({ type: "pong" }).success).toBe(true);
    expect(
      parseServerMessage({ type: "editApplied", projectId: "p1", seq: 1, command: { type: "addNote" } }).success,
    ).toBe(true);
    expect(parseServerMessage({ type: "error", message: "bad frame" }).success).toBe(true);
  });

  it("rejects malformed server messages", () => {
    expect(parseServerMessage({ type: "error" }).success).toBe(false); // missing message
    expect(parseServerMessage({ type: "editApplied", projectId: "p1" }).success).toBe(false); // missing seq + command
  });
});

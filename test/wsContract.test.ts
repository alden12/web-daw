import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage } from "../src/contract/ws";

// The WS contract is validated the same way the server will validate an inbound frame and
// the client an inbound reply: parse against the discriminated union. These guard the
// bidirectional typed pipe (and that message payloads reference the canonical schema).
describe("ws message contract", () => {
  it("accepts well-formed client messages", () => {
    expect(parseClientMessage({ type: "ping" }).success).toBe(true);
    expect(parseClientMessage({ type: "subscribe", projectId: "p1" }).success).toBe(true);
    expect(
      parseClientMessage({ type: "edit", projectId: "p1", command: { type: "addNote" }, opId: "op-1", baseSeq: 3 })
        .success,
    ).toBe(true);
  });

  it("rejects malformed client messages", () => {
    expect(parseClientMessage({ type: "bogus" }).success).toBe(false); // unknown discriminant
    // missing opId/baseSeq (an edit must be identifiable + rebasable)
    expect(parseClientMessage({ type: "edit", projectId: "p1", command: { type: "addNote" } }).success).toBe(false);
    expect(parseClientMessage("not an object").success).toBe(false);
    expect(parseClientMessage(null).success).toBe(false);
  });

  it("accepts well-formed server messages", () => {
    expect(parseServerMessage({ type: "pong" }).success).toBe(true);
    expect(
      parseServerMessage({
        type: "editApplied",
        projectId: "p1",
        seq: 1,
        command: { type: "addNote" },
        author: "you",
        opId: "op-1",
      }).success,
    ).toBe(true);
    expect(parseServerMessage({ type: "snapshot", projectId: "p1", headSeq: 2, entries: [] }).success).toBe(true);
    expect(parseServerMessage({ type: "editRejected", opId: "op-1", reason: "forbidden" }).success).toBe(true);
    expect(parseServerMessage({ type: "error", message: "bad frame" }).success).toBe(true);
  });

  it("rejects malformed server messages", () => {
    expect(parseServerMessage({ type: "error" }).success).toBe(false); // missing message
    // missing author/opId (editApplied must attribute + echo the originator's op)
    expect(
      parseServerMessage({ type: "editApplied", projectId: "p1", seq: 1, command: { type: "addNote" } }).success,
    ).toBe(false);
  });
});

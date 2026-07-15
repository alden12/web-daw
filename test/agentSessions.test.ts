import { describe, expect, it } from "vitest";
import { titleFrom } from "../src/ui/agentSessions";
import type { ChatTurn } from "../src/ui/useAgentChat";

const user = (content: string): ChatTurn => ({ role: "user", content });
const assistant = (content: string): ChatTurn => ({ role: "assistant", content });

describe("titleFrom", () => {
  it("uses the first user message", () => {
    expect(titleFrom([user("make a bassline"), assistant("done")])).toBe("make a bassline");
  });

  it("collapses whitespace and truncates long titles", () => {
    const title = titleFrom([user("please  create\na   really long instruction that goes on well past the limit")]);
    expect(title.length).toBeLessThanOrEqual(41); // 40 chars + ellipsis
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("\n");
  });

  it("falls back to the placeholder with no user message", () => {
    expect(titleFrom([])).toBe("New chat");
    expect(titleFrom([assistant("hi")])).toBe("New chat");
  });
});

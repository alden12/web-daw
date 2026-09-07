import { describe, expect, it } from "vitest";
import { timeAgo } from "../src/ui/timeAgo";

/**
 * The relative time on history rows (DAW-8.14). Pure, so the boundaries are worth pinning: it is
 * the kind of function that gets "tidied" into `Math.floor` and quietly starts saying "0m ago".
 */
describe("timeAgo", () => {
  const now = 1_000_000_000_000;
  const ago = (ms: number) => timeAgo(now - ms, now);
  const seconds = 1000;
  const minutes = 60 * seconds;
  const hours = 60 * minutes;
  const days = 24 * hours;

  it("calls anything under 45 seconds 'just now', rather than counting them", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(44 * seconds)).toBe("just now");
    expect(ago(46 * seconds)).toBe("1m ago");
  });

  it("steps up through minutes, hours and days", () => {
    expect(ago(5 * minutes)).toBe("5m ago");
    expect(ago(59 * minutes)).toBe("59m ago");
    expect(ago(2 * hours)).toBe("2h ago");
    expect(ago(23 * hours)).toBe("23h ago");
    expect(ago(3 * days)).toBe("3d ago");
  });

  it("never counts backwards, however the two clocks disagree", () => {
    // A commit's time comes from whoever authored it, which in a shared session is someone else's
    // machine. A clock a few seconds ahead should read "just now", not "-1m ago".
    expect(ago(-30 * seconds)).toBe("just now");
    expect(ago(-2 * hours)).toBe("just now");
  });
});

import { describe, expect, it } from "vitest";
import {
  DETENT_ORDER,
  PROJECTION_MS,
  VELOCITY_WINDOW_MS,
  detentsFor,
  nearestDetent,
  projectDetent,
  stepDetent,
  trimSamples,
  velocityFrom,
  type PointerSample,
} from "../src/ui/shell/detents";

const PHONE = detentsFor({ tier: "phone", short: false });
const HEIGHT = 800;

describe("detentsFor", () => {
  it("gives a landscape phone its own set, whatever tier it lands in", () => {
    // A phone in landscape is ~844px wide, so it falls in the tablet tier while being the
    // shortest viewport the app sees. `short` has to win.
    const landscapePhone = detentsFor({ tier: "tablet", short: true });
    expect(landscapePhone).toEqual(detentsFor({ tier: "phone", short: true }));
    expect(landscapePhone).not.toEqual(detentsFor({ tier: "tablet", short: false }));
  });

  it("orders every set peek < half < full", () => {
    const shapes = [
      { tier: "phone", short: false },
      { tier: "phone", short: true },
      { tier: "tablet", short: false },
      { tier: "tablet", short: true },
    ] as const;
    shapes.forEach((shape) => {
      const detents = detentsFor(shape);
      expect(detents.peek).toBeLessThan(detents.half);
      expect(detents.half).toBeLessThan(detents.full);
      expect(detents.peek).toBeGreaterThan(0);
      expect(detents.full).toBeLessThanOrEqual(1);
    });
  });
});

describe("nearestDetent", () => {
  it("returns the detent it is sitting on", () => {
    DETENT_ORDER.forEach((detent) => {
      expect(nearestDetent(PHONE[detent], PHONE)).toBe(detent);
    });
  });

  it("saturates rather than running off either end", () => {
    expect(nearestDetent(-5, PHONE)).toBe("peek");
    expect(nearestDetent(5, PHONE)).toBe("full");
  });
});

describe("projectDetent", () => {
  it("snaps to the nearest detent when released at rest", () => {
    expect(projectDetent(PHONE.half, 0, HEIGHT, PHONE)).toBe("half");
  });

  it("picks a further detent the harder it is thrown, from one release point", () => {
    // The whole reason to project before snapping: released in the same place, travelling
    // in the same direction, only the speed decides where it ends up.
    const throwOf = (toDetent: keyof typeof PHONE) => ((PHONE.full - PHONE[toDetent]) * HEIGHT) / PROJECTION_MS;
    expect(projectDetent(PHONE.full, 0, HEIGHT, PHONE)).toBe("full");
    expect(projectDetent(PHONE.full, throwOf("half"), HEIGHT, PHONE)).toBe("half");
    expect(projectDetent(PHONE.full, throwOf("peek"), HEIGHT, PHONE)).toBe("peek");
  });

  it("keeps a gentle nudge on the detent it started from", () => {
    // Guards the other side of the same behaviour: a small movement must not count as a
    // throw, or the sheet would move every time you brushed it.
    const nudge = (0.02 * HEIGHT) / PROJECTION_MS;
    expect(projectDetent(PHONE.half, nudge, HEIGHT, PHONE)).toBe("half");
    expect(projectDetent(PHONE.half, -nudge, HEIGHT, PHONE)).toBe("half");
  });

  it("throws upward as well as downward", () => {
    const travel = PHONE.full - PHONE.peek;
    const velocity = -(travel * HEIGHT) / PROJECTION_MS;
    expect(projectDetent(PHONE.peek, velocity, HEIGHT, PHONE)).toBe("full");
  });

  it("falls back to the nearest detent when the workspace has not been measured", () => {
    // First paint, before the ResizeObserver has reported: dividing by zero here would
    // send the projection to infinity and always slam to an end stop.
    expect(projectDetent(PHONE.half, 12, 0, PHONE)).toBe("half");
  });
});

describe("stepDetent", () => {
  it("walks the order and saturates at both ends", () => {
    expect(stepDetent("peek", 1)).toBe("half");
    expect(stepDetent("half", 1)).toBe("full");
    expect(stepDetent("full", 1)).toBe("full");
    expect(stepDetent("half", -1)).toBe("peek");
    expect(stepDetent("peek", -1)).toBe("peek");
  });
});

describe("velocityFrom", () => {
  it("is zero without enough history to measure", () => {
    expect(velocityFrom([])).toBe(0);
    expect(velocityFrom([{ y: 0, t: 0 }])).toBe(0);
  });

  it("measures px per ms across the window", () => {
    const samples: PointerSample[] = [
      { y: 0, t: 0 },
      { y: 50, t: 50 },
      { y: 100, t: 100 },
    ];
    expect(velocityFrom(samples)).toBeCloseTo(1);
  });

  it("ignores samples older than the window", () => {
    // The stale first sample would halve the reported speed if it were included.
    const samples: PointerSample[] = [
      { y: 0, t: 0 },
      { y: 0, t: 900 },
      { y: 100, t: 1000 },
    ];
    expect(velocityFrom(samples)).toBeCloseTo(1);
  });

  it("reports zero rather than a huge number for samples in the same instant", () => {
    // Two events a fraction of a millisecond apart say nothing about speed; dividing by
    // that gap is how a stationary finger registers as a flick.
    expect(
      velocityFrom([
        { y: 0, t: 1000 },
        { y: 4, t: 1002 },
      ]),
    ).toBe(0);
  });
});

describe("trimSamples", () => {
  it("drops samples that have aged out", () => {
    const samples: PointerSample[] = [
      { y: 0, t: 0 },
      { y: 10, t: 950 },
      { y: 20, t: 1000 },
    ];
    expect(trimSamples(samples, 1000)).toEqual([
      { y: 10, t: 950 },
      { y: 20, t: 1000 },
    ]);
  });

  it("always keeps two, so a slow drag can still be measured", () => {
    // A finger that moves once every 300ms would otherwise trim down to a single sample
    // and report no velocity at all on release.
    const samples: PointerSample[] = [
      { y: 0, t: 0 },
      { y: 10, t: 300 },
    ];
    expect(trimSamples(samples, 1000)).toHaveLength(2);
  });

  it("keeps everything inside the window untouched", () => {
    const samples: PointerSample[] = [
      { y: 0, t: 1000 },
      { y: 10, t: 1000 + VELOCITY_WINDOW_MS },
    ];
    expect(trimSamples(samples, 1000 + VELOCITY_WINDOW_MS)).toEqual(samples);
  });
});

/**
 * The idle / visibility suspend logic for the realtime socket (src/contract/idleController.ts). Verifies
 * it closes an idle or hidden connection and reopens it on activity or when the tab is shown again - the
 * scale-to-zero lever (a held-open socket keeps the server awake) and the first offline-foundation seam.
 * DOM seams (`isHidden`, `onVisibilityChange`) are injected; timers run under vitest fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleController } from "../src/contract/idleController";

/** A controller wired to injected seams, exposing the recorded suspend/wake counts and a way to drive
 *  visibility from the test. `idleMs`/`hiddenGraceMs` are small so fake-timer advances read clearly. */
function makeController(overrides: { idleMs?: number; hiddenGraceMs?: number } = {}) {
  let hidden = false;
  let visibilityHandler = () => {};
  const events = { suspend: 0, wake: 0 };
  const controller = new IdleController({
    idleMs: overrides.idleMs ?? 1000,
    hiddenGraceMs: overrides.hiddenGraceMs ?? 100,
    onSuspend: () => (events.suspend += 1),
    onWake: () => {
      events.wake += 1;
      controller.onOpen(); // mimic the transport: a wake reopens and the open handler re-arms idle
    },
    isHidden: () => hidden,
    onVisibilityChange: (handler) => {
      visibilityHandler = handler;
      return () => (visibilityHandler = () => {});
    },
  });
  const setHidden = (value: boolean) => {
    hidden = value;
    visibilityHandler();
  };
  return { controller, events, setHidden };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("IdleController", () => {
  it("suspends after the idle interval with no activity", () => {
    const { controller, events } = makeController({ idleMs: 1000 });
    controller.onOpen();
    vi.advanceTimersByTime(999);
    expect(events.suspend).toBe(0);
    vi.advanceTimersByTime(1);
    expect(events.suspend).toBe(1);
    expect(controller.suspended).toBe(true);
  });

  it("activity resets the idle countdown, so a busy session never suspends", () => {
    const { controller, events } = makeController({ idleMs: 1000 });
    controller.onOpen();
    vi.advanceTimersByTime(900);
    controller.activity(); // resets the countdown
    vi.advanceTimersByTime(900);
    expect(events.suspend).toBe(0);
  });

  it("wakes on activity after an idle suspend, then re-arms the idle countdown", () => {
    const { controller, events } = makeController({ idleMs: 1000 });
    controller.onOpen();
    vi.advanceTimersByTime(1000);
    expect(controller.suspended).toBe(true);

    controller.activity(); // a send while suspended reopens the socket
    expect(events.wake).toBe(1);
    expect(controller.suspended).toBe(false);

    // The wake re-armed idle (via onOpen), so it suspends again after another quiet interval.
    vi.advanceTimersByTime(1000);
    expect(events.suspend).toBe(2);
  });

  it("suspends only after the grace period once the tab is hidden", () => {
    const { controller, events, setHidden } = makeController({ hiddenGraceMs: 100 });
    controller.onOpen();
    setHidden(true);
    vi.advanceTimersByTime(99);
    expect(events.suspend).toBe(0);
    vi.advanceTimersByTime(1);
    expect(events.suspend).toBe(1);
  });

  it("cancels the hidden-grace suspend if the tab is shown again in time", () => {
    const { controller, events, setHidden } = makeController({ hiddenGraceMs: 100 });
    controller.onOpen();
    setHidden(true);
    vi.advanceTimersByTime(50);
    setHidden(false); // back before the grace elapses
    vi.advanceTimersByTime(100);
    expect(events.suspend).toBe(0);
  });

  it("wakes immediately when the tab is shown again after a hidden suspend", () => {
    const { controller, events, setHidden } = makeController({ hiddenGraceMs: 100 });
    controller.onOpen();
    setHidden(true);
    vi.advanceTimersByTime(100);
    expect(controller.suspended).toBe(true);

    setHidden(false);
    expect(events.wake).toBe(1);
    expect(controller.suspended).toBe(false);
  });

  it("does not reconnect on an unexpected close while hidden, but marks itself suspended", () => {
    const { controller, setHidden } = makeController();
    controller.onOpen();
    setHidden(true); // hidden, but still within the grace window (not yet suspended)
    // The socket drops (server idled out, network blip): a hidden tab must not re-dial and re-wake it.
    expect(controller.shouldReconnectAfterClose()).toBe(false);
    expect(controller.suspended).toBe(true);
  });

  it("reconnects on an unexpected close while visible and active", () => {
    const { controller } = makeController();
    controller.onOpen();
    expect(controller.shouldReconnectAfterClose()).toBe(true);
  });

  it("stops all timers on dispose", () => {
    const { controller, events } = makeController({ idleMs: 1000 });
    controller.onOpen();
    controller.dispose();
    vi.advanceTimersByTime(5000);
    expect(events.suspend).toBe(0);
  });
});

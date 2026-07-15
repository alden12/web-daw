/**
 * The connection-status signal `createWsClient` surfaces to the UI (loading spinner / connection chip /
 * offline banner). Drives a fake WebSocket through open / unexpected-drop / reconnect / deliberate-close
 * and asserts the emitted WsStatus sequence. Fake timers keep the reconnect backoff under test control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWsClient, type WsStatus } from "../src/contract/client";

/** A minimal stand-in for the browser WebSocket: records instances and lets the test drive open/close. */
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  private readonly listeners: Record<string, Array<(event?: unknown) => void>> = {};
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, handler: (event?: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
  open(): void {
    this.readyState = 1;
    this.emit("open");
  }
  private emit(type: string): void {
    for (const handler of this.listeners[type] ?? []) handler();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createWsClient connection status", () => {
  it("goes connecting -> online -> offline -> online across an unexpected drop and reconnect", () => {
    const statuses: WsStatus[] = [];
    createWsClient({ baseUrl: "ws://x" }).onStatus((status) => statuses.push(status));

    expect(statuses).toEqual(["connecting"]); // fires immediately with the current state
    FakeWebSocket.instances[0].open();
    expect(statuses.at(-1)).toBe("online");

    FakeWebSocket.instances[0].close(); // unexpected drop
    expect(statuses.at(-1)).toBe("offline");

    vi.advanceTimersByTime(600); // backoff elapses -> a fresh socket is opened
    FakeWebSocket.instances[1].open();
    expect(statuses.at(-1)).toBe("online");
  });

  it("a deliberate close() does not report offline", () => {
    const statuses: WsStatus[] = [];
    const client = createWsClient({ baseUrl: "ws://x" });
    client.onStatus((status) => statuses.push(status));
    FakeWebSocket.instances[0].open();

    client.close();
    expect(statuses).toEqual(["connecting", "online"]); // no trailing "offline"
  });
});

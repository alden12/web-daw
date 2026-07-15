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
  readonly sent: string[] = [];
  /** When true, `close()` does not emit a "close" event - models a browser deferring the close of a
   *  half-open socket until connectivity returns (e.g. DevTools "Offline"). */
  deferClose = false;
  private readonly listeners: Record<string, Array<(event?: unknown) => void>> = {};
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, handler: (event?: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    if (!this.deferClose) this.emit("close");
  }
  open(): void {
    this.readyState = 1;
    this.emit("open");
  }
  /** Deliver a server message to the client (as the transport's message listener would receive it). */
  deliver(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }
  /** Whether a ping frame has been sent. */
  pinged(): boolean {
    return this.sent.some((raw) => JSON.parse(raw).type === "ping");
  }
  private emit(type: string, event?: unknown): void {
    for (const handler of this.listeners[type] ?? []) handler(event);
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

describe("createWsClient heartbeat (dead-socket detection)", () => {
  it("pings on a cadence and, when no pong arrives, closes the half-open socket and goes offline", () => {
    const statuses: WsStatus[] = [];
    createWsClient({ baseUrl: "ws://x", heartbeatMs: 1000, pongTimeoutMs: 200 }).onStatus((status) =>
      statuses.push(status),
    );
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(statuses.at(-1)).toBe("online");

    vi.advanceTimersByTime(1000); // heartbeat fires
    expect(ws.pinged()).toBe(true);

    vi.advanceTimersByTime(200); // no pong within the grace -> dead socket -> close -> reconnect path
    expect(statuses.at(-1)).toBe("offline");
  });

  it("goes offline on a dead socket even when the close event is deferred (half-open)", () => {
    const statuses: WsStatus[] = [];
    createWsClient({ baseUrl: "ws://x", heartbeatMs: 1000, pongTimeoutMs: 200 }).onStatus((status) =>
      statuses.push(status),
    );
    const ws = FakeWebSocket.instances[0];
    ws.deferClose = true; // the browser won't emit "close" until connectivity returns
    ws.open();

    vi.advanceTimersByTime(1000); // ping
    vi.advanceTimersByTime(200); // no pong: we must go offline now, not wait for the (deferred) close
    expect(statuses.at(-1)).toBe("offline");
  });

  it("stays online when pongs answer the heartbeat", () => {
    const statuses: WsStatus[] = [];
    createWsClient({ baseUrl: "ws://x", heartbeatMs: 1000, pongTimeoutMs: 200 }).onStatus((status) =>
      statuses.push(status),
    );
    const ws = FakeWebSocket.instances[0];
    ws.open();

    vi.advanceTimersByTime(1000); // ping
    ws.deliver({ type: "pong" }); // answered in time
    vi.advanceTimersByTime(200); // the (cleared) deadline passes harmlessly

    expect(statuses).toEqual(["connecting", "online"]); // never went offline
  });
});

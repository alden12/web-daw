/**
 * Idle / visibility lifecycle for the realtime WebSocket. A held-open socket is an active connection,
 * so it pins the (scale-to-zero) server awake even when the user is doing nothing; and a backgrounded
 * or asleep machine keeps its socket open just like a foreground tab. This controller suspends the
 * socket when the session goes quiet - after `idleMs` of no outbound activity, or `hiddenGraceMs` after
 * the tab is hidden - and wakes it on the next activity or when the tab is shown again. It is the first
 * concrete piece of the offline foundation: "tab hidden / idle" and "network lost" both reduce to the
 * same go-offline / resync-on-return path (the transport's reconnect re-runs `SharedSession.resync`).
 *
 * It owns only the *decision* (when to suspend / wake / whether to reconnect); the transport owns the
 * socket and supplies `onSuspend` (close, no reconnect) and `onWake` (reopen). DOM seams (`isHidden`,
 * `onVisibilityChange`) are injected so this is unit-testable under Node's no-jsdom test env and a no-op
 * where there is no `document`.
 */

/** Default: five minutes of no outbound activity suspends the socket. */
export const DEFAULT_IDLE_MS = 5 * 60_000;
/** Default: suspend thirty seconds after the tab is hidden (a grace so tab-switching does not thrash). */
export const DEFAULT_HIDDEN_GRACE_MS = 30_000;

export interface IdleControllerConfig {
  /** Suspend after this many ms of no outbound activity. */
  idleMs?: number;
  /** Suspend this many ms after the tab becomes hidden. */
  hiddenGraceMs?: number;
  /** Close the live socket without reconnecting (the session has gone idle/hidden). */
  onSuspend: () => void;
  /** Reopen the socket; the transport's open handler re-runs `resync`, so state self-heals. */
  onWake: () => void;
  /** Whether the document is currently hidden. Defaults to `document.hidden`. */
  isHidden?: () => boolean;
  /** Register a visibility-change listener, returning an unsubscribe. Defaults to the DOM event; a no-op
   *  where there is no `document` (Node / tests without jsdom). */
  onVisibilityChange?: (handler: () => void) => () => void;
}

const defaultIsHidden = (): boolean => typeof document !== "undefined" && document.hidden;

const defaultOnVisibilityChange = (handler: () => void): (() => void) => {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
};

export class IdleController {
  private readonly idleMs: number;
  private readonly hiddenGraceMs: number;
  private readonly onSuspend: () => void;
  private readonly onWake: () => void;
  private readonly isHidden: () => boolean;
  private readonly unsubscribeVisibility: () => void;

  /** True while the socket is deliberately closed (idle/hidden), so the transport must not auto-reconnect
   *  until we wake it. Distinct from the transport's permanent `close()`. */
  private suspendedFlag = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(config: IdleControllerConfig) {
    this.idleMs = config.idleMs ?? DEFAULT_IDLE_MS;
    this.hiddenGraceMs = config.hiddenGraceMs ?? DEFAULT_HIDDEN_GRACE_MS;
    this.onSuspend = config.onSuspend;
    this.onWake = config.onWake;
    this.isHidden = config.isHidden ?? defaultIsHidden;
    this.unsubscribeVisibility = (config.onVisibilityChange ?? defaultOnVisibilityChange)(() =>
      this.handleVisibilityChange(),
    );
  }

  get suspended(): boolean {
    return this.suspendedFlag;
  }

  /** The socket opened: clear any suspend state and start a fresh idle countdown. */
  onOpen(): void {
    this.suspendedFlag = false;
    this.armIdle();
  }

  /** An outbound send: reset the idle countdown, waking the socket first if it was suspended. */
  activity(): void {
    if (this.suspendedFlag) this.wake();
    else this.armIdle();
  }

  /**
   * The socket closed unexpectedly (not a deliberate `close()`). Returns whether the transport should
   * auto-reconnect: no while suspended, and no while hidden - a hidden drop is turned into a suspend so a
   * later `visible` wakes it, instead of the reconnect loop re-waking the server every few seconds.
   */
  shouldReconnectAfterClose(): boolean {
    if (this.suspendedFlag) return false;
    if (this.isHidden()) {
      this.suspendedFlag = true;
      this.clearIdle();
      return false;
    }
    return true;
  }

  /** Tear down listeners and timers (on the transport's permanent close). */
  dispose(): void {
    this.clearIdle();
    this.clearHidden();
    this.unsubscribeVisibility();
  }

  private handleVisibilityChange(): void {
    this.clearHidden();
    if (this.isHidden()) {
      this.hiddenTimer = setTimeout(() => this.suspend(), this.hiddenGraceMs);
    } else if (this.suspendedFlag) {
      this.wake();
    }
  }

  private suspend(): void {
    if (this.suspendedFlag) return;
    this.suspendedFlag = true;
    this.clearIdle();
    this.clearHidden();
    this.onSuspend();
  }

  private wake(): void {
    if (!this.suspendedFlag) return;
    // Clear the flag before reopening so a failed wake-connect falls back to the transport's normal
    // reconnect backoff rather than staying stuck suspended. `onOpen` re-arms the idle countdown.
    this.suspendedFlag = false;
    this.onWake();
  }

  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.suspend(), this.idleMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private clearHidden(): void {
    if (this.hiddenTimer !== undefined) clearTimeout(this.hiddenTimer);
    this.hiddenTimer = undefined;
  }
}

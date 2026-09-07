/**
 * Relative time for history rows ("just now", "5m ago"), and the ticker that keeps it honest.
 *
 * Both halves of the history UI want this: the Versions timeline has shown it since it was built,
 * and the Activity feed's commit markers now do too (DAW-8.14). It lived inside `VersionTimeline`
 * before, which is why the feed had no times - the code was there, just not reachable.
 *
 * `now` is passed in rather than read inside, because a component that calls `Date.now()` while
 * rendering produces a different tree every time it renders and never updates on its own. The
 * clock is state, ticked on an interval, so a row that says "5m ago" becomes "6m ago" without
 * anything else changing.
 */
import { useEffect, useState } from "react";

/** Coarse by design: history rows want "roughly when", and a live-updating "42s ago" is noise. */
export function timeAgo(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * `Date.now()` as state, re-read on an interval. The default matches the coarsest thing `timeAgo`
 * distinguishes below an hour, so every visible step is caught without re-rendering for nothing.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

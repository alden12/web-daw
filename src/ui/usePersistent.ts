/**
 * Tiny persisted-state hooks: like useState, but the value is mirrored to
 * localStorage so panel sizes and collapse state survive a reload. Reads are
 * lazy (once, on mount) and clamped; writes are best-effort (storage can throw
 * in private mode, so failures are swallowed - the UI still works in-session).
 */
import { useCallback, useState } from "react";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable - in-memory only */
  }
}

/** A number persisted under `key`, clamped to [min, max] on read and write. */
export function usePersistentNumber(key: string, fallback: number, min: number, max: number) {
  const [value, setValue] = useState(() => {
    const raw = read(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  });
  const set = useCallback(
    (n: number) => {
      const next = Math.min(max, Math.max(min, n));
      setValue(next);
      write(key, String(next));
    },
    [key, min, max],
  );
  return [value, set] as const;
}

/** A boolean persisted under `key`. */
export function usePersistentBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => {
    const raw = read(key);
    return raw === null ? fallback : raw === "true";
  });
  const set = useCallback(
    (b: boolean) => {
      setValue(b);
      write(key, String(b));
    },
    [key],
  );
  return [value, set] as const;
}

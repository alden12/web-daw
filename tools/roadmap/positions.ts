import type { XYPosition } from "@xyflow/react";

/** Manual layout (node positions + resized box sizes) persists in localStorage keyed by node id (stable
 *  ticket ids / `area:*`), so a layout you arrange by hand survives reload and doc regeneration. New/renamed
 *  ids just fall back to the auto-layout. */
const POSITIONS_KEY = "roadmap.positions.v1";
const SIZES_KEY = "roadmap.sizes.v1";

export interface BoxSize {
  width: number;
  height: number;
}

function load<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function save<T>(key: string, value: Record<string, T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / unavailable storage - manual layout is a convenience, not essential state
  }
}

export const loadPositions = (): Record<string, XYPosition> => load<XYPosition>(POSITIONS_KEY);
export const savePositions = (positions: Record<string, XYPosition>): void => save(POSITIONS_KEY, positions);

export const loadSizes = (): Record<string, BoxSize> => load<BoxSize>(SIZES_KEY);
export const saveSizes = (sizes: Record<string, BoxSize>): void => save(SIZES_KEY, sizes);

export function clearLayout(): void {
  try {
    localStorage.removeItem(POSITIONS_KEY);
    localStorage.removeItem(SIZES_KEY);
  } catch {
    // ignore
  }
}

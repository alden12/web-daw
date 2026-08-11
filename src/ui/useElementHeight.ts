/**
 * An element's height, kept current by a ResizeObserver. Measured in a layout effect, so
 * the first painted frame already has the real number rather than a zero that corrects
 * itself a frame later.
 */
import { useLayoutEffect, useState, type RefObject } from "react";

export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setHeight(element.clientHeight);
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

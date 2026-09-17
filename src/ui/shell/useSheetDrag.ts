/**
 * The editor sheet's gesture (MOBILE-5): drag it, throw it, and let it settle.
 *
 * Three things here are load-bearing and easy to get subtly wrong:
 *
 * 1. **Nothing re-renders during the drag.** The transform is written straight to the
 *    node, the same discipline `useSharedGridScroll` uses - a React state write per
 *    pointermove would re-render the whole workspace (arrangement, roll, rack) at 120Hz.
 *    React only hears about it once, when the sheet settles.
 * 2. **The settle is a spring seeded with the release velocity**, not a CSS transition. A
 *    transition restarts from rest and discards the speed you built, which is exactly the
 *    discontinuity people read as "not native". Carrying the velocity through costs about
 *    ten lines and is the single biggest difference in how the gesture feels.
 * 3. **Transform while moving, layout on settle.** The sheet is full height and translated
 *    down; animating its height instead would relayout the piano roll every frame.
 *
 * The pure maths (detents, projection, velocity fitting) is in `detents.ts` so it can be
 * tested without a DOM.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { projectDetent, trimSamples, velocityFrom, type Detent, type DetentSet, type PointerSample } from "./detents";

/** Critically-damped-ish. Fast enough to feel decisive, slow enough to read as physical. */
const STIFFNESS = 220;
const DAMPING = 26;
/** Sub-step the integration: a stiff spring on a dropped frame explodes at a variable dt. */
const MAX_STEP_S = 0.004;
const REST_POSITION = 0.4;
const REST_VELOCITY = 8;
/** Past the end stops the sheet gives, rather than hitting a wall. */
const RUBBER_BAND = 0.22;

export interface SheetDrag {
  /** Attach to the sheet element itself - it owns the transform. */
  sheetRef: React.RefObject<HTMLDivElement | null>;
  /** Spread onto whatever should drag the sheet (the whole header, not just the grabber). */
  handleProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
  };
}

export function useSheetDrag({
  detent,
  detents,
  onDetentChange,
}: {
  detent: Detent;
  detents: DetentSet;
  onDetentChange: (next: Detent) => void;
}): SheetDrag {
  const sheetRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef(detents[detent]);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startCover: number; samples: PointerSample[] } | null>(
    null,
  );

  /** The band the sheet moves in - its offset parent, which is the workspace column. */
  const workspaceHeight = useCallback(() => sheetRef.current?.parentElement?.clientHeight ?? 0, []);

  /**
   * Mid-gesture: full height, translated. Cheap (no layout), but the content below the
   * fold is off-screen, which is fine for the ~300ms a drag lasts.
   */
  const paint = useCallback(
    (cover: number) => {
      coverRef.current = cover;
      const node = sheetRef.current;
      if (!node) return;
      node.style.height = "100%";
      node.style.transform = `translate3d(0, ${Math.round(workspaceHeight() * (1 - cover))}px, 0)`;
    },
    [workspaceHeight],
  );

  /**
   * At rest: the sheet takes exactly the height it covers, and the transform goes away.
   *
   * This is the other half of "transform while moving, layout on settle", and without it
   * the sheet is *always* laid out at the full workspace height - so at Half the bottom
   * 45% of the editor, including the piano roll's horizontal scroller, sits below the
   * screen where it cannot be reached.
   *
   * The swap does not move anything: the sheet is anchored to the bottom, so a box of
   * `cover` height with no transform has its top edge in exactly the same place as a
   * full-height box translated down by `(1 - cover)`.
   */
  const commit = useCallback((cover: number) => {
    coverRef.current = cover;
    const node = sheetRef.current;
    if (!node) return;
    node.style.height = `${cover * 100}%`;
    node.style.transform = "translate3d(0, 0, 0)";
  }, []);

  const stopSpring = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  /** Settle to `target`, carrying `velocity` (px/ms, positive downward) into the spring. */
  const springTo = useCallback(
    (target: number, velocity: number) => {
      stopSpring();
      const height = workspaceHeight();
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!height || reduceMotion) {
        commit(target);
        return;
      }
      // Integrate in pixels of coverage so the constants read like any other spring.
      let position = coverRef.current * height;
      let speed = -velocity * 1000; // downward pointer travel shrinks coverage
      const goal = target * height;
      let last = performance.now();
      const step = (now: number) => {
        const elapsed = Math.min((now - last) / 1000, 0.064);
        last = now;
        const steps = Math.max(1, Math.ceil(elapsed / MAX_STEP_S));
        const dt = elapsed / steps;
        for (let index = 0; index < steps; index++) {
          const acceleration = -STIFFNESS * (position - goal) - DAMPING * speed;
          speed += acceleration * dt;
          position += speed * dt;
        }
        if (Math.abs(position - goal) < REST_POSITION && Math.abs(speed) < REST_VELOCITY) {
          frameRef.current = null;
          commit(target); // hand the height back to layout now that it has stopped
          return;
        }
        paint(position / height);
        frameRef.current = requestAnimationFrame(step);
      };
      frameRef.current = requestAnimationFrame(step);
    },
    [commit, paint, stopSpring, workspaceHeight],
  );

  /**
   * Follow the detent when something else moves it (selecting a track, a keyboard step).
   * Not during a drag - the finger wins.
   *
   * A **layout** effect, and the first placement is painted rather than sprung: the sheet
   * renders with no transform, which is "covering everything", so animating into position
   * from an ordinary effect would show one frame of the sheet over the whole arrangement
   * before it dropped to Half. Positioning before the browser paints removes the flash.
   */
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (dragRef.current) return;
    if (!placed.current) {
      placed.current = true;
      commit(detents[detent]);
      return;
    }
    springTo(detents[detent], 0);
  }, [commit, detent, detents, springTo]);

  useEffect(() => stopSpring, [stopSpring]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Buttons inside the header keep their taps; everything else is drag surface.
      if ((event.target as HTMLElement).closest("button, a, input, select")) return;
      stopSpring();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startCover: coverRef.current,
        samples: [{ y: event.clientY, t: event.timeStamp }],
      };
      event.preventDefault();
    },
    [stopSpring],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const height = workspaceHeight();
      if (!height) return;
      drag.samples.push({ y: event.clientY, t: event.timeStamp });
      drag.samples = trimSamples(drag.samples, event.timeStamp);
      const raw = drag.startCover - (event.clientY - drag.startY) / height;
      const min = 0.02;
      const banded = raw > 1 ? 1 + (raw - 1) * RUBBER_BAND : raw < min ? min + (raw - min) * RUBBER_BAND : raw;
      paint(banded);
    },
    [paint, workspaceHeight],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      const height = workspaceHeight();
      const velocity = velocityFrom(drag.samples);
      const landing = projectDetent(coverRef.current, velocity, height, detents);
      springTo(detents[landing], velocity);
      // The one React write in the whole gesture, and only if it actually moved.
      if (landing !== detent) onDetentChange(landing);
    },
    [detent, detents, onDetentChange, springTo, workspaceHeight],
  );

  return {
    sheetRef,
    handleProps: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}

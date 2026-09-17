/**
 * A panel that slides in over the app from one edge, with a scrim behind it (MOBILE-1).
 * The touch shell uses two: the library from the left, the agent from the right.
 *
 * **Stays mounted once opened**, sliding out of view rather than unmounting. That is not
 * an optimisation - the agent panel holds a live, interruptible run (AGENT-10), and
 * unmounting it mid-request would abort work the user is waiting on. Keeping it mounted
 * also means a reopened sheet is exactly where you left it, scroll position included.
 * While closed it is `inert`, so nothing inside takes focus or answers a tap.
 *
 * Mounting is lazy: a sheet that has never been opened renders nothing at all, so the
 * agent's chat machinery does not start up on a shell that never asks for it.
 */
import { useEffect, useState, type ReactNode } from "react";

export function Sheet({
  open,
  side,
  label,
  onClose,
  widthClass,
  children,
}: {
  open: boolean;
  side: "left" | "right";
  /** Accessible name for the dialog. */
  label: string;
  onClose: () => void;
  /** How much of the screen it covers. Defaults to most of it. */
  widthClass?: string;
  children: ReactNode;
}) {
  // Adjusted during render rather than in an effect: this is state derived from a prop,
  // and React re-runs the render before committing, so there is no cascading pass.
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);

  // Escape closes, matching the app's other dismissible surfaces.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!everOpened) return null;

  const hidden = side === "left" ? "-translate-x-full" : "translate-x-full";
  return (
    <>
      {/* The scrim is the tap target for dismissing; it fades rather than sliding, so a
          half-open sheet never looks detached from it. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 z-40 bg-black/55 transition-opacity duration-200 motion-reduce:transition-none ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      <div
        role="dialog"
        aria-modal={open}
        aria-label={label}
        inert={!open}
        className={`absolute top-0 bottom-0 z-50 flex flex-col bg-panel ${
          side === "left"
            ? "left-0 border-r shadow-[14px_0_40px_-12px_var(--sheet-shadow)]"
            : "right-0 border-l shadow-[-14px_0_40px_-12px_var(--sheet-shadow)]"
        } border-line ${widthClass ?? "w-[88%] max-w-108"} transition-transform duration-200 motion-reduce:transition-none ${
          open ? "translate-x-0" : `${hidden} pointer-events-none`
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {children}
      </div>
    </>
  );
}

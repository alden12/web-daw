/**
 * Knowing that a new version is waiting, and taking it (MOBILE-3).
 *
 * The worker is registered on `registerType: "prompt"`, which means a new one installs in the
 * background and then **waits**: it does not call `skipWaiting`, so it will not activate under
 * someone in the middle of a take. That is the right default and it has a cost, which a phone
 * found immediately: the new version arrives on the load *after* the one that downloaded it, so
 * you are always a launch behind, and on an installed app "close it" means swiping it out of the
 * recents list rather than just going to the home screen.
 *
 * So the waiting worker is surfaced as a choice instead. `updateSW(true)` tells it to take over
 * and reloads once it has - the same thing the close-and-reopen dance does, in one tap and at a
 * moment the person picked.
 *
 * Registration stays eager (from `main.tsx`, before React mounts) rather than moving into the
 * hook: a worker that only installs once a component has rendered is a worker that is not there
 * for the render that needed it. The hook subscribes to what registration finds.
 */
import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

let applyWaitingUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;
const listeners = new Set<() => void>();

const announce = () => {
  waiting = true;
  listeners.forEach((listener) => listener());
};

/** Install the worker and start watching for a newer one. Called once, from `main.tsx`. */
export function registerServiceWorker(): void {
  applyWaitingUpdate = registerSW({ onNeedRefresh: announce });
}

/** Whether a new version has finished downloading and is waiting to take over. */
export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => void listeners.delete(onStoreChange);
    },
    () => waiting,
    () => false,
  );
}

/** Let the waiting worker take over, then reload onto it. */
export function applyUpdate(): void {
  void applyWaitingUpdate?.(true);
}

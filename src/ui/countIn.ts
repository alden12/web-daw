/**
 * The count-in: bars of clicks before a take starts. A persisted preference of this browser,
 * set on the settings panel's Timing page (MOBILE-19) and pushed to the recorder by the timeline.
 *
 * It used to be a menu row in the timeline's toolbar kebab and then the touch shell's ⋮, built here
 * so both could ask for it (MOBILE-11); with both on the Timing page now, only the value is left.
 */
import { usePersistentNumber } from "./usePersistent";

export const useCountInBars = () => usePersistentNumber("corrente:count-in-bars", 1, 0, 2);

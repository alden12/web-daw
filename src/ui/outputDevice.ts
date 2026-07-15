/**
 * The chosen audio output device, persisted in localStorage. The settings UI edits it
 * (via usePersistentString) and calls engine.setOutputDevice; AppShell reads it once on
 * audio start to route the master bus to the remembered device. Empty string = the system
 * default output. Only meaningful where AudioContext.setSinkId exists (Chrome/Edge).
 */
export const OUTPUT_DEVICE_KEY = "web-daw:output-device";

/** The remembered output device id, or "" for the system default. */
export const readOutputDeviceId = (): string => {
  try {
    return localStorage.getItem(OUTPUT_DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
};

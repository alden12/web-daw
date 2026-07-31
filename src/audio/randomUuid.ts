/**
 * `crypto.randomUUID()`, with a fallback for insecure contexts.
 *
 * `randomUUID` is **secure-context-only**: over plain http from anything but `localhost`
 * it is simply `undefined`. That is exactly how the touch shell gets tested on a real
 * phone (`vite --host`, opened at the laptop's LAN address), and the failure is about as
 * unhelpful as it gets - the very first id the app generates throws, `AppShell` fails to
 * mount, and the page is blank with nothing on screen to say why.
 *
 * `crypto.getRandomValues` carries no such restriction, so the fallback assembles a v4
 * UUID from it. Same shape, same entropy source, no secure-context requirement.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1 (RFC 4122)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

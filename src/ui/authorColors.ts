/**
 * Author colours: the accent hue for each author (voice), chosen by the user from a fixed
 * swatch palette and held in this browser's localStorage. Pure data + a subscribe seam (no
 * DOM, no React), mirroring the agent config store; a cached snapshot keeps `readAuthorColors`
 * referentially stable so it is safe as a `useSyncExternalStore` getSnapshot.
 *
 * The config is a generic `author -> hex` map, not three fixed fields, and `colorForAuthor`
 * hashes any unknown author id into the palette. So although only the three voices (you /
 * agent / claude) are configurable today, the same mechanism already resolves a stable colour
 * for an arbitrary number of authors - the seam multi-user presence will grow into. Colour is
 * derived here; the *authorship* (who last edited a thing) is stored on the project data.
 */
import { DEFAULT_VOICE_COLORS, type Voice } from "./authorVoice";

/** A pickable colour. `hex` is what lands in the CSS var / inline style. */
export interface Swatch {
  id: string;
  hex: string;
  name: string;
}

/**
 * The palette a user picks from: a curated set that stays legible on the dark theme and
 * mutually distinguishable (so two authors rarely read as the same). The three voice
 * defaults lead so they are always present as swatches.
 */
export const SWATCHES: Swatch[] = [
  { id: "teal", hex: DEFAULT_VOICE_COLORS.you, name: "Teal" },
  { id: "violet", hex: DEFAULT_VOICE_COLORS.agent, name: "Violet" },
  { id: "coral", hex: DEFAULT_VOICE_COLORS.claude, name: "Coral" },
  { id: "sky", hex: "#5aa9e6", name: "Sky" },
  { id: "mint", hex: "#5fd0a0", name: "Mint" },
  { id: "lime", hex: "#9ecb64", name: "Lime" },
  { id: "amber", hex: "#e0a458", name: "Amber" },
  { id: "rose", hex: "#e26d8f", name: "Rose" },
  { id: "orchid", hex: "#d98cd0", name: "Orchid" },
  { id: "cornflower", hex: "#7f8ce6", name: "Cornflower" },
];

/** author id -> chosen hex. Only overrides are stored; unset authors fall back. */
export type AuthorColorConfig = Record<string, string>;

const STORAGE_KEY = "web-daw:author-colors:v1";
const HEX = /^#[0-9a-fA-F]{6}$/;
const listeners = new Set<() => void>();

function store(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // localStorage can throw (privacy mode); degrade to defaults
  }
}

/** Keep only entries whose value is a valid #rrggbb hex. */
function cleanConfig(value: unknown): AuthorColorConfig {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, hex]) => typeof hex === "string" && HEX.test(hex)),
  ) as AuthorColorConfig;
}

function readFromStorage(): AuthorColorConfig {
  const raw = store()?.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return cleanConfig(JSON.parse(raw));
  } catch {
    return {};
  }
}

let cached: AuthorColorConfig = readFromStorage();

/** The current author-colour overrides (a stable reference until the next write). */
export function readAuthorColors(): AuthorColorConfig {
  return cached;
}

/** Replace the overrides and notify subscribers. */
export function writeAuthorColors(config: AuthorColorConfig): void {
  cached = cleanConfig(config);
  store()?.setItem(STORAGE_KEY, JSON.stringify(cached));
  for (const listener of listeners) listener();
}

/** Subscribe to author-colour changes. Returns an unsubscribe fn. */
export function subscribeAuthorColors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable non-negative hash of a string, for hashing unknown author ids into the palette. */
function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * The colour (hex) for an author. A configured override wins; otherwise a known voice uses its
 * default, and any other author id is hashed deterministically into the palette - so an
 * arbitrary future collaborator id already resolves to a stable, distinct hue.
 */
export function colorForAuthor(author: string, config: AuthorColorConfig = cached): string {
  const override = config[author];
  if (override) return override;
  if (author in DEFAULT_VOICE_COLORS) return DEFAULT_VOICE_COLORS[author as Voice];
  return SWATCHES[hashString(author) % SWATCHES.length].hex;
}

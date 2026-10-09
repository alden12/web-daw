/**
 * The tag vocabulary (COMM-1.2), as data: what a device can be tagged with, built-in or published.
 *
 * Curated rather than free-form so search stays clean: a **role** says what a sound is for, a
 * **character** says what it sounds like. Built-in catalog entries and factory patches tag
 * themselves from this map (COMM-1.9.1), and Explore iterates it for its chips, so a new tag is
 * one entry here. Pure data, so the Node MCP server can read it too.
 *
 * `space` and `rhythm` extend COMM-1.2's starting list: the built-in effects and MIDI devices
 * needed a role, and none of the instrument roles fit a reverb or a Euclidean sequencer.
 */
export const TAGS = {
  bass: { label: "bass", group: "role" },
  lead: { label: "lead", group: "role" },
  pad: { label: "pad", group: "role" },
  pluck: { label: "pluck", group: "role" },
  keys: { label: "keys", group: "role" },
  arp: { label: "arp", group: "role" },
  fx: { label: "fx", group: "role" },
  percussion: { label: "percussion", group: "role" },
  space: { label: "space", group: "role" },
  rhythm: { label: "rhythm", group: "role" },
  warm: { label: "warm", group: "character" },
  bright: { label: "bright", group: "character" },
  dark: { label: "dark", group: "character" },
  gritty: { label: "gritty", group: "character" },
  airy: { label: "airy", group: "character" },
  lush: { label: "lush", group: "character" },
  glassy: { label: "glassy", group: "character" },
  retro: { label: "retro", group: "character" },
  aggressive: { label: "aggressive", group: "character" },
  soft: { label: "soft", group: "character" },
} as const satisfies Record<string, { label: string; group: "role" | "character" }>;

export type Tag = keyof typeof TAGS;

/** Every tag, in vocabulary order: roles first, then character. */
export const TAG_KEYS = Object.keys(TAGS) as Tag[];

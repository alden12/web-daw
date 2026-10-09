/**
 * Tags (COMM-1.2): what a device is for, and what it sounds like.
 *
 * A tag is **any string**. Published devices will carry whatever their authors give them, so
 * nothing here may need to know a tag in advance: search, filtering and the chip ranking all work on
 * plain strings. What this module holds is the **known** tags - the suggested vocabulary - as data:
 * the built-ins tag themselves from it so they stay consistent, it is what a publish form would
 * suggest (and CLAP could, COMM-1.5), and it groups the "More tags" panel into role and character.
 * A tag it does not know is just as valid, and lists under "other".
 *
 * `space` and `rhythm` extend COMM-1.2's starting list: the built-in effects and MIDI devices needed
 * a role, and none of the instrument roles fit a reverb or a Euclidean sequencer.
 */
export type TagGroup = "role" | "character";

export const KNOWN_TAGS = {
  bass: "role",
  lead: "role",
  pad: "role",
  pluck: "role",
  keys: "role",
  arp: "role",
  fx: "role",
  percussion: "role",
  space: "role",
  rhythm: "role",
  warm: "character",
  bright: "character",
  dark: "character",
  gritty: "character",
  airy: "character",
  lush: "character",
  glassy: "character",
  retro: "character",
  aggressive: "character",
  soft: "character",
} as const satisfies Record<string, TagGroup>;

export type KnownTag = keyof typeof KNOWN_TAGS;

/** Any tag. The known ones autocomplete; any other string is just as valid. */
export type Tag = KnownTag | (string & {});

const KNOWN_ORDER: readonly string[] = Object.keys(KNOWN_TAGS);

/** Which group a tag lists under in "More tags": its known group, or "other". */
export const tagGroup = (tag: Tag): TagGroup | "other" => (KNOWN_TAGS as Record<string, TagGroup>)[tag] ?? "other";

/** The order tags list in: known tags in vocabulary order (roles first), then the rest A to Z. */
export function byTagOrder(left: Tag, right: Tag): number {
  const rank = (tag: Tag) => {
    const index = KNOWN_ORDER.indexOf(tag);
    return index < 0 ? KNOWN_ORDER.length : index;
  };
  return rank(left) - rank(right) || left.localeCompare(right);
}

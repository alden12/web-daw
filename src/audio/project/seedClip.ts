/**
 * The id of the clip a new track is created holding. Derived rather than minted so a replay makes
 * the same one, and so the authorship stamp for a created track can name it (DAW-8.10).
 */
export const seedClipId = (trackId: string): string => `c-${trackId}`;

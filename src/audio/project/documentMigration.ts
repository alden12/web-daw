/**
 * Forward migration of the project document (project.json) across schema versions.
 * The manifest records the version a bundle was written at; on load we chain the
 * registered upcasters from that version up to the current PROJECT_SCHEMA, then re-save
 * so a bundle is upcast at most once. Each format change adds one pure
 * `fromVersion -> fromVersion + 1` function.
 *
 * Why this exists before it is needed: once projects are hosted server-side we can no
 * longer discard old saved data on a format change (the pre-hosting convention), so a
 * migration path must be in place going forward. See CLAUDE.md (Persistence).
 */

/** The current project-document (`project.json`) schema version. Every bundle is written
 *  at this version; a lower one on load (or in the DB) is stale and must be upcast. Lives
 *  here, beside the upcasters, so both the client (projectRepository) and the DOM-free server
 *  (its drift report) read the current version from one place. */
export const PROJECT_SCHEMA = 10;

/** Upgrades a document one version forward. Untyped across versions on purpose - the old
 *  shape is not the current `ProjectData`, so each upcaster owns its own narrowing. */
export type DocumentUpcaster = (data: unknown) => unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The author voice this retired. Named here rather than imported, because an upcaster describes a
 *  shape that no longer exists and must not drift when the current code moves on. */
const RETIRED_VOICE = "claude";
const AGENT = "agent";

const reauthored = (author: unknown): unknown => (author === RETIRED_VOICE ? AGENT : author);

/** Rewrite the author stamp on each of a track's clips, leaving a clip with no stamp alone. */
const upcastClips = (track: unknown): unknown => {
  if (!isRecord(track) || !Array.isArray(track.clips)) return track;
  return {
    ...track,
    clips: track.clips.map((clip) =>
      isRecord(clip) && clip.author === RETIRED_VOICE ? { ...clip, author: AGENT } : clip,
    ),
  };
};

/**
 * 9 -> 10: the per-model author voice is gone (DAW-34).
 *
 * An AI edit is the agent's, and a new one carries the user who drove it (`agent:<userId>`, see
 * commands/authors.ts). These stamps predate that, so there is no driver to attribute them to and
 * they become the unattributed agent: coloured and labelled as the agent, owned by nobody.
 *
 * Stamps live in three places in the document - the top-level `authorship` map and the `author` on
 * each note and audio clip - so all three are rewritten. Anything not shaped as expected is passed
 * through: this runs on documents written by older code, where being tolerant beats being strict.
 */
const retireModelVoice: DocumentUpcaster = (data) => {
  if (!isRecord(data)) return data;
  const { authorship, tracks } = data;
  return {
    ...data,
    ...(isRecord(authorship)
      ? {
          authorship: Object.fromEntries(Object.entries(authorship).map(([key, author]) => [key, reauthored(author)])),
        }
      : {}),
    ...(Array.isArray(tracks) ? { tracks: tracks.map(upcastClips) } : {}),
  };
};

/** Registered upcasters, keyed by the version they upgrade FROM. */
export const DOCUMENT_UPCASTERS: Record<number, DocumentUpcaster> = {
  9: retireModelVoice,
};

/**
 * Assert the upcaster registry can reach `toVersion` from its earliest entry with no gap:
 * every version in `[min(keys), toVersion)` must have an upcaster. This is the "keep versioning
 * honest" guard - bumping `PROJECT_SCHEMA` without registering the matching upcaster leaves a
 * hole `migrateDocument` would silently stop at, stranding old documents below the current
 * version. An empty registry is vacuously complete. Returns the first missing version, or null if
 * complete.
 */
export function firstMissingUpcaster(
  toVersion: number = PROJECT_SCHEMA,
  upcasters: Record<number, DocumentUpcaster> = DOCUMENT_UPCASTERS,
): number | null {
  const froms = Object.keys(upcasters).map(Number);
  if (froms.length === 0) return null;
  for (let version = Math.min(...froms); version < toVersion; version += 1) {
    if (!upcasters[version]) return version;
  }
  return null;
}

/**
 * Chain upcasters from `fromVersion` toward `toVersion`, stopping early if one is missing
 * (a gap leaves the document at the highest version reached, reported back so the caller
 * persists honestly rather than claiming the current version).
 */
export function migrateDocument(
  data: unknown,
  fromVersion: number,
  toVersion: number,
  upcasters: Record<number, DocumentUpcaster> = DOCUMENT_UPCASTERS,
): { data: unknown; version: number } {
  let version = fromVersion;
  let current = data;
  while (version < toVersion && upcasters[version]) {
    current = upcasters[version](current);
    version += 1;
  }
  return { data: current, version };
}

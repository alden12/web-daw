/**
 * Forward migration of the project document (project.json) across schema versions.
 * The manifest records the version a bundle was written at; on load we chain the
 * registered upcasters from that version up to the current PROJECT_SCHEMA, then re-save
 * so a bundle is upcast at most once. The registry is empty today (the schema is current)
 * - each future format change adds one pure `fromVersion -> fromVersion + 1` function.
 *
 * Why this exists before it is needed: once projects are hosted server-side we can no
 * longer discard old saved data on a format change (the pre-hosting convention), so a
 * migration path must be in place going forward. See CLAUDE.md (Persistence).
 */

/** Upgrades a document one version forward. Untyped across versions on purpose - the old
 *  shape is not the current `ProjectData`, so each upcaster owns its own narrowing. */
export type DocumentUpcaster = (data: unknown) => unknown;

/** Registered upcasters, keyed by the version they upgrade FROM. Empty until a bump. */
export const DOCUMENT_UPCASTERS: Record<number, DocumentUpcaster> = {};

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

/**
 * Bundle-path conventions for server-authoritative version history (Phase B2). Zero-dependency and
 * DOM-free on purpose, so both the authority (`server/api/rooms.ts`, which writes a keyframe on a commit
 * marker) and the remote client `VersionStore` (which reads it to materialise a commit) agree on one
 * string convention rather than duplicating it and drifting.
 */

/**
 * Storage path for a commit's pinned keyframe: the full project snapshot (plus a `headSeq` marker) at the
 * commit marker's authoritative `seq`. Materialising the commit loads it directly, with no log replay.
 *
 * Deliberately a distinct prefix from `history/commits/` (the client file-DAG's Commit nodes, matched to
 * `commitSchema` by `bundleSchemaForPath`): this file is a `ProjectData` snapshot, not a `Commit`, so it
 * gets its own prefix + schema. Content at a given `seq` is deterministic, so it is written once in
 * practice (the authority writes it when the marker arrives) without needing a write-once guard.
 */
export const commitKeyframePath = (seq: number): string => `history/keyframes/${seq}.json`;

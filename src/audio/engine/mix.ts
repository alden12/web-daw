/**
 * Pure mixer math shared by the engine: which tracks are silenced, accounting for
 * explicit mute and solo. Solo rule: if anything is soloed, a track sounds only if
 * it (or an ancestor group) is soloed; explicit mute always wins. Kept pure (no
 * Web Audio) so the behaviour is unit-testable.
 */

interface GroupLike {
  id: string;
  parentId: string | null;
  solo: boolean;
}

interface TrackLike {
  id: string;
  parentId: string;
  muted: boolean;
  solo: boolean;
}

/** Ids of tracks that should be silenced (gain 0) given mute + solo state. */
export function soloMutedTrackIds(groups: readonly GroupLike[], tracks: readonly TrackLike[]): Set<string> {
  const anySolo = tracks.some((track) => track.solo) || groups.some((group) => group.solo);
  const byId = new Map(groups.map((group) => [group.id, group]));
  const ancestorSoloed = (id: string | null): boolean => {
    let ancestorId = id;
    while (ancestorId) {
      const group = byId.get(ancestorId);
      if (!group) break;
      if (group.solo) return true;
      ancestorId = group.parentId;
    }
    return false;
  };
  const muted = new Set<string>();
  for (const track of tracks) {
    if (track.muted || (anySolo && !(track.solo || ancestorSoloed(track.parentId)))) muted.add(track.id);
  }
  return muted;
}

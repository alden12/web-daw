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
  const anySolo = tracks.some((t) => t.solo) || groups.some((g) => g.solo);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const ancestorSoloed = (id: string | null): boolean => {
    let cur = id;
    while (cur) {
      const g = byId.get(cur);
      if (!g) break;
      if (g.solo) return true;
      cur = g.parentId;
    }
    return false;
  };
  const muted = new Set<string>();
  for (const t of tracks) {
    if (t.muted || (anySolo && !(t.solo || ancestorSoloed(t.parentId)))) muted.add(t.id);
  }
  return muted;
}

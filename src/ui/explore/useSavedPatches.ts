import { useEffect, useState } from "react";
import { type Patch, listPatches, subscribePatches } from "../../audio/patches/library";

/** Your saved patches, live. The patch library is global (cross-project), so this mirrors it. */
export function useSavedPatches(): Patch[] {
  const [patches, setPatches] = useState<Patch[]>(() => listPatches());
  useEffect(() => {
    const sync = () => setPatches(listPatches());
    sync();
    return subscribePatches(sync);
  }, []);
  return patches;
}

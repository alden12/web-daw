/**
 * Local persistence: the whole project (synth patch + clip) is just snapshots of
 * the two stores, so saving and loading is a near-free projection of the same
 * model everything else consumes. Uses localStorage for now; a network/cloud
 * backend can later slot in behind this same snapshot/load seam.
 */
import type { ParamStore } from './params/store';
import type { PatchValues } from './params/types';
import type { ClipStore } from './sequencer/clipStore';
import type { ClipData } from './sequencer/types';

const STORAGE_KEY = 'web-daw:project:v1';
const SAVE_DEBOUNCE_MS = 300;

interface ProjectData {
  version: 1;
  patch: PatchValues;
  clip: ClipData;
}

export function loadProject(): { patch?: PatchValues; clip?: ClipData } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ProjectData;
    return { patch: data.patch, clip: data.clip };
  } catch {
    return null;
  }
}

function saveProject(paramStore: ParamStore, clipStore: ClipStore): void {
  try {
    const data: ProjectData = {
      version: 1,
      patch: paramStore.snapshot(),
      clip: clipStore.snapshot(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable - skip silently
  }
}

/** Restore a saved project into the stores, if present. Call before wiring sync. */
export function restoreProject(paramStore: ParamStore, clipStore: ClipStore): void {
  const saved = loadProject();
  if (!saved) return;
  if (saved.patch) paramStore.load(saved.patch);
  if (saved.clip) clipStore.load(saved.clip);
}

/** Debounced autosave on any change to either store. Returns a disposer. */
export function attachAutosave(paramStore: ParamStore, clipStore: ClipStore): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveProject(paramStore, clipStore), SAVE_DEBOUNCE_MS);
  };
  const unsubParam = paramStore.subscribe(schedule);
  const unsubClip = clipStore.subscribe(schedule);
  return () => {
    if (timer) clearTimeout(timer);
    unsubParam();
    unsubClip();
  };
}

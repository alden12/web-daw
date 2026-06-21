/**
 * Local persistence: the whole project (all tracks' instruments + clips +
 * transport) is just a snapshot of the ProjectStore, so saving/loading is a
 * near-free projection of the same model everything else consumes. localStorage
 * for now; a network backend can later slot in behind this same seam.
 */
import type { ProjectStore } from './project/projectStore';
import type { ProjectData } from './project/types';

const STORAGE_KEY = 'web-daw:project:v4';
// Older snapshots (flat track list, no group tree). Read for migration only;
// ProjectStore.load files parentless tracks into their family group.
const LEGACY_KEYS = ['web-daw:project:v3'];
const SAVE_DEBOUNCE_MS = 300;

interface StoredProject {
  version: 4;
  project: ProjectData;
}

export function loadProject(): ProjectData | null {
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw) as { version: number; project: ProjectData };
      if (data.project?.tracks) return data.project;
    } catch {
      // try the next key
    }
  }
  return null;
}

function saveProject(project: ProjectStore): void {
  try {
    const data: StoredProject = { version: 4, project: project.snapshot() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable - skip silently
  }
}

/** Restore a saved project into the store, if present. Call before wiring sync. */
export function restoreProject(project: ProjectStore): void {
  const saved = loadProject();
  if (saved && saved.tracks?.length) project.load(saved);
}

/**
 * Debounced autosave on any structural OR per-track (param/clip) change. Returns
 * a disposer. Re-subscribes to track stores whenever the track set changes.
 */
export function attachAutosave(project: ProjectStore): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveProject(project), SAVE_DEBOUNCE_MS);
  };

  // Per-track/group subscriptions are rebuilt on structural change (they come/go).
  let trackUnsubs: (() => void)[] = [];
  const resubscribeTracks = () => {
    for (const u of trackUnsubs) u();
    trackUnsubs = [
      ...project.getTracks().flatMap((t) => [
        ...(t.kind === 'instrument' ? [t.params.subscribe(schedule), t.clip.subscribe(schedule)] : []),
        ...t.effects.map((fx) => fx.params.subscribe(schedule)),
      ]),
      ...project.getGroups().flatMap((g) => g.effects.map((fx) => fx.params.subscribe(schedule))),
    ];
  };

  const unsubStructure = project.subscribe(() => {
    resubscribeTracks();
    schedule();
  });
  resubscribeTracks();

  return () => {
    if (timer) clearTimeout(timer);
    for (const u of trackUnsubs) u();
    unsubStructure();
  };
}

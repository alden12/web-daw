/**
 * Local persistence: the whole project (all tracks' instruments + clips +
 * transport) plus the authored edit log are saved together as one localStorage
 * blob, so saving/loading is a near-free projection of the same model everything
 * else consumes. State is restored from the project snapshot; the log rides along
 * so the activity feed and authored history survive a reload (undo/redo is
 * session-scoped and intentionally not persisted). localStorage for now; a
 * network/file backend can later slot in behind this same seam.
 */
import type { ProjectStore } from './project/projectStore';
import type { ProjectData } from './project/types';
import type { EditLog } from './commands/editLog';
import type { EditEntry } from './commands/types';

const STORAGE_KEY = 'web-daw:project:v6';
// Older snapshots. Read for migration only; ProjectStore.load files parentless
// tracks into their family group and migrates single-clip tracks (v4) into one
// default variant. Pre-v6 blobs have no edit log, so the feed starts empty.
const LEGACY_KEYS = ['web-daw:project:v5', 'web-daw:project:v4', 'web-daw:project:v3'];
const SAVE_DEBOUNCE_MS = 300;
// Bound the persisted log (commands are tiny); deeper history awaits the
// on-disk file format / IndexedDB slice. The in-memory log is unaffected.
const MAX_PERSISTED_ENTRIES = 2000;

interface StoredProject {
  version: 6;
  project: ProjectData;
  log: EditEntry[];
}

/** Read the stored blob (current or legacy key). Legacy blobs have no `log`. */
function loadStored(): { project: ProjectData; log: EditEntry[] } | null {
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw) as { project?: ProjectData; log?: EditEntry[] };
      if (data.project?.tracks) return { project: data.project, log: data.log ?? [] };
    } catch {
      // try the next key
    }
  }
  return null;
}

function saveProject(project: ProjectStore, editLog: EditLog): void {
  try {
    const entries = editLog.getEntries();
    const data: StoredProject = {
      version: 6,
      project: project.snapshot(),
      log: entries.slice(-MAX_PERSISTED_ENTRIES),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable - skip silently
  }
}

/** Restore the saved project + edit log into the stores, if present. Call before
 *  wiring sync, so the first MCP snapshot reflects the restored project. */
export function restoreProject(project: ProjectStore, editLog: EditLog): void {
  const saved = loadStored();
  if (!saved || !saved.project.tracks?.length) return;
  project.load(saved.project);
  editLog.restore(saved.log);
}

/**
 * Debounced autosave on any structural OR per-track (param/clip) change. The log
 * rides along in the same write (every edit mutates the project, so reading the
 * log at save time captures it - there are no log-only changes). Returns a
 * disposer. Re-subscribes to track stores whenever the track set changes.
 */
export function attachAutosave(project: ProjectStore, editLog: EditLog): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveProject(project, editLog), SAVE_DEBOUNCE_MS);
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

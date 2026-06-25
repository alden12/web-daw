/**
 * The clip pool for the selected track: a chip per clip (a note pattern), plus
 * "+ Clip" to add a new empty one. Clicking a chip makes it the active clip
 * (shown/edited in the roll); double-click renames; drag a chip onto this track's
 * lane in the arrangement to place that clip there. Two-voice colour tags who
 * authored each clip - you (teal) vs Claude (coral). Selecting is navigation
 * (direct on the store); add / remove / rename go through dispatch, so undo/redo +
 * the activity feed cover them.
 */
import { useState } from 'react';
import type { ProjectStore } from '../audio/project/projectStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import type { ClipContent } from '../audio/project/types';
import { useProject } from '../audio/project/useProject';
import type { Dispatch } from '../audio/commands/types';
import { newClipId } from '../audio/commands/ids';
import { CLIP_DND_TYPE, clipDndKindType, clearDraggedClip, setDraggedClip } from './clipDnd';
import { getClipClipboard, setClipClipboard } from './clipClipboard';

export function ClipRail({
  projectStore,
  scheduler,
  trackId,
  dispatch,
  orientation = 'horizontal',
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  trackId: string;
  dispatch: Dispatch;
  /** 'horizontal' chip row; 'vertical' left rail (stacked, beside the roll). */
  orientation?: 'horizontal' | 'vertical';
}) {
  const project = useProject(projectStore);
  const [editingId, setEditingId] = useState<string | null>(null);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;

  const { clips, activeClipId, launchedClipId } = track;
  const vertical = orientation === 'vertical';

  const commitRename = (clipId: string, name: string) => {
    setEditingId(null);
    const trimmed = name.trim();
    if (trimmed) dispatch({ type: 'renameClip', trackId, clipId, name: trimmed });
  };

  // Delete a clip. A track must keep at least one clip, so deleting the last one
  // replaces it with a fresh empty clip (a blank-slate reset). The new id is minted
  // here and carried in the edit, so undo/redo and history replay stay deterministic.
  const deleteClip = (clipId: string) => {
    if (clips.length > 1) {
      dispatch({ type: 'removeClip', trackId, clipId });
    } else {
      dispatch({ type: 'addClip', trackId, id: newClipId(), empty: true });
      dispatch({ type: 'removeClip', trackId, clipId });
    }
  };

  // Launch toggles the clip's override; launching auto-starts the transport so you
  // hear it immediately (no-op if audio is not started or already playing).
  const toggleLaunch = (clipId: string) => {
    const launched = launchedClipId === clipId;
    dispatch({ type: 'launchClip', trackId, clipId: launched ? null : clipId });
    if (!launched) scheduler.play();
  };

  // A clip's portable content (for copy/paste). Notes come from the live store.
  const clipContentOf = (clipId: string): ClipContent | null => {
    if (track.kind === 'instrument') {
      const store = projectStore.getClipStore(trackId, clipId);
      const meta = clips.find((c) => c.id === clipId);
      if (!store || !meta) return null;
      const data = store.getClip();
      return { kind: 'instrument', name: meta.name, notes: data.notes.map((n) => ({ ...n })), lengthBeats: data.lengthBeats };
    }
    const c = track.clips.find((x) => x.id === clipId);
    return c ? { kind: 'audio', name: c.name, fileId: c.fileId, gain: c.gain, durationSec: c.durationSec } : null;
  };

  // Copy / cut / paste clips, like the timeline does for placements. Cut/copy take
  // the active clip; paste adds the clipboard clip to THIS track (refusing a
  // cross-type paste), so clips move within and across same-kind tracks.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const el = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; // typing (rename) keeps normal copy/paste
    const key = e.key.toLowerCase();
    if (key === 'c' || key === 'x') {
      const content = clipContentOf(activeClipId);
      if (!content) return;
      e.preventDefault();
      e.stopPropagation();
      setClipClipboard(content);
      if (key === 'x' && clips.length > 1) dispatch({ type: 'removeClip', trackId, clipId: activeClipId });
    } else if (key === 'v') {
      const content = getClipClipboard();
      if (!content || content.kind !== track.kind) return; // nothing, or wrong type
      e.preventDefault();
      e.stopPropagation();
      dispatch({ type: 'pasteClip', trackId, id: newClipId(), content });
    }
  };

  const containerClass = vertical
    ? 'flex flex-col gap-1.5 p-2 w-24 shrink-0 border-r border-line overflow-y-auto'
    : 'flex items-center gap-1.5 px-4 h-9 border-b border-line overflow-x-auto shrink-0';
  const chipClass = vertical ? 'w-full justify-between' : 'shrink-0';

  return (
    <div className={`${containerClass} outline-none`} data-clip-rail tabIndex={0} onKeyDown={onKeyDown}>
      <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint shrink-0 mr-1">Clips</span>
      {clips.map((c) => {
        const active = c.id === activeClipId;
        const voice = c.author === 'claude' ? 'bg-claude' : 'bg-you';
        if (editingId === c.id) {
          return (
            <input
              key={c.id}
              autoFocus
              defaultValue={c.name}
              onBlur={(e) => commitRename(c.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(c.id, e.currentTarget.value);
                if (e.key === 'Escape') setEditingId(null);
              }}
              className={`font-mono text-[11px] px-1.5 py-1 rounded-md border border-you bg-ground text-bright ${vertical ? 'w-full' : 'w-16'}`}
            />
          );
        }
        return (
          <div
            key={c.id}
            draggable
            onDragStart={(e) => {
              const content = clipContentOf(c.id);
              if (!content) return;
              e.dataTransfer.setData(CLIP_DND_TYPE, c.id);
              e.dataTransfer.setData(clipDndKindType(track.kind), '');
              e.dataTransfer.effectAllowed = 'copy';
              setDraggedClip(content);
            }}
            onDragEnd={() => clearDraggedClip()}
            className={`group ${chipClass} inline-flex items-center gap-1.5 font-mono text-[11px] pl-2 pr-1 py-1 rounded-md border cursor-grab active:cursor-grabbing ${
              active ? 'border-you/60 bg-you/15 text-bright' : 'border-line bg-card text-muted hover:bg-ground'
            }`}
            onClick={() => projectStore.selectClip(trackId, c.id)}
            onDoubleClick={() => setEditingId(c.id)}
            title={`${c.author === 'claude' ? 'Claude' : 'You'} - drag onto the lane to place, double-click to rename`}
          >
            <button
              type="button"
              title={launchedClipId === c.id ? 'Stop (back to timeline)' : 'Launch clip (loops, overrides the timeline)'}
              onClick={(e) => {
                e.stopPropagation();
                toggleLaunch(c.id);
              }}
              className={`font-mono text-[9px] leading-none w-4 h-4 rounded-full border cursor-pointer shrink-0 ${
                launchedClipId === c.id ? 'border-you bg-you text-ground' : 'border-line text-muted hover:text-you hover:border-you'
              }`}
            >
              {launchedClipId === c.id ? '■' : '▶'}
            </button>
            <span className={`w-1.5 h-1.5 rounded-full ${voice}`} />
            <span>{c.name}</span>
            <button
              type="button"
              title={clips.length > 1 ? 'Remove clip' : 'Clear clip (replaces it with a fresh empty one)'}
              onClick={(e) => {
                e.stopPropagation();
                deleteClip(c.id);
              }}
              className="font-mono text-[11px] w-4 h-4 rounded text-faint hover:text-ink opacity-0 group-hover:opacity-100 cursor-pointer"
            >
              ×
            </button>
          </div>
        );
      })}
      {track.kind === 'instrument' && (
        <button
          type="button"
          title="Add a new empty clip"
          onClick={() => dispatch({ type: 'addClip', trackId, id: newClipId(), empty: true })}
          className={`${chipClass} font-mono text-[11px] px-2 py-1 rounded-md border border-you/45 bg-you/15 text-you cursor-pointer whitespace-nowrap`}
        >
          + Clip
        </button>
      )}
    </div>
  );
}

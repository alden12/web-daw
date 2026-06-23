/**
 * The clip pool for the selected track: a chip per clip (a note pattern), plus
 * "+ Clip" to add a new empty one (duplicate via drag-loop / copy-paste on the
 * timeline). Clicking a chip makes it the
 * active clip (shown/edited in the roll); double-click renames; the active clip is
 * what the arrangement places. Two-voice colour tags who authored each clip - you
 * (teal) vs Claude (coral). Selecting is navigation (direct on the store); add /
 * remove / rename go through dispatch, so undo/redo + the activity feed cover them.
 */
import { useState } from 'react';
import type { ProjectStore } from '../audio/project/projectStore';
import { useProject } from '../audio/project/useProject';
import type { Dispatch } from '../audio/commands/types';
import { newClipId } from '../audio/commands/ids';

export function VariantStrip({
  projectStore,
  trackId,
  dispatch,
  orientation = 'horizontal',
}: {
  projectStore: ProjectStore;
  trackId: string;
  dispatch: Dispatch;
  /** 'horizontal' chip row; 'vertical' left rail (stacked, beside the roll). */
  orientation?: 'horizontal' | 'vertical';
}) {
  const project = useProject(projectStore);
  const [editingId, setEditingId] = useState<string | null>(null);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;

  const { clips, activeClipId } = track;
  const vertical = orientation === 'vertical';

  const commitRename = (clipId: string, name: string) => {
    setEditingId(null);
    const trimmed = name.trim();
    if (trimmed) dispatch({ type: 'renameClip', trackId, clipId, name: trimmed });
  };

  const containerClass = vertical
    ? 'flex flex-col gap-1.5 p-2 w-24 shrink-0 border-r border-line overflow-y-auto'
    : 'flex items-center gap-1.5 px-4 h-9 border-b border-line overflow-x-auto shrink-0';
  const chipClass = vertical ? 'w-full justify-between' : 'shrink-0';

  return (
    <div className={containerClass}>
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
            className={`group ${chipClass} inline-flex items-center gap-1.5 font-mono text-[11px] pl-2 pr-1 py-1 rounded-md border cursor-pointer ${
              active ? 'border-you/60 bg-you/15 text-bright' : 'border-line bg-card text-muted hover:bg-ground'
            }`}
            onClick={() => projectStore.selectClip(trackId, c.id)}
            onDoubleClick={() => setEditingId(c.id)}
            title={`${c.author === 'claude' ? 'Claude' : 'You'} - double-click to rename`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${voice}`} />
            <span>{c.name}</span>
            {clips.length > 1 && (
              <button
                type="button"
                title="Remove clip"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'removeClip', trackId, clipId: c.id });
                }}
                className="font-mono text-[11px] w-4 h-4 rounded text-faint hover:text-ink opacity-0 group-hover:opacity-100 cursor-pointer"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {track.kind === 'instrument' && (
        <button
          type="button"
          title="Add a clip (copies the active one)"
          onClick={() => dispatch({ type: 'addClip', trackId, id: newClipId(), empty: true })}
          className={`${chipClass} font-mono text-[11px] px-2 py-1 rounded-md border border-you/45 bg-you/15 text-you cursor-pointer whitespace-nowrap`}
        >
          + Clip
        </button>
      )}
    </div>
  );
}

/**
 * The variant stack for the selected instrument track: a chip per variant
 * (notes + params + effects bundle), plus "Try" to fork the active one. Switching
 * a chip morphs the whole sound; forking is non-destructive (the original is
 * parked). Two-voice color tags who authored each variant - you (teal) vs Claude
 * (coral) - so generated takes are recognisable (DESIGN.md section 6). Reads the
 * structure like EffectChain; every action goes through dispatch (the same model
 * MCP drives), so undo/redo and the activity feed cover it for free.
 */
import { useState } from 'react';
import type { ProjectStore } from '../audio/project/projectStore';
import { useProject } from '../audio/project/useProject';
import type { Dispatch } from '../audio/commands/types';
import { newVariantId } from '../audio/commands/ids';

export function VariantStrip({
  projectStore,
  trackId,
  dispatch,
}: {
  projectStore: ProjectStore;
  trackId: string;
  dispatch: Dispatch;
}) {
  const project = useProject(projectStore);
  const [editingId, setEditingId] = useState<string | null>(null);
  const track = project.tracks.find((t) => t.id === trackId);
  if (track?.kind !== 'instrument') return null;

  const { variants, activeVariantId } = track;

  const commitRename = (variantId: string, name: string) => {
    setEditingId(null);
    const trimmed = name.trim();
    if (trimmed) dispatch({ type: 'renameVariant', trackId, variantId, name: trimmed });
  };

  return (
    <div className="flex items-center gap-1.5 px-4 h-9 border-b border-line overflow-x-auto shrink-0">
      <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint mr-1 shrink-0">Variants</span>
      {variants.map((v) => {
        const active = v.id === activeVariantId;
        const voice = v.author === 'claude' ? 'bg-claude' : 'bg-you';
        if (editingId === v.id) {
          return (
            <input
              key={v.id}
              autoFocus
              defaultValue={v.name}
              onBlur={(e) => commitRename(v.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(v.id, e.currentTarget.value);
                if (e.key === 'Escape') setEditingId(null);
              }}
              className="w-16 font-mono text-[11px] px-1.5 py-1 rounded-md border border-you bg-ground text-bright"
            />
          );
        }
        return (
          <div
            key={v.id}
            className={`group shrink-0 inline-flex items-center gap-1.5 font-mono text-[11px] pl-2 pr-1 py-1 rounded-md border cursor-pointer ${
              active ? 'border-you/60 bg-you/15 text-bright' : 'border-line bg-card text-muted hover:bg-ground'
            }`}
            onClick={() => dispatch({ type: 'selectVariant', trackId, variantId: v.id })}
            onDoubleClick={() => setEditingId(v.id)}
            title={`${v.author === 'claude' ? 'Claude' : 'You'} - double-click to rename`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${voice}`} />
            <span>{v.name}</span>
            {variants.length > 1 && (
              <button
                type="button"
                title="Remove variant"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'removeVariant', trackId, variantId: v.id });
                }}
                className="font-mono text-[11px] w-4 h-4 rounded text-faint hover:text-ink opacity-0 group-hover:opacity-100 cursor-pointer"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        title="Fork the active variant (non-destructive)"
        onClick={() => dispatch({ type: 'addVariant', trackId, id: newVariantId() })}
        className="shrink-0 font-mono text-[11px] px-2 py-1 rounded-md border border-you/45 bg-you/15 text-you cursor-pointer whitespace-nowrap"
      >
        + Try
      </button>
    </div>
  );
}

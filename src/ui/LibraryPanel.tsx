/**
 * The library (left): the instrument and effect catalogs as a collapsible tree.
 * Instrument leaves add a track; effect leaves attach to the selected track.
 * Both read from the same catalogs the engine and MCP use, so the tree never
 * drifts from what can actually be loaded.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectStore } from '../audio/project/projectStore';
import { INSTRUMENT_CATALOG } from '../audio/instruments/catalog';
import { EFFECT_CATALOG } from '../audio/effects/catalog';

function Category({ label, defaultOpen = true, children }: { label: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-4 py-1.5 text-xs font-semibold text-ink cursor-pointer"
      >
        <span className="w-2.5 text-[9px] text-muted">{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open && children}
    </>
  );
}

function Leaf({ label, fx, onClick }: { label: string; fx?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 w-full text-left pl-8 pr-4 py-1.5 text-[12.5px] text-ink cursor-pointer hover:bg-you/10"
    >
      <span className={`w-1.75 h-1.75 bg-line ${fx ? 'rounded-full' : 'rounded-sm'}`} />
      {label}
    </button>
  );
}

export function LibraryPanel({ projectStore }: { projectStore: ProjectStore }) {
  return (
    <div className="[grid-area:library] bg-rail border-r border-line overflow-y-auto py-3">
      <div className="mx-3.5 mb-2 px-3 py-2 border border-line rounded-lg bg-ground text-faint text-xs">Search or ask…</div>

      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-faint px-4 pt-3 pb-1.5">Instruments</div>
      <Category label="Synths">
        {Object.entries(INSTRUMENT_CATALOG).map(([type, def]) => (
          <Leaf key={type} label={def.label} onClick={() => projectStore.addTrack(type)} />
        ))}
      </Category>

      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-faint px-4 pt-3 pb-1.5">Effects</div>
      <Category label="All effects">
        {Object.entries(EFFECT_CATALOG).map(([type, def]) => (
          <Leaf
            key={type}
            label={def.label}
            fx
            onClick={() => {
              const id = projectStore.selectedId;
              if (id) projectStore.addEffect(id, type);
            }}
          />
        ))}
      </Category>

      <p className="text-faint text-[11px] px-4 pt-3 leading-snug">
        Click an instrument to add a track. Effects attach to the selected track.
      </p>
    </div>
  );
}

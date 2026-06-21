/**
 * The selected track's effect chain, rendered inline in the signal-chain strip:
 * one compact card per effect (bypass / reorder / remove + its knobs), then the
 * add-effect buttons. Sits in CenterWorkbench's horizontal-scrolling row after
 * the instrument card. Every edit goes through the project store, the same model
 * MCP drives.
 */
import { Fragment } from 'react';
import type { ProjectStore } from '../audio/project/projectStore';
import { useProject } from '../audio/project/useProject';
import { EFFECT_CATALOG, effectCatalogEntry, effectSchema } from '../audio/effects/catalog';
import { Knob } from './Knob';

const ARROW = <div className="self-center text-faint text-sm px-0.5">→</div>;
const iconBtn = 'font-mono text-[11px] w-5 h-5 rounded border border-line text-ink cursor-pointer';

export function EffectChain({ projectStore, trackId }: { projectStore: ProjectStore; trackId: string }) {
  const project = useProject(projectStore);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const effects = track.effects;

  return (
    <>
      {effects.map((fx, i) => {
        const store = projectStore.getEffect(trackId, fx.id)?.params;
        if (!store) return null;
        return (
          <Fragment key={fx.id}>
            {ARROW}
            <div className={`shrink-0 border border-line rounded-xl bg-card ${fx.bypassed ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line">
                <span className="font-mono text-[12px] font-semibold text-bright mr-1">
                  {effectCatalogEntry(fx.type).label}
                </span>
                <button
                  type="button"
                  title={fx.bypassed ? 'Enable' : 'Bypass'}
                  onClick={() => projectStore.setEffectBypass(trackId, fx.id, !fx.bypassed)}
                  className={`font-mono text-[10px] h-5 px-1.5 rounded border cursor-pointer ${
                    fx.bypassed ? 'border-line text-muted' : 'border-you/45 text-you'
                  }`}
                >
                  {fx.bypassed ? 'Off' : 'On'}
                </button>
                <button
                  type="button"
                  title="Move earlier"
                  disabled={i === 0}
                  onClick={() => projectStore.moveEffect(trackId, fx.id, i - 1)}
                  className={`${iconBtn} disabled:opacity-30`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Move later"
                  disabled={i === effects.length - 1}
                  onClick={() => projectStore.moveEffect(trackId, fx.id, i + 1)}
                  className={`${iconBtn} disabled:opacity-30`}
                >
                  ↓
                </button>
                <button type="button" title="Remove effect" onClick={() => projectStore.removeEffect(trackId, fx.id)} className={iconBtn}>
                  ×
                </button>
              </div>
              <div className="flex gap-3 px-3 py-3">
                {effectSchema(fx.type).map((spec) => (
                  <Knob key={spec.id} spec={spec} store={store} />
                ))}
              </div>
            </div>
          </Fragment>
        );
      })}
      {ARROW}
      <div className="shrink-0 flex flex-col gap-1.5 justify-center px-1">
        {Object.entries(EFFECT_CATALOG).map(([type, def]) => (
          <button
            key={type}
            type="button"
            onClick={() => projectStore.addEffect(trackId, type)}
            className="font-mono text-[11px] px-2.5 py-1 rounded-md border border-you/45 bg-you/15 text-you cursor-pointer whitespace-nowrap text-left"
          >
            + {def.label}
          </button>
        ))}
      </div>
    </>
  );
}

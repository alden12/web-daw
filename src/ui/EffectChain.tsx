/**
 * The selected track's effect chain: each effect rendered in signal-path order
 * with bypass/reorder/remove controls and its params via the generic Knob over
 * the effect's schema. Add buttons come from the effect catalog. Every edit goes
 * through the project store, the same model MCP drives.
 */
import type { ProjectStore } from '../audio/project/projectStore';
import { useProject } from '../audio/project/useProject';
import { EFFECT_CATALOG, effectSchema } from '../audio/effects/catalog';
import { Knob } from './Knob';

export function EffectChain({ projectStore, trackId }: { projectStore: ProjectStore; trackId: string }) {
  const project = useProject(projectStore);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const effects = track.effects;

  return (
    <div className="effects">
      <div className="effects-chain">
        {effects.length === 0 && <p className="effects-empty">No effects - add one below.</p>}
        {effects.map((fx, i) => {
          const store = projectStore.getEffect(trackId, fx.id)?.params;
          if (!store) return null;
          return (
            <div key={fx.id} className={`effect${fx.bypassed ? ' bypassed' : ''}`}>
              <div className="effect-header">
                <span className="effect-name">{EFFECT_CATALOG[fx.type]?.label ?? fx.type}</span>
                <button
                  type="button"
                  className={`effect-bypass${fx.bypassed ? '' : ' on'}`}
                  title={fx.bypassed ? 'Enable' : 'Bypass'}
                  onClick={() => projectStore.setEffectBypass(trackId, fx.id, !fx.bypassed)}
                >
                  {fx.bypassed ? 'Off' : 'On'}
                </button>
                <button
                  type="button"
                  className="effect-move"
                  title="Move earlier"
                  disabled={i === 0}
                  onClick={() => projectStore.moveEffect(trackId, fx.id, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="effect-move"
                  title="Move later"
                  disabled={i === effects.length - 1}
                  onClick={() => projectStore.moveEffect(trackId, fx.id, i + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="effect-remove"
                  title="Remove effect"
                  onClick={() => projectStore.removeEffect(trackId, fx.id)}
                >
                  ×
                </button>
              </div>
              <div className="rack">
                {effectSchema(fx.type).map((spec) => (
                  <Knob key={spec.id} spec={spec} store={store} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="effects-add">
        {Object.entries(EFFECT_CATALOG).map(([type, def]) => (
          <button key={type} type="button" className="effect-add" onClick={() => projectStore.addEffect(trackId, type)}>
            + {def.label}
          </button>
        ))}
      </div>
    </div>
  );
}

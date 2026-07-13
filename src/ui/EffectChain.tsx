/**
 * The selected track's effect chain, rendered inline in the signal-chain strip:
 * one compact card per effect (bypass / reorder / remove + its knobs). Sits in
 * CenterWorkbench's horizontal-scrolling row after the instrument card. Every edit
 * goes through the project store, the same model MCP drives. (Adding an effect from
 * the UI is being reworked - removed for now; MCP add_effect still works.)
 */
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import { effectCatalogEntry, effectSchema } from "../audio/effects/catalog";
import type { Dispatch } from "../audio/commands/types";
import { Knob } from "./Knob";

/** The signal-flow arrow. Placed to the RIGHT of an outputting device (and kept in the
 *  same flex group as that device) so it trails cleanly instead of leading a wrapped row. */
export function FlowArrow() {
  return <div className="self-center text-faint text-sm px-1">→</div>;
}
const iconBtn = "font-mono text-[11px] w-5 h-5 rounded border border-line text-ink cursor-pointer";

export function EffectChain({
  projectStore,
  trackId,
  dispatch,
}: {
  projectStore: ProjectStore;
  trackId: string;
  dispatch: Dispatch;
}) {
  const project = useProject(projectStore);
  const track = project.tracks.find((track) => track.id === trackId);
  if (!track) return null;
  const effects = track.effects;

  return (
    <>
      {effects.map((fx, i) => {
        const store = projectStore.getEffect(trackId, fx.id)?.params;
        if (!store) return null;
        // Each effect card carries its own trailing arrow (into the next effect) in one
        // flex group, so the arrow stays glued to the device's right edge on wrap.
        return (
          <div key={fx.id} className="flex items-stretch shrink-0">
            <div className={`shrink-0 border border-line rounded-xl bg-card ${fx.bypassed ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-line">
                <span
                  className="font-mono text-[12px] font-semibold text-bright mr-1 truncate"
                  title={effectCatalogEntry(fx.type).label}
                >
                  {effectCatalogEntry(fx.type).label}
                </span>
                <button
                  type="button"
                  title={fx.bypassed ? "Enable" : "Bypass"}
                  onClick={() =>
                    dispatch({
                      type: "bypassEffect",
                      hostId: trackId,
                      effectId: fx.id,
                      bypassed: !fx.bypassed,
                    })
                  }
                  className={`font-mono text-[10px] h-5 px-1.5 rounded border cursor-pointer ${
                    fx.bypassed ? "border-line text-muted" : "border-you/45 text-you"
                  }`}
                >
                  {fx.bypassed ? "Off" : "On"}
                </button>
                <button
                  type="button"
                  title="Move earlier"
                  disabled={i === 0}
                  onClick={() =>
                    dispatch({
                      type: "moveEffect",
                      hostId: trackId,
                      effectId: fx.id,
                      toIndex: i - 1,
                    })
                  }
                  className={`${iconBtn} disabled:opacity-30`}
                >
                  ←
                </button>
                <button
                  type="button"
                  title="Move later"
                  disabled={i === effects.length - 1}
                  onClick={() =>
                    dispatch({
                      type: "moveEffect",
                      hostId: trackId,
                      effectId: fx.id,
                      toIndex: i + 1,
                    })
                  }
                  className={`${iconBtn} disabled:opacity-30`}
                >
                  →
                </button>
                <button
                  type="button"
                  title="Remove effect"
                  onClick={() =>
                    dispatch({
                      type: "removeEffect",
                      hostId: trackId,
                      effectId: fx.id,
                    })
                  }
                  className={iconBtn}
                >
                  ×
                </button>
              </div>
              <div className="flex gap-3 px-3 py-3">
                {effectSchema(fx.type).map((spec) => (
                  <Knob
                    key={spec.id}
                    spec={spec}
                    store={store}
                    onChange={(id, value) =>
                      dispatch({
                        type: "setEffectParam",
                        hostId: trackId,
                        effectId: fx.id,
                        id,
                        value,
                      })
                    }
                  />
                ))}
              </div>
            </div>
            {i < effects.length - 1 ? <FlowArrow /> : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * The selected track's effect chain, rendered inline in the signal-chain strip:
 * one compact card per effect (bypass / reorder / remove + its knobs), then the
 * add-effect buttons. Sits in CenterWorkbench's horizontal-scrolling row after
 * the instrument card. Every edit goes through the project store, the same model
 * MCP drives.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import {
  effectInfos,
  effectCatalogEntry,
  effectSchema,
} from "../audio/effects/catalog";
import type { Dispatch } from "../audio/commands/types";
import { newEffectId } from "../audio/commands/ids";
import { Knob } from "./Knob";

const ARROW = <div className="self-center text-faint text-sm px-0.5">→</div>;
const iconBtn =
  "font-mono text-[11px] w-5 h-5 rounded border border-line text-ink cursor-pointer";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  // Close the add-effect menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

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
            <div
              className={`shrink-0 border border-line rounded-xl bg-card ${fx.bypassed ? "opacity-50" : ""}`}
            >
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
                    fx.bypassed
                      ? "border-line text-muted"
                      : "border-you/45 text-you"
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
          </Fragment>
        );
      })}

      {ARROW}
      <div ref={addRef} className="relative self-center shrink-0">
        <button
          type="button"
          title="Add an effect"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="font-mono text-[12px] w-8 h-8 rounded-full border border-line bg-card text-ink cursor-pointer hover:border-you hover:text-you"
        >
          +
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute left-0 top-9 z-20 min-w-32 flex flex-col gap-0.5 p-1 rounded-lg border border-line bg-panel shadow-lg"
          >
            {effectInfos().map((def) => (
              <button
                key={def.type}
                type="button"
                role="menuitem"
                onClick={() => {
                  dispatch({
                    type: "addEffect",
                    hostId: trackId,
                    effectType: def.type,
                    id: newEffectId(),
                  });
                  setMenuOpen(false);
                }}
                className="flex items-center gap-2 text-left px-2.5 py-1.5 rounded-md text-[12.5px] text-ink cursor-pointer hover:bg-you/10"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-line" />
                {def.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

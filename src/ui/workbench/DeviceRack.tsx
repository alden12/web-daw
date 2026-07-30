/**
 * The selected track's device chain: MIDI devices, then the instrument, then effects -
 * the signal path, left to right, wrapping when there is no room. "Save as patch"
 * captures the whole chain as a reusable library entry.
 *
 * Fills whatever box it is given: a resizable band under the editor on desktop, a whole
 * tab on touch (MOBILE-1), where narrow width makes the wrap into a vertical stack of
 * one card per device on its own.
 */
import { useState } from "react";
import type { InstrumentTrack, ProjectStore, Track } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import type { SampleAsset } from "../../audio/samples/catalog";
import { savePatch, newPatchId } from "../../audio/patches/library";
import { EMPTY_INSTRUMENT, pickableInstrumentInfos } from "../../audio/instruments/catalog";
import { MidiDeviceChain } from "../MidiDeviceChain";
import { InstrumentPanel } from "../InstrumentPanel";
import { DrumkitPanel } from "../DrumkitPanel";
import { EffectChain, FlowArrow } from "../EffectChain";

/**
 * "Save as patch": capture the instrument + its params + effect chain as a named,
 * reusable library entry. Clicking reveals an inline name field (defaulting to the
 * track name); Enter or Save writes it to the global patch library.
 */
function SavePatchControl({ track }: { track: InstrumentTrack }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const save = () => {
    savePatch({
      id: newPatchId(),
      name: name.trim() || track.name,
      author: "you",
      instrumentType: track.instrumentType,
      params: track.params.snapshot(),
      midiDevices: track.midiDevices.map((device) => ({
        type: device.type,
        bypassed: device.bypassed,
        params: device.params.snapshot(),
      })),
      effects: track.effects.map((fx) => ({
        type: fx.type,
        bypassed: fx.bypassed,
        params: fx.params.snapshot(),
      })),
      createdAt: Date.now(),
    });
    setNaming(false);
    setName("");
  };

  if (!naming)
    return (
      <button
        type="button"
        title="Save this instrument + effects as a reusable patch"
        onClick={() => {
          setName(track.name);
          setNaming(true);
        }}
        className="font-mono text-[10.5px] px-2 py-0.5 rounded border border-line text-muted hover:text-ink hover:border-you cursor-pointer"
      >
        Save as patch
      </button>
    );

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setNaming(false);
        }}
        placeholder="Patch name…"
        className="w-32 font-mono text-[11px] px-1.5 py-0.5 rounded border border-line bg-ground text-bright placeholder:text-faint"
      />
      <button
        type="button"
        onClick={save}
        className="font-mono text-[10.5px] px-2 py-0.5 rounded border border-you/45 bg-you/15 text-you cursor-pointer"
      >
        Save
      </button>
    </span>
  );
}

/** Shown for an empty track (no instrument yet): pick one to assign. */
function InstrumentPicker({ trackId, dispatch }: { trackId: string; dispatch: Dispatch }) {
  return (
    <div className="w-full p-1">
      <p className="text-[11.5px] text-muted mb-2">This track has no instrument yet. Choose one:</p>
      <div className="flex flex-wrap gap-1.5">
        {pickableInstrumentInfos().map((info) => (
          <button
            key={info.type}
            type="button"
            onClick={() => dispatch({ type: "setInstrument", trackId, instrumentType: info.type })}
            className="px-2.5 py-1 rounded-md border border-line text-[12px] text-ink hover:text-bright hover:border-you cursor-pointer"
          >
            {info.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DeviceRack({
  track,
  samples,
  dispatch,
  projectStore,
  onRevealSamples,
}: {
  track: Track;
  samples: SampleAsset[];
  dispatch: Dispatch;
  projectStore: ProjectStore;
  /** Reveal the Samples library view (threaded to an empty Sampler's picker). */
  onRevealSamples?: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line shrink-0">
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Devices</span>
        {track.kind === "instrument" && track.instrumentType !== EMPTY_INSTRUMENT && (
          <span className="ml-auto">
            <SavePatchControl track={track} />
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-wrap items-stretch gap-x-1 gap-y-3 p-3">
          {/* MIDI devices transform notes before the instrument, so they lead the chain. */}
          <MidiDeviceChain projectStore={projectStore} trackId={track.id} dispatch={dispatch} />
          {track.kind === "instrument" &&
            (track.instrumentType === EMPTY_INSTRUMENT ? (
              <InstrumentPicker trackId={track.id} dispatch={dispatch} />
            ) : (
              // The instrument is the first device; its trailing arrow (into the first
              // effect) stays glued to its right edge, so it wraps cleanly. A drum kit
              // uses its own pad panel in place of the generic knob panel.
              <div className="flex items-stretch shrink-0">
                {track.instrumentType === "drumkit" ? (
                  <DrumkitPanel
                    params={track.params}
                    trackId={track.id}
                    dispatch={dispatch}
                    samples={samples}
                    onRevealSamples={onRevealSamples}
                    projectStore={projectStore}
                  />
                ) : (
                  <InstrumentPanel
                    params={track.params}
                    instrumentType={track.instrumentType}
                    trackId={track.id}
                    dispatch={dispatch}
                    samples={samples}
                    onRevealSamples={onRevealSamples}
                    projectStore={projectStore}
                  />
                )}
                {track.effects.length > 0 ? <FlowArrow /> : null}
              </div>
            ))}
          <EffectChain projectStore={projectStore} trackId={track.id} dispatch={dispatch} />
        </div>
      </div>
    </>
  );
}

/**
 * A drum kit's own pads (MOBILE-6).
 *
 * A kit does not have a key, so the scale layout would be a lie told in note names: it
 * would still *play* - the pads are just MIDI notes - but the labels would be intervals of
 * a tonic the kit knows nothing about, over a General MIDI map where 36 is a kick and 42 a
 * hat. So a kit track gets its own pads, labelled with the sample that fires.
 *
 * Only loaded pads are shown, on the same reasoning as `DrumkitPanel`: a fresh kit should
 * not be a wall of empty slots.
 */
import type { ParamStore } from "../../audio/params/store";
import type { SampleAsset } from "../../audio/samples/catalog";
import { refLabel } from "../../audio/samples/catalog";
import { usePads } from "../useDrumPads";
import { pitchName } from "../noteNames";
import { PadButton } from "./PadButton";
import type { PadTouch } from "./usePadTouch";

/** Pads per row. Four across a 390px phone is ~92px each, well clear of the hit-target floor. */
const COLUMNS = 4;
const PAD_HEIGHT = 52;
/** Rows shown before the bank scrolls - a section is content-sized, but not without limit. */
const MAX_ROWS = 3;

export function KitPads({ params, samples, touch }: { params: ParamStore; samples: SampleAsset[]; touch: PadTouch }) {
  const loaded = usePads(params).filter((pad) => pad.ref !== "" && pad.ref !== "none");

  if (!loaded.length)
    return (
      <p className="px-3 pb-3 text-[11px] text-faint">
        This kit has no samples loaded yet. Add one from the rack and its pad appears here.
      </p>
    );

  return (
    <div
      className="shrink-0 grid gap-1 px-2 pb-2 overflow-y-auto"
      style={{
        gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
        maxHeight: MAX_ROWS * (PAD_HEIGHT + 4),
      }}
    >
      {loaded.map((pad) => {
        const label = refLabel(pad.ref, samples);
        return (
          <PadButton
            key={pad.index}
            pitch={pad.note}
            name={`${label} (${pitchName(pad.note)})`}
            label={<span className="max-w-full truncate px-1">{label}</span>}
            sublabel={pitchName(pad.note)}
            touch={touch}
            style={{ height: PAD_HEIGHT }}
          />
        );
      })}
    </div>
  );
}

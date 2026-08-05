/**
 * The pads section at the foot of the editor sheet (MOBILE-6): the way you play, and
 * therefore record, anything on a phone.
 *
 * **Pads, not keys**, and **not a separate surface** - you play a phrase and watch it land
 * in the roll above without changing what you are looking at, which is why this is a
 * section rather than a fourth thing in the Edit / Clips / Rack switch.
 *
 * They sit under *whichever* surface is showing, for the same reason: playing while you turn
 * a filter is as much the point as playing while you edit notes, and having to leave the rack
 * to hear what you changed is the thing the section exists to avoid.
 *
 * Which pads depends on what you are playing: a kit gets its own pads (its notes are a
 * General MIDI map, not a key), everything else gets the scale pads.
 *
 * How many rows depends on the room the sheet has at the committed detent, not on the device,
 * and on a share of that room rather than all of it - so the surface above keeps its own
 * height, and raising the sheet grows both (`fitPads`).
 */
import { useEffect } from "react";
import type { InstrumentTrack } from "../../audio/project/projectStore";
import type { SampleAsset } from "../../audio/samples/catalog";
import { EditorSection } from "../shell/EditorSection";
import { usePersistentBoolean } from "../usePersistent";
import { KitPads } from "./KitPads";
import { ScalePadControls, ScalePads } from "./ScalePads";
import { fitPads } from "./geometry";
import { usePadSettings } from "./padSettings";
import { usePadTouch, type PadNoteTarget } from "./usePadTouch";

export function NotePads({
  track,
  samples,
  notes,
  octavesPerRow,
  room,
}: {
  track: InstrumentTrack;
  samples: SampleAsset[];
  /** Where the notes go - `LiveNotes`, so they reach the instrument *and* the recorder. */
  notes: PadNoteTarget;
  octavesPerRow: number;
  /** The editor's height at the committed detent: what the roll and the pads share. */
  room: number;
}) {
  const [open, setOpen] = usePersistentBoolean("web-daw:pads-open", true);
  // Read before the settings, because how many rows fit depends on whether the accidentals
  // are taking a band above each one.
  const [accidentals] = usePersistentBoolean("web-daw:pads-accidentals", true);
  const fit = fitPads(room, accidentals);
  const settings = usePadSettings(octavesPerRow, fit.rows);
  const touch = usePadTouch(notes);
  const isKit = track.instrumentType === "drumkit";

  /**
   * Silence whatever is sounding when the pads go away or the track changes under them. A
   * latched note is held by nothing at all, and it routes to whichever track is selected,
   * so it must outlive neither: collapsing the section with a note held would otherwise
   * leave it ringing with nothing on screen to release it.
   */
  useEffect(() => touch.releaseAll, [touch.releaseAll, track.id, open]);

  // Nothing fits: say so, and say what to do about it. A section that silently showed a
  // clipped half-row would read as a rendering bug rather than as a sheet that is too low.
  if (!isKit && fit.rows < 1)
    return (
      <EditorSection title="Pads" open={open} onToggle={() => setOpen(!open)}>
        <p className="px-3 pb-2 text-[11px] text-faint">Raise the sheet to play.</p>
      </EditorSection>
    );

  const controls = isKit ? undefined : (
    <ScalePadControls settings={settings} octavesPerRow={octavesPerRow} inline={fit.inlineControls} />
  );

  return (
    <EditorSection
      title="Pads"
      open={open}
      onToggle={() => setOpen(!open)}
      controls={fit.inlineControls ? controls : undefined}
    >
      {!fit.inlineControls && controls}
      {isKit ? (
        <KitPads params={track.params} samples={samples} touch={touch} />
      ) : (
        <ScalePads settings={settings} touch={touch} octavesPerRow={octavesPerRow} />
      )}
    </EditorSection>
  );
}

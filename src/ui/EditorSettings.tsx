/**
 * The Arrangement and Piano roll settings pages (MOBILE-19.4).
 *
 * On a phone these settings were the bulk of the tools menu beside each surface, nested two deep
 * on a screen with room for neither. They live here instead, where someone on a small screen looks
 * for settings; the tools menus keep the actions (quantize now, zoom, add a track). On desktop they
 * are in both places: here, and still in each surface's toolbar menu beside their use. Either way
 * it is one value (`editorPrefs.ts`), not a copy.
 */
import { GRID_DIVISIONS } from "../audio/sequencer/quantize";
import { SNAP_OPTIONS } from "./arrangement/shared";
import { Segmented } from "./controls/Segmented";
import { OnOff, SettingsRow } from "./SettingsRow";
import {
  STRENGTH_OPTIONS,
  useArrangementSnapDivision,
  useArrangementSnapOn,
  useQuantizeEnds,
  useQuantizeOnRecord,
  useQuantizeStrength,
  useRollGrid,
  useRollSnapOn,
  useVelocityLane,
} from "./editorPrefs";

export function ArrangementSettings() {
  const [snapOn, setSnapOn] = useArrangementSnapOn();
  const [division, setDivision] = useArrangementSnapDivision();
  return (
    <div className="flex flex-col gap-5">
      <SettingsRow title="Snap to grid" hint="Clips land on the grid when you move or resize them.">
        <OnOff label="Snap clips to grid" on={snapOn} onChange={setSnapOn} />
      </SettingsRow>
      <SettingsRow title="Snap to">
        <Segmented
          label="Arrangement snap"
          options={SNAP_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
          value={String(division)}
          onChange={(value) => setDivision(Number(value))}
          className="self-start"
        />
      </SettingsRow>
    </div>
  );
}

export function PianoRollSettings({ compact }: { compact: boolean }) {
  const [snapOn, setSnapOn] = useRollSnapOn();
  const [grid, setGrid] = useRollGrid();
  const [strength, setStrength] = useQuantizeStrength();
  const [ends, setEnds] = useQuantizeEnds();
  const [onRecord, setOnRecord] = useQuantizeOnRecord();
  // The lane is remembered per shell (see `useVelocityLane`), so this is the showing shell's.
  const [velocityLane, setVelocityLane] = useVelocityLane(compact);
  return (
    <div className="flex flex-col gap-5">
      <SettingsRow title="Snap to grid" hint="Notes land on the grid when you draw, move or resize them.">
        <OnOff label="Snap notes to grid" on={snapOn} onChange={setSnapOn} />
      </SettingsRow>
      <SettingsRow title="Grid" hint="Also what Quantize pulls notes to.">
        <Segmented
          label="Piano roll grid"
          options={GRID_DIVISIONS.map((division) => ({ value: String(division.beats), label: division.label }))}
          value={String(grid)}
          onChange={(value) => setGrid(Number(value))}
          className="self-start font-mono"
        />
      </SettingsRow>
      <SettingsRow title="Quantize strength" hint="How far Quantize pulls each note toward the grid.">
        <Segmented
          label="Quantize strength"
          options={STRENGTH_OPTIONS.map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }))}
          value={String(strength)}
          onChange={(value) => setStrength(Number(value))}
          className="self-start font-mono"
        />
      </SettingsRow>
      <SettingsRow title="Quantize note ends" hint="Snap where notes end as well as where they start.">
        <OnOff label="Quantize note ends" on={ends} onChange={setEnds} />
      </SettingsRow>
      <SettingsRow title="Auto-quantize recordings" hint="Quantize a take as it is recorded.">
        <OnOff label="Auto-quantize recordings" on={onRecord} onChange={setOnRecord} />
      </SettingsRow>
      <SettingsRow title="Velocity lane" hint="Edit how hard each note is played, under the roll.">
        <OnOff label="Velocity lane" on={velocityLane} onChange={setVelocityLane} />
      </SettingsRow>
    </div>
  );
}

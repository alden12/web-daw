/**
 * Timing: tempo, meter, metronome, count-in and groove - everything about where the beats fall.
 * One tab of SettingsPanel.tsx.
 *
 * On touch these lived in the top bar's ⋮ beside the editing tools, which made it the one menu for
 * everything; folding them in here (MOBILE-19) leaves the account button as the way into all of
 * your settings, and the editing tools beside the surfaces they act on. On desktop the transport
 * still carries tempo, meter and the metronome too - this is the same state, not a copy.
 *
 * Tempo, meter and groove are project state, written through edits so they are undoable and the
 * MCP sees them. The metronome and count-in are this browser's preferences; the transport keeps the
 * scheduler in step with the metronome one.
 */
import { useState } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { Dispatch } from "../audio/commands/types";
import { useProject } from "../audio/project/useProject";
import { GROOVES } from "../audio/grooves/catalog";
import { TEMPO_BPM_RANGE, TIME_SIGNATURE_DENOMINATORS, TIME_SIGNATURE_NUMERATOR_RANGE } from "../audio/project/schema";
import { Segmented } from "./controls/Segmented";
import { OnOff, SettingsRow } from "./SettingsRow";
import { Select } from "./controls/Select";
import { Fader } from "./controls/Fader";
import { usePersistentBoolean } from "./usePersistent";
import { useCountInBars } from "./countIn";

const COUNT_IN = [
  { value: "0", label: "None" },
  { value: "1", label: "1 bar" },
  { value: "2", label: "2 bars" },
];

export function TimingSettings({ projectStore, dispatch }: { projectStore: ProjectStore; dispatch: Dispatch }) {
  const project = useProject(projectStore);
  const [metronome, setMetronome] = usePersistentBoolean("corrente:metronome", false);
  const [countInBars, setCountInBars] = useCountInBars();
  const meter = project.timeSignature;

  return (
    <div className="flex flex-col gap-5">
      <SettingsRow title="Tempo">
        <NumberField
          label="Tempo"
          value={project.tempoBpm}
          range={TEMPO_BPM_RANGE}
          unit="BPM"
          onChange={(bpm) => dispatch({ type: "setTempo", bpm })}
        />
      </SettingsRow>

      <SettingsRow title="Meter" hint="Beats per bar, and the note that gets the beat.">
        <div className="flex items-center gap-2">
          <NumberField
            label="Beats per bar"
            value={meter.numerator}
            range={TIME_SIGNATURE_NUMERATOR_RANGE}
            onChange={(numerator) => dispatch({ type: "setTimeSignature", numerator, denominator: meter.denominator })}
          />
          <span className="text-muted">/</span>
          <Select
            aria-label="Beat unit"
            value={meter.denominator}
            onChange={(event) =>
              dispatch({
                type: "setTimeSignature",
                numerator: meter.numerator,
                denominator: Number(event.target.value),
              })
            }
          >
            {TIME_SIGNATURE_DENOMINATORS.map((denominator) => (
              <option key={denominator} value={denominator}>
                {denominator}
              </option>
            ))}
          </Select>
        </div>
      </SettingsRow>

      <SettingsRow title="Metronome">
        <OnOff label="Metronome" on={metronome} onChange={setMetronome} />
      </SettingsRow>

      <SettingsRow title="Count-in" hint="Bars of clicks before a recording starts.">
        <Segmented
          label="Count-in"
          options={COUNT_IN}
          value={String(countInBars)}
          onChange={(value) => setCountInBars(Number(value))}
          className="self-start"
        />
      </SettingsRow>

      <SettingsRow title="Groove" hint="Swing applied at playback. The notes themselves stay where they are.">
        <Select
          aria-label="Groove"
          value={project.grooveId}
          onChange={(event) => dispatch({ type: "setGroove", grooveId: event.target.value })}
          className="self-start"
        >
          {GROOVES.map((groove) => (
            <option key={groove.id} value={groove.id}>
              {groove.name}
            </option>
          ))}
        </Select>
        {/* A slider, not presets: how much swing is a feel you dial in, and four steps of it made
            "a little less than half" unsayable. One drag is one undo step (`Fader`'s gesture). */}
        <Fader
          label="Groove amount"
          position={project.grooveAmount}
          onPosition={(amount) => dispatch({ type: "setGroove", amount: Math.round(amount * 100) / 100 })}
          display={`${Math.round(project.grooveAmount * 100)}%`}
          aria={{ now: Math.round(project.grooveAmount * 100), min: 0, max: 100 }}
          className="max-w-64"
        />
      </SettingsRow>
    </div>
  );
}

/**
 * A whole-number field over a range, committed on Enter or blur. Typing is free text until then, so
 * clearing the box to type "96" does not dispatch a tempo of 9 on the way.
 */
function NumberField({
  label,
  value,
  range,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number };
  unit?: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const parsed = Math.round(Number(draft));
    if (draft !== null && Number.isFinite(parsed)) onChange(Math.min(range.max, Math.max(range.min, parsed)));
    setDraft(null);
  };
  return (
    <label className="inline-flex items-center gap-2 self-start">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={range.min}
        max={range.max}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className="w-20 px-2 py-1.5 border border-line rounded-md bg-ground text-ink font-mono text-[13px] focus:outline-none focus:border-you"
      />
      {unit && <span className="font-mono text-[11px] text-muted">{unit}</span>}
    </label>
  );
}

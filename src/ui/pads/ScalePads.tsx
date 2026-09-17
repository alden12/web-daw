/**
 * The scale pads (MOBILE-6): a keyboard that generalises the piano instead of imitating it.
 *
 * An on-screen piano on a 390px phone gives ~27px keys, which is unplayable. In-scale notes
 * take a full-width row here and everything else sits above them, in the gaps the scale's
 * own interval pattern leaves - which in C major is exactly where the black keys are, and in
 * any other key or mode is the same shape with different labels. The layout maths is pure
 * and lives in `audio/theory/scales.ts`; this file is the pixels and the pointer handling.
 *
 * **The octave range is one control, not two:** a pair of buttons moves it and a pair sizes
 * it, sharing the label between them, and each pair disables at its limit. Both pairs work
 * in whole rows, so a tablet's two-octave rows come and go in pairs and no row is ever left
 * half the width of the one above it.
 */
import { Menu, type MenuItem } from "../Menu";
import { pitchName } from "../noteNames";
import { PITCH_CLASSES, SCALE_NAMES, accidentalWidth, padRows } from "../../audio/theory/scales";
import { ACCIDENTAL_HEIGHT, PAD_GAP, PAD_HEIGHT, rowGap } from "./geometry";
import type { PadSettings } from "./padSettings";
import { PadButton } from "./PadButton";
import { IconButton } from "../controls/IconButton";
import { CONTROL_BASE } from "../controls/tone";
import type { PadTouch } from "./usePadTouch";

/**
 * The key and the octave range. A row of its own where there is height for one, and folded
 * into the section's header where there is not - which is landscape, and landscape has the
 * width to take them.
 */
export function ScalePadControls({
  settings,
  octavesPerRow,
  inline,
}: {
  settings: PadSettings;
  octavesPerRow: number;
  inline: boolean;
}) {
  const { scale, tonic, accidentals } = settings;
  const pairs = octavesPerRow > 1;

  const keyItems: MenuItem[] = [
    {
      label: "Key",
      submenu: PITCH_CLASSES.map((name, pitchClass) => ({
        label: name,
        checked: tonic === pitchClass,
        onClick: () => settings.setTonic(pitchClass),
      })),
    },
    {
      label: "Scale",
      submenu: SCALE_NAMES.map((name) => ({
        label: name,
        checked: scale === name,
        onClick: () => settings.setScale(name),
      })),
    },
    { separator: true },
    { label: "Accidentals", checked: accidentals, onClick: () => settings.setAccidentals(!accidentals) },
  ];

  return (
    <div className={`shrink-0 flex items-center gap-1 ${inline ? "flex-1 min-w-0" : "px-2 pb-1.5"}`}>
      <Menu
        items={keyItems}
        label="Key and scale"
        align="left"
        // A word, so it keeps the grey pill a word needs. `Menu` renders its own trigger, so
        // it borrows the class rather than being a `Button`.
        triggerClassName={`${CONTROL_BASE} shrink-0 h-8 px-3 rounded-full bg-control text-ink hover:bg-control-hover font-mono text-[11px]`}
        trigger={
          <>
            {settings.keyLabel}
            <span className="text-[11px]">▾</span>
          </>
        }
      />
      <div className="ml-auto shrink-0 flex items-center">
        <IconButton
          label="Lower octave"
          size="lg"
          onClick={() => settings.moveRange(-1)}
          disabled={!settings.canMove(-1)}
        >
          ◂
        </IconButton>
        <span className="w-16 text-center font-mono text-[10px] text-muted tabular-nums">{settings.rangeLabel}</span>
        <IconButton
          label="Higher octave"
          size="lg"
          onClick={() => settings.moveRange(1)}
          disabled={!settings.canMove(1)}
        >
          ▸
        </IconButton>
        <IconButton
          label={pairs ? "Fewer octaves (a row of two)" : "Fewer octaves"}
          size="lg"
          onClick={() => settings.sizeRange(-1)}
          disabled={!settings.canSize(-1)}
        >
          −
        </IconButton>
        <IconButton
          label={pairs ? "More octaves (a row of two)" : "More octaves"}
          size="lg"
          onClick={() => settings.sizeRange(1)}
          disabled={!settings.canSize(1)}
        >
          +
        </IconButton>
      </div>
    </div>
  );
}

export function ScalePads({
  settings,
  touch,
  octavesPerRow,
}: {
  settings: PadSettings;
  touch: PadTouch;
  /**
   * A tablet fits two octaves per row; below ~44px per pad the layout is wrong rather than
   * merely tight, so a phone gets one and stacks them instead. Decided by the shell, which
   * is the thing that knows what it is running on.
   */
  octavesPerRow: number;
}) {
  const { tonic, scale, lowOctave, octaves, accidentals } = settings;
  const rows = padRows({ tonic, scale, lowOctave, octaves, octavesPerRow, accidentals });

  return (
    // High row on top, as the roll puts high pitches at the top. The gap between rows is
    // wider with the accidentals off, where it is the only thing keeping a fingertip from
    // landing on two octaves at once - see `rowGap`.
    <div className="shrink-0 flex flex-col-reverse px-2 pb-2" style={{ gap: rowGap(accidentals) }}>
      {rows.map((row) => (
        <div key={row.pitches[0].pitch} data-pad-row={row.pitches[0].pitch} className="flex flex-col gap-1">
          {accidentals && (
            <div className="relative shrink-0" style={{ height: ACCIDENTAL_HEIGHT }}>
              {row.accidentals.map((pad) => (
                <PadButton
                  key={pad.pitch}
                  pitch={pad.pitch}
                  name={pitchName(pad.pitch)}
                  label={pad.interval}
                  tone="accidental"
                  touch={touch}
                  className="absolute top-0 h-full -translate-x-1/2"
                  // Positions come from the layout in pad-width units, so an accidental still
                  // sits over the gap it belongs to - between the two naturals it is between,
                  // which is the whole reason this is a keyboard rather than a list. It is a
                  // full pad wide now, so the gap it leaves has to be taken out of the width
                  // rather than left to the layout, which has no gaps of its own to give.
                  style={{
                    left: `${(pad.center / row.pitches.length) * 100}%`,
                    width: `calc(${(accidentalWidth / row.pitches.length) * 100}% - ${PAD_GAP}px)`,
                  }}
                />
              ))}
            </div>
          )}
          <div className="shrink-0 flex gap-1" style={{ height: PAD_HEIGHT }}>
            {row.pitches.map((pad) => (
              <PadButton
                key={pad.pitch}
                pitch={pad.pitch}
                name={pitchName(pad.pitch)}
                label={pad.interval}
                sublabel={pitchName(pad.pitch)}
                tone={pad.interval === "1" ? "tonic" : "in-scale"}
                touch={touch}
                className="flex-1 min-w-0"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

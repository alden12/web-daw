/**
 * The keys panel (DAW-12.1): the computer keyboard drawn in the piano roll, under its velocity
 * lane, so you can see what each key plays - and play it with the mouse too. Desktop only; the touch
 * shells have the pads themselves (MOBILE-6).
 *
 * It is a display, not the input: `useKeyboardPlaying` lives in the shell and plays the keys with
 * the panel collapsed or off screen. The key menu and the range control are the pads' own
 * (`ScalePadControls`), sharing their settings, so a key chosen here is the key the pads play.
 *
 * **Each keyboard row is a row on screen, top row first, one line per key:** the keycap first,
 * since that is what you are looking for, and what it plays beside it. Rows are stacked straight
 * rather than staggered, which reads more easily; the note rows are set half a key to the right
 * of the accidental rows, so each accidental sits between the two notes it is between as a black
 * key does, and a key that plays nothing is not drawn at all.
 */
import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { IconButton } from "../controls/IconButton";
import { PadButton } from "../pads/PadButton";
import type { PadSettings } from "../pads/padSettings";
import { ScalePadControls } from "../pads/ScalePads";
import type { PadTouch } from "../pads/usePadTouch";
import { isAccidentalRow, isArrangeCode, qwertyLabel, type KeyCell, type KeyPad, type KeyRowMode } from "./keyLayout";
import type { KeyboardPlaying } from "./useKeyboardPlaying";
import { BODY_PADDING, KEY_GAP, KEY_HEIGHT, KEYS_HEADER_HEIGHT, rowUnits } from "./panelGeometry";

/** `navigator.keyboard.getLayoutMap`, where the browser has it (Chromium): what each key prints. */
type LayoutMap = { get(code: string): string | undefined };
const keyboardApi = () =>
  (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } }).keyboard;

/** Each key's label as this machine's layout prints it, or as QWERTY does where the browser cannot say. */
function useKeycapLabels(): (code: string) => string {
  const [layout, setLayout] = useState<LayoutMap | null>(null);
  useEffect(() => {
    let active = true;
    void keyboardApi()
      ?.getLayoutMap?.()
      .then((map) => active && setLayout(map))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  // The rows shown only while arranging chords are not on any key.
  return (code) => (isArrangeCode(code) ? "" : (layout?.get(code)?.toUpperCase() ?? qwertyLabel(code)));
}

export function KeysPanel({
  rows,
  settings,
  touch,
  keyboard,
  open,
  onToggle,
  shownRows,
  rowMode,
  velocity,
  onVelocity,
}: {
  /** The layout, bottom row first (`keyboardRows`). */
  rows: KeyCell[][];
  settings: PadSettings;
  touch: PadTouch;
  keyboard: KeyboardPlaying;
  open: boolean;
  onToggle: () => void;
  /** How many rows to draw, from the bottom. The rest still play. */
  shownRows: number;
  /** Alternate rows as accidentals, or every row an octave (the pads' Accidentals switch). */
  rowMode: KeyRowMode;
  /** The velocity the keys strike at, 0..1. */
  velocity: number;
  onVelocity: (velocity: number) => void;
}) {
  const keycap = useKeycapLabels();
  const hint = !settings.chords && rowMode === "octaves" ? "Shift sharps · [ ] octave" : "[ ] octave";
  // A pad lights for a key held down as well as for the mouse, so the panel shows what is playing.
  const lit: PadTouch = { ...touch, isSounding: (pitches) => touch.isSounding(pitches) || keyboard.isHeld(pitches) };
  // With accidental rows, the note rows sit half a key right of them, so each accidental falls
  // between its two notes. Shift keeps every row where it is: its accidentals are on the same keys.
  const offset = (rowIndex: number) =>
    rowMode === "accidentals" && !settings.chords && !isAccidentalRow(rowIndex, { chords: settings.chords, rowMode });

  return (
    <div className="h-full bg-ground flex flex-col min-h-0 overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-2.5 bg-rail" style={{ height: KEYS_HEADER_HEIGHT }}>
        <IconButton label={open ? "Hide keys" : "Show keys"} size="lg" onClick={onToggle}>
          {open ? "▾" : "▸"}
        </IconButton>
        <span className="font-mono text-[11px] text-muted shrink-0">Keys</span>
        {open && (
          <>
            <span className="font-mono text-[10px] text-faint shrink-0">{hint}</span>
            <div className="flex-1 min-w-0 flex">
              <ScalePadControls settings={settings} octavesPerRow={1} inline />
            </div>
          </>
        )}
      </div>
      {open && (
        <div className="flex-1 min-h-0 flex" style={{ padding: BODY_PADDING, gap: BODY_PADDING }}>
          <VelocityStrip velocity={velocity} onVelocity={onVelocity} />
          {/* Scrolls only while arranging chords, when every row the key offers is laid out above the
              keys; column-reverse, so it opens at the bottom with the keys in view. */}
          <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain flex flex-col-reverse [scrollbar-width:thin]">
            <div className="flex flex-col-reverse" style={{ gap: KEY_GAP }}>
              {(settings.editingChords ? rows : rows.slice(0, shownRows)).map((row, rowIndex) => (
                <KeyRow
                  key={rowIndex}
                  row={row}
                  offset={offset(rowIndex)}
                  units={rowUnits(rowMode === "accidentals" && !settings.chords)}
                  settings={settings}
                  touch={lit}
                  heldAt={keyboard.heldAt}
                  keycap={keycap}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One keyboard row. Widths are shares of `units` keys, so the keys fill the panel and line up
 * across rows whatever its width.
 */
function KeyRow({
  row,
  offset,
  units,
  settings,
  touch,
  heldAt,
  keycap,
}: {
  row: KeyCell[];
  /** Set half a key across: a note row, with the accidentals between its keys. */
  offset: boolean;
  /** The row's width in keys (`rowUnits`), the same for every row so their keys line up. */
  units: number;
  settings: PadSettings;
  touch: PadTouch;
  heldAt: KeyboardPlaying["heldAt"];
  keycap: (code: string) => string;
}) {
  const unit = `(100% / ${units})`;
  const style = { width: `calc(${unit} - ${KEY_GAP}px)`, marginRight: KEY_GAP };
  const edges = offscreenEdges(row, heldAt);
  return (
    <div className="flex" style={{ height: KEY_HEIGHT }}>
      {offset && <div className="shrink-0" style={{ width: `calc(0.5 * ${unit})` }} />}
      {row.map(({ code, pad }) => {
        const edge = edgeStyle(edges.get(code));
        return pad ? (
          <PadButton
            key={code}
            pitches={pad.pitches}
            name={pad.name}
            label={<OneLine keycap={keycap(code)} what={`${pad.label} ${pad.sublabel}`} />}
            tone={pad.tone}
            touch={touch}
            // The label is capped at the key's width (`[&>span]`, PadButton's label wrapper), so a long
            // chord name ellipsises rather than spilling over the keycap.
            className="shrink-0 overflow-hidden px-1.5 [&>span]:max-w-full"
            style={{ ...style, ...edge }}
            editing={editingFor(pad, settings)}
          />
        ) : (
          // Holds the key's place, so the keys either side stay in their columns.
          <div key={code} aria-hidden className="shrink-0 rounded-md" style={{ ...style, ...edge }} />
        );
      })}
    </div>
  );
}

/**
 * Edges for notes a key is still sounding that the panel no longer shows on that key - a sharp held
 * through letting go of Shift, or a note held through pressing it. Each lands on a shown pad the
 * note sits beside, on the side it sits - the held key's own where it can, else a neighbour's: the
 * right of the note below it, or the left of the note above. So a held sharp edges its note's right, a held C under Shift edges the left of C#, and a
 * held E under Shift (whose key goes blank) edges the right of the D# next door.
 */
type Side = "left" | "right";

function offscreenEdges(row: KeyCell[], heldAt: KeyboardPlaying["heldAt"]): Map<string, Side[]> {
  const shownAt = (pitch: number) => row.find(({ pad }) => pad?.pitches.length === 1 && pad.pitches[0] === pitch);
  const marks = row.flatMap(({ code, pad }): { code: string; side: Side }[] => {
    const held = heldAt(code);
    // Chords are drawn where they are played; only a single note can be left off its key.
    if (!held || held.length !== 1 || (pad && pad.pitches.join() === held.join())) return [];
    const [pitch] = held;
    // Its own key first, when that shows a neighbour of it: the key you are holding is the one to mark.
    if (pad?.pitches[0] === pitch - 1) return [{ code, side: "right" }];
    if (pad?.pitches[0] === pitch + 1) return [{ code, side: "left" }];
    const above = shownAt(pitch + 1);
    if (above) return [{ code: above.code, side: "left" }];
    const below = shownAt(pitch - 1);
    return below ? [{ code: below.code, side: "right" }] : [];
  });
  return marks.reduce(
    (edges, { code, side }) => new Map(edges).set(code, [...(edges.get(code) ?? []), side]),
    new Map<string, Side[]>(),
  );
}

const EDGE_SHADOW = { left: "inset 2px 0 0 var(--color-you)", right: "inset -2px 0 0 var(--color-you)" } as const;
const edgeStyle = (sides: Side[] | undefined) =>
  sides ? { boxShadow: sides.map((side) => EDGE_SHADOW[side]).join(", ") } : {};

/** A chord pad's selection while the chords are being arranged; nothing otherwise. */
const editingFor = (pad: KeyPad, settings: PadSettings) =>
  settings.editingChords && pad.chord
    ? {
        onSelect: () => pad.chord && settings.setChordSelection({ degree: pad.chord.degree, family: pad.chord.family }),
        selected:
          settings.chordSelection?.degree === pad.chord.degree && settings.chordSelection.family === pad.chord.family,
        hidden: pad.chord.hidden,
      }
    : undefined;

/** The keycap, then what it plays, small: `Q 1 C5`, `Z C I`. The keycap always shows; what it
 *  plays is cut short with an ellipsis when the key is too narrow for it. */
function OneLine({ keycap, what }: { keycap: string; what: string }) {
  return (
    <span className="flex items-baseline gap-1.5 min-w-0 max-w-full" title={`${keycap}  ${what}`}>
      {keycap && <span className="shrink-0 text-[13px]">{keycap}</span>}
      <span className="min-w-0 truncate text-[10px] font-normal text-muted">{what}</span>
    </span>
  );
}

/** The quietest a key may strike: silent notes would read as the keys being broken. */
const MIN_VELOCITY = 0.05;
const VELOCITY_STEP = 0.05;

/**
 * The velocity the keys strike at, as a strip left of the keys. **Press and drag** to set it, so
 * passing the mouse over it on the way somewhere else changes nothing; the arrow keys work once
 * it has focus. It sets the next notes' velocity: a note's velocity is fixed when it starts, so a
 * held note keeps the one it struck at.
 */
function VelocityStrip({ velocity, onVelocity }: { velocity: number; onVelocity: (velocity: number) => void }) {
  const clamp = (value: number) => Math.min(1, Math.max(MIN_VELOCITY, value));
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onVelocity(clamp(1 - (event.clientY - rect.top) / rect.height));
  };
  const nudge: Record<string, number> = { ArrowUp: VELOCITY_STEP, ArrowDown: -VELOCITY_STEP };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (nudge[event.key] === undefined) return;
    event.preventDefault();
    onVelocity(clamp(velocity + nudge[event.key]));
  };
  const midi = Math.round(velocity * 127);
  return (
    <div
      role="slider"
      aria-label="Velocity"
      aria-orientation="vertical"
      aria-valuemin={Math.round(MIN_VELOCITY * 127)}
      aria-valuemax={127}
      aria-valuenow={midi}
      tabIndex={0}
      title="Velocity: drag to set. The keys strike at this."
      onPointerDown={(event) => {
        // Captured, so the drag keeps setting it however far the pointer wanders.
        event.currentTarget.setPointerCapture(event.pointerId);
        fromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
      }}
      onKeyDown={onKeyDown}
      className="shrink-0 relative w-12 rounded-md bg-control overflow-hidden cursor-ns-resize touch-none focus-visible:outline-2 focus-visible:outline-you"
    >
      <div className="absolute inset-x-0 bottom-0 bg-you/35" style={{ height: `${velocity * 100}%` }} />
      <span className="absolute inset-x-0 top-1 text-center font-mono text-[9px] text-muted">vel</span>
      <span className="absolute inset-x-0 bottom-1 text-center font-mono text-[11px] text-ink tabular-nums">
        {midi}
      </span>
    </div>
  );
}

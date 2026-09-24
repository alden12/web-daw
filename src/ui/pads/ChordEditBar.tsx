/**
 * Arranging the chord pads (MOBILE-12): the bar that takes the key and octave controls' place while
 * you edit, acting on the chord you tapped.
 *
 * **Where a change lands is a choice on the bar**, not a rule: "Column" moves or hides the chord in
 * its own column only - the ii chord wanting sus2 first - and "All" changes the order every column
 * follows unless it has its own. Starring is always the column's: a favourite is a particular chord.
 *
 * Up and down swap the chord with the one beside it in its column, hidden ones included (they are
 * laid out, dimmed, while editing), so a move never jumps further than it looks.
 */
import { useState, type ReactNode } from "react";
import { chordRows, type ChordFamily } from "../../audio/theory/chords";
import {
  DEFAULT_CHORD_PREFS,
  resetColumn,
  setHidden,
  swapFamilies,
  toggleFavourite,
  type ChordScope,
} from "../../audio/theory/chordPrefs";
import { Button } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import type { PadSettings } from "./padSettings";

export function ChordEditBar({ settings, inline }: { settings: PadSettings; inline: boolean }) {
  const [scope, setScope] = useState<ChordScope>("column");
  const { tonic, scale, lowOctave, chordPrefs: prefs, chordSelection: selection, setChordPrefs } = settings;
  const rows = chordRows({ tonic, scale, lowOctave, prefs, editing: true });

  // Where the selected chord sits: its column (the first with its degree - the closing tonic shares
  // the first column's arrangement) and its row, and the variations either side of it there.
  const column = selection ? rows[0].findIndex((pad) => pad?.degree === selection.degree) : -1;
  const rowIndex = column < 0 ? -1 : rows.findIndex((row) => row[column]?.family === selection?.family);
  const chord = rowIndex < 0 ? null : rows[rowIndex][column];
  const neighbour = (offset: number): ChordFamily | null => {
    const family = rows[rowIndex + offset]?.[column]?.family;
    return family && family !== "triad" ? family : null;
  };
  const up = chord ? neighbour(1) : null;
  const down = chord && rowIndex > 1 ? neighbour(-1) : null;

  const done = (
    <Button size="sm" onClick={() => settings.setEditingChords(false)}>
      Done
    </Button>
  );
  const bar = (children: ReactNode) => (
    <div className={`shrink-0 flex items-center gap-1 h-8 ${inline ? "flex-1 min-w-0" : "px-2 mb-1.5"}`}>
      {children}
    </div>
  );

  if (!chord || !selection)
    return bar(
      <>
        <span className="flex-1 min-w-0 truncate text-[11px] text-muted">Tap a chord to arrange it</span>
        <Button size="sm" onClick={() => setChordPrefs(DEFAULT_CHORD_PREFS)}>
          Reset all
        </Button>
        {done}
      </>,
    );

  const variation = chord.family === "triad" ? null : chord.family;
  const move = (other: ChordFamily | null) => {
    if (variation && other) setChordPrefs(swapFamilies(prefs, selection.degree, variation, other, scope));
  };

  return bar(
    <>
      {/* No name: the chord is outlined on the pads, and a phone needs every pixel of this row. */}
      <span className="flex-1" />
      <IconButton label="Move down" size="lg" onClick={() => move(down)} disabled={!down}>
        ▼
      </IconButton>
      <IconButton label="Move up" size="lg" onClick={() => move(up)} disabled={!up}>
        ▲
      </IconButton>
      <IconButton
        label={chord.favourite ? "Unstar" : "Star as a favourite"}
        size="lg"
        active={chord.favourite}
        onClick={() => setChordPrefs(toggleFavourite(prefs, selection.degree, selection.family))}
      >
        {chord.favourite ? "★" : "☆"}
      </IconButton>
      <Button
        size="sm"
        disabled={!variation}
        onClick={() => variation && setChordPrefs(setHidden(prefs, selection.degree, variation, !chord.hidden, scope))}
      >
        {chord.hidden ? "Show" : "Hide"}
      </Button>
      {/* One button that flips, rather than a two-way switch: the same choice in half the width. */}
      <Button
        size="sm"
        title={
          scope === "column"
            ? "Changing this column only - tap for every column"
            : "Changing every column - tap for this one only"
        }
        onClick={() => setScope(scope === "column" ? "all" : "column")}
      >
        {scope === "column" ? "Column" : "All"}
      </Button>
      <IconButton
        label="Reset this column"
        size="lg"
        onClick={() => setChordPrefs(resetColumn(prefs, selection.degree))}
        disabled={
          !prefs.columns[selection.degree] && !prefs.favourites.some((key) => key.startsWith(`${selection.degree}:`))
        }
      >
        ↺
      </IconButton>
      {done}
    </>,
  );
}

/**
 * The minimised editor's glance at what it is editing (MOBILE-19.1): the active clip's notes,
 * squeezed into the preview bar, so a parked sheet still says which clip is under it.
 *
 * Drawn in beats and pitch rows straight into the viewBox and stretched to the bar, so there is
 * no measuring and it follows the clip live (`useClip`) as notes are recorded.
 */
import { useClip } from "../../audio/sequencer/useClip";
import type { ClipStore } from "../../audio/sequencer/clipStore";

/** Head and foot room in the bar, as a share of its height, so the outer notes are not clipped. */
const MARGIN = 0.12;

export function ClipPreview({ store, name }: { store: ClipStore; name: string }) {
  const clip = useClip(store);
  const length = clip.lengthBeats;
  const notes = clip.notes.filter((note) => note.start >= 0 && note.start < length);
  if (length <= 0 || notes.length === 0)
    return <span className="block px-2 truncate font-mono text-[10px] text-faint">{name} · empty</span>;

  const pitches = notes.map((note) => note.pitch);
  const lowest = Math.min(...pitches);
  const rows = Math.max(...pitches) - lowest + 1;
  const rowHeight = (1 - 2 * MARGIN) / rows;
  return (
    <svg
      viewBox={`0 0 ${length} 1`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Clip ${name}, ${notes.length} notes`}
      className="block w-full h-full"
    >
      {notes.map((note) => (
        <rect
          key={note.id}
          x={note.start}
          width={Math.max(length / 120, note.length - length / 200)}
          y={MARGIN + (rows - 1 - (note.pitch - lowest)) * rowHeight}
          // Never thinner than a hairline, however many rows a wide clip spans.
          height={Math.max(rowHeight * 0.8, 0.06)}
          fill="var(--color-you)"
        />
      ))}
    </svg>
  );
}

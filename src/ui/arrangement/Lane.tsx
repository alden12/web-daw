/**
 * One track's lane on the arrangement: the placement blocks over the beat grid,
 * the clip-from-rail drop target, and the pointer gestures (place / select / move /
 * resize / split). Selection is lifted to the timeline so the lanes and the piano
 * roll agree on what's active. `Block` and `NoteMinis` are the lane's own block
 * rendering, kept here since nothing else uses them.
 */
import { useRef, useState } from "react";
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import type { ClipStore } from "../../audio/sequencer/clipStore";
import type { Placement } from "../../audio/project/types";
import type { Dispatch } from "../../audio/commands/types";
import { GRID } from "../../audio/sequencer/types";
import { useClip } from "../../audio/sequencer/useClip";
import { clipKey, noteKey } from "../../audio/commands/authorship";
import { voiceBlockClass, voiceBlockTint, voiceMiniClass } from "../authorVoice";
import { newClipId, newPlacementId } from "../../audio/commands/ids";
import { beginPointerDrag } from "../pointerDrag";
import { Waveform } from "../Waveform";
import { CLIP_DND_TYPE, clipDndKindType, getDraggedClip } from "../clipDnd";
import { beatToX, floorBeat, snapBeat, xToBeat } from "../timeline/timeGrid";
import { ROW, RESIZE_PX, DRAG_THRESH, type Selection } from "./shared";

/** A placement block: pixel-positioned region with a label, shared by both kinds. Tinted by the
 *  clip's last editor (its `author` voice). */
function Block({
  name,
  author,
  left,
  width,
  selected,
  onPointerDown,
  onDoubleClick,
  children,
}: {
  name?: string;
  author: string;
  left: number;
  width: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="placement"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`absolute top-1.5 bottom-1.5 rounded border overflow-hidden cursor-grab ${voiceBlockClass(author, selected)}`}
      style={{ left, width: Math.max(3, width) }}
      title={name}
    >
      <div className={`absolute inset-0 ${voiceBlockTint(author)}`} />
      {children}
      <span className="absolute left-1.5 top-1 font-mono text-[9px] text-muted truncate max-w-full pr-1">{name}</span>
      {/* right-edge resize affordance */}
      <div className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize" />
    </div>
  );
}

/**
 * Mini note summary of an instrument clip, tiled across the placement window so a
 * looped clip (a window longer than the clip) shows its repeats, with a faint
 * divider at each loop boundary. Mirrors the scheduler's `tileClipNotes` math.
 */
function NoteMinis({
  store,
  placement,
  pxPerBeat,
  projectStore,
  fallbackAuthor,
}: {
  store: ClipStore;
  placement: Placement;
  pxPerBeat: number;
  projectStore: ProjectStore;
  /** Voice for notes with no recorded editor yet (matches the block's clip author). */
  fallbackAuthor: string;
}) {
  const clip = useClip(store);
  const clipLen = clip.lengthBeats;
  if (clipLen <= 0) return null;
  const body = clip.notes.filter((note) => note.start >= 0 && note.start < clipLen);
  const pitches = body.map((note) => note.pitch);
  const lo = pitches.length ? Math.min(...pitches) : 48;
  const hi = pitches.length ? Math.max(...pitches) : 72;
  const span = Math.max(1, hi - lo);

  // Tiled note onsets (arrangement-relative beats), and loop-boundary dividers.
  const tiles: { key: string; tau: number; note: (typeof body)[number] }[] = [];
  for (const note of body) {
    let phase = (note.start - placement.offset) % clipLen;
    if (phase < 0) phase += clipLen;
    for (let tau = phase; tau < placement.length; tau += clipLen) tiles.push({ key: `${note.id}:${tau}`, tau, note });
  }
  const dividers: number[] = [];
  let first = -placement.offset % clipLen;
  if (first < 0) first += clipLen;
  for (let tau = first; tau < placement.length; tau += clipLen) if (tau > 0.001) dividers.push(tau);

  return (
    <>
      {dividers.map((tau) => (
        <div
          key={`d${tau}`}
          className="absolute top-0 bottom-0 w-px bg-you/25 pointer-events-none"
          style={{ left: beatToX(tau, pxPerBeat) }}
        />
      ))}
      {tiles.map(({ key, tau, note }) => (
        <div
          key={key}
          className={`absolute h-0.5 rounded-[1px] pointer-events-none ${voiceMiniClass(
            projectStore.authorOf(noteKey(note.id)) ?? fallbackAuthor,
          )}`}
          style={{
            left: beatToX(tau, pxPerBeat),
            width: Math.max(2, beatToX(note.length, pxPerBeat)),
            bottom: `${((note.pitch - lo) / span) * 60 + 18}%`,
          }}
        />
      ))}
    </>
  );
}

/**
 * One track's lane: an editable strip of placement blocks over the beat grid.
 * Owns the pointer gestures (place / select / move / resize / split) and reports
 * edits through the dispatch; selection is lifted to the parent so the roll and
 * the lanes agree on what's active.
 */
export function Lane({
  track,
  width,
  pxPerBeat,
  beatsPerBar,
  snapOn,
  snapDiv,
  selection,
  markerBeat,
  dropBeat,
  onSelect,
  onMark,
  onHover,
  dispatch,
  projectStore,
}: {
  track: Track;
  width: number;
  pxPerBeat: number;
  beatsPerBar: number;
  snapOn: boolean;
  snapDiv: number;
  selection: Selection;
  markerBeat: number | null;
  dropBeat: number | null;
  onSelect: (trackId: string, p: Placement) => void;
  onMark: (trackId: string, beat: number) => void;
  onHover: (beat: number | null) => void;
  dispatch: Dispatch;
  projectStore: ProjectStore;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ left: number; width: number } | null>(null);
  const beatAt = (clientX: number) => xToBeat(clientX - (ref.current?.getBoundingClientRect().left ?? 0), pxPerBeat);
  const snapB = (b: number) => (snapOn ? snapBeat(b, snapDiv) : b);
  const floorB = (b: number) => floorBeat(b, snapOn ? snapDiv : GRID);

  // Drop a clip dragged from a clip rail at the cursor. Any same-kind track's lane
  // accepts: dropping on the clip's own track places the existing clip; dropping on
  // another same-kind track copies the clip into that track's pool first, then
  // places it.
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(clipDndKindType(track.kind));
  const onDragOver = (e: React.DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    onHover(Math.max(0, floorB(beatAt(e.clientX))));
  };
  const onDrop = (e: React.DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    onHover(null);
    const startBeat = Math.max(0, floorB(beatAt(e.clientX)));
    const draggedId = e.dataTransfer.getData(CLIP_DND_TYPE);
    if (draggedId && track.clips.some((clip) => clip.id === draggedId)) {
      // Same track: place the existing clip.
      const id = newPlacementId();
      dispatch({
        type: "addPlacement",
        trackId: track.id,
        id,
        clipId: draggedId,
        startBeat,
      });
      onSelect(track.id, {
        id,
        clipId: draggedId,
        startBeat,
        offset: 0,
        length: 0,
      });
      return;
    }
    // Cross-track: copy the dragged clip's content into this track, then place it.
    const content = getDraggedClip();
    if (!content || content.kind !== track.kind) return;
    const clipId = newClipId();
    const id = newPlacementId();
    dispatch({ type: "pasteClip", trackId: track.id, id: clipId, content });
    dispatch({
      type: "addPlacement",
      trackId: track.id,
      id,
      clipId,
      startBeat,
    });
    onSelect(track.id, { id, clipId, startBeat, offset: 0, length: 0 });
  };

  // Drag a block: body -> move, right edge -> resize. Both snap and coalesce.
  const onBlockDown = (p: Placement, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(track.id, p);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isEdge = rect.right - e.clientX <= RESIZE_PX;
    const downBeat = beatAt(e.clientX);
    const origin = { startBeat: p.startBeat, length: p.length };

    const onMove = (ev: PointerEvent) => {
      const delta = beatAt(ev.clientX) - downBeat;
      if (isEdge) {
        const length = Math.max(snapOn ? snapDiv : GRID, snapB(origin.length + delta));
        if (length !== p.length)
          dispatch({
            type: "resizePlacement",
            trackId: track.id,
            placementId: p.id,
            length,
          });
      } else {
        const startBeat = Math.max(0, snapB(origin.startBeat + delta));
        if (startBeat !== p.startBeat)
          dispatch({
            type: "movePlacement",
            trackId: track.id,
            placementId: p.id,
            startBeat,
          });
      }
    };
    beginPointerDrag(onMove);
  };

  // Double-click a block to split it at the cursor.
  const onBlockDouble = (p: Placement, e: React.MouseEvent) => {
    e.stopPropagation();
    const at = snapB(beatAt(e.clientX));
    if (at > p.startBeat && at < p.startBeat + p.length)
      dispatch({
        type: "splitPlacement",
        trackId: track.id,
        placementId: p.id,
        atBeat: at,
        newId: newPlacementId(),
      });
  };

  // Create a new empty clip sized to [start, start+length) and place it; the new
  // clip becomes active so the roll follows it. (Place an existing clip via the
  // clip rail, or copy/paste / drag-loop to repeat one.)
  const createClip = (start: number, length: number) => {
    if (track.kind !== "instrument") return;
    const clipId = newClipId();
    const id = newPlacementId();
    dispatch({
      type: "addClip",
      trackId: track.id,
      id: clipId,
      empty: true,
      lengthBeats: length,
    });
    dispatch({
      type: "addPlacement",
      trackId: track.id,
      id,
      clipId,
      startBeat: start,
      length,
    });
    onSelect(track.id, { id, clipId, startBeat: start, offset: 0, length });
  };

  // Press on empty lane: a clean click drops a paste marker at that beat; a drag
  // sketches a new empty clip sized to the drag.
  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const downBeat = beatAt(e.clientX);
    const downX = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - downX) <= DRAG_THRESH) return;
      moved = true;
      const start = Math.max(0, floorB(Math.min(downBeat, beatAt(ev.clientX))));
      const end = snapB(Math.max(downBeat, beatAt(ev.clientX)));
      const length = Math.max(snapOn ? snapDiv : GRID, end - start);
      setDraft({
        left: beatToX(start, pxPerBeat),
        width: beatToX(length, pxPerBeat),
      });
    };
    beginPointerDrag(onMove, (ev) => {
      setDraft(null);
      if (!moved) {
        // Click: drop a paste marker (copy/paste lands here).
        onMark(track.id, Math.max(0, floorB(downBeat)));
        return;
      }
      // Drag: an empty clip sized to the drag.
      const start = Math.max(0, floorB(Math.min(downBeat, beatAt(ev.clientX))));
      const length = Math.max(snapOn ? snapDiv : GRID, snapB(Math.max(downBeat, beatAt(ev.clientX))) - start);
      createClip(start, length);
    });
  };

  const laneBg = [
    `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${pxPerBeat * beatsPerBar}px)`,
    `repeating-linear-gradient(90deg, var(--color-line-soft) 0 1px, transparent 1px ${pxPerBeat}px)`,
  ].join(", ");

  return (
    <div
      ref={ref}
      data-testid="lane"
      onPointerDown={onLaneDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`${ROW} relative border-b border-line-soft cursor-copy`}
      style={{ width, background: laneBg }}
    >
      {track.placements.map((placement) => {
        const clip = track.clips.find((candidate) => candidate.id === placement.clipId);
        const selected = selection?.trackId === track.id && selection.id === placement.id;
        // The block follows the clip's last editor (content author): its `clip:<id>` authorship,
        // falling back to the clip's creation author for clips edited before this was tracked.
        const clipAuthor = (clip && projectStore.authorOf(clipKey(clip.id))) ?? clip?.author ?? "you";
        return (
          <Block
            key={placement.id}
            name={clip?.name}
            author={clipAuthor}
            left={beatToX(placement.startBeat, pxPerBeat)}
            width={beatToX(placement.length, pxPerBeat)}
            selected={selected}
            onPointerDown={(e) => onBlockDown(placement, e)}
            onDoubleClick={(e) => onBlockDouble(placement, e)}
          >
            {clip && "store" in clip ? (
              <NoteMinis
                store={clip.store}
                placement={placement}
                pxPerBeat={pxPerBeat}
                projectStore={projectStore}
                fallbackAuthor={clipAuthor}
              />
            ) : clip && "fileId" in clip ? (
              <Waveform fileId={clip.fileId} gain={clip.gain} className="absolute inset-0 w-full h-full opacity-80" />
            ) : null}
          </Block>
        );
      })}
      {draft && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded border border-dashed border-you bg-you/15 pointer-events-none"
          style={{ left: draft.left, width: Math.max(2, draft.width) }}
        />
      )}
      {dropBeat !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-you pointer-events-none"
          style={{ left: beatToX(dropBeat, pxPerBeat) }}
        />
      )}
      {markerBeat !== null && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-bright pointer-events-none"
          style={{ left: beatToX(markerBeat, pxPerBeat) }}
          title="Paste marker"
        >
          <span className="absolute -top-0.5 -left-1 w-2 h-2 rotate-45 bg-bright" />
        </div>
      )}
      {track.launchedClipId && (
        <div className="absolute inset-0 bg-ground/60 pointer-events-none flex items-center px-2 z-10">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-you bg-ground/80 border border-you/50 rounded px-1.5 py-0.5">
            ▶ {track.clips.find((clip) => clip.id === track.launchedClipId)?.name ?? "clip"}
          </span>
        </div>
      )}
    </div>
  );
}

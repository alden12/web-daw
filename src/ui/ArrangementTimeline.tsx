/**
 * The arrangement timeline (bottom): the project's bus tree on the left, one
 * lane per track on a shared bar grid on the right, with a playhead that tracks
 * the scheduler. The left column is a collapsible group tree (groups are
 * track-of-tracks buses): each group header carries collapse / mute / volume /
 * remove, and its tracks and subgroups nest beneath it.
 *
 * Both columns iterate the SAME flattened, visible row list so headers and lanes
 * stay row-aligned. Current model is one loop per track, so each lane shows a
 * single clip region with a mini note preview.
 */
import { useEffect, useRef } from "react";
import type { ProjectStore, Track } from "../audio/project/projectStore";
import type { ClipStore } from "../audio/sequencer/clipStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { GroupMeta, Placement, TrackMeta } from "../audio/project/types";
import type { Dispatch } from "../audio/commands/types";
import { newGroupId } from "../audio/commands/ids";
import { useProject } from "../audio/project/useProject";
import { useClip } from "../audio/sequencer/useClip";
import { TransportBar } from "./TransportBar";

const ROW = "h-11.5 shrink-0";
const INDENT = 14; // px per tree depth

type Row =
  | { kind: "group"; group: GroupMeta; depth: number }
  | { kind: "track"; track: TrackMeta; depth: number };

/** Depth-first, collapse-aware flatten: subgroups then tracks under each group. */
function flattenRows(groups: GroupMeta[], tracks: TrackMeta[]): Row[] {
  const rows: Row[] = [];
  const walk = (group: GroupMeta, depth: number) => {
    rows.push({ kind: "group", group, depth });
    if (group.collapsed) return;
    for (const sub of groups.filter((g) => g.parentId === group.id))
      walk(sub, depth + 1);
    for (const t of tracks.filter((t) => t.parentId === group.id))
      rows.push({ kind: "track", track: t, depth: depth + 1 });
  };
  for (const g of groups.filter((g) => g.parentId === null)) walk(g, 0);
  // Defensive: surface any orphaned tracks (model keeps every track in a group).
  for (const t of tracks.filter(
    (t) => !groups.some((g) => g.id === t.parentId),
  ))
    rows.push({ kind: "track", track: t, depth: 0 });
  return rows;
}

/**
 * Read-only preview of a track's arrangement: each placement is a block positioned
 * by its start/length over the loop length. (Editing - drag/move/split - lands in
 * the next commit, when this gains its own ruler + zoom.)
 */
/** A placement block: position + label, shared by both track kinds. */
function Block({
  name,
  left,
  width,
  children,
}: {
  name?: string;
  left: number;
  width: number;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="absolute top-2 bottom-2 rounded bg-card border border-line border-t-2 border-t-you overflow-hidden"
      style={{ left: `${left}%`, width: `${width}%` }}
      title={name}
    >
      <div className="absolute inset-0 bg-you/15" />
      {children}
      <span className="absolute left-1.5 top-1 font-mono text-[9px] text-muted truncate max-w-full pr-1">
        {name}
      </span>
    </div>
  );
}

/** An instrument placement: a mini note summary of the clip, windowed to the placement. */
function InstrumentPlacement({
  store,
  name,
  placement,
  lengthBeats,
}: {
  store: ClipStore;
  name?: string;
  placement: Placement;
  lengthBeats: number;
}) {
  const clip = useClip(store);
  const notes = clip.notes.filter(
    (n) =>
      n.start >= placement.offset &&
      n.start < placement.offset + placement.length,
  );
  const pitches = notes.map((n) => n.pitch);
  const lo = pitches.length ? Math.min(...pitches) : 48;
  const hi = pitches.length ? Math.max(...pitches) : 72;
  const span = Math.max(1, hi - lo);
  return (
    <Block
      name={name}
      left={(placement.startBeat / lengthBeats) * 100}
      width={Math.max(1, (placement.length / lengthBeats) * 100)}
    >
      {notes.map((n) => (
        <div
          key={n.id}
          className="absolute h-0.5 rounded-[1px] bg-you/85"
          style={{
            left: `${((n.start - placement.offset) / placement.length) * 100}%`,
            width: `${Math.max(1.5, (n.length / placement.length) * 100)}%`,
            bottom: `${((n.pitch - lo) / span) * 60 + 18}%`,
          }}
        />
      ))}
    </Block>
  );
}

/**
 * Read-only preview of a track's arrangement: each placement is a block positioned
 * by its start/length over the loop length, with a mini note summary for instrument
 * clips. (Editing - drag/move/split - lands in the next commit, with its own ruler.)
 */
function LaneClips({
  track,
  lengthBeats,
}: {
  track: Track;
  lengthBeats: number;
}) {
  if (track.kind === "instrument") {
    return (
      <>
        {track.placements.map((p) => {
          const clip = track.clips.find((c) => c.id === p.clipId);
          if (!clip) return null;
          return (
            <InstrumentPlacement
              key={p.id}
              store={clip.store}
              name={clip.name}
              placement={p}
              lengthBeats={lengthBeats}
            />
          );
        })}
      </>
    );
  }
  return (
    <>
      {track.placements.map((p) => {
        const clip = track.clips.find((c) => c.id === p.clipId);
        return (
          <Block
            key={p.id}
            name={clip?.name}
            left={(p.startBeat / lengthBeats) * 100}
            width={Math.max(1, (p.length / lengthBeats) * 100)}
          />
        );
      })}
    </>
  );
}

function GroupHeader({
  group,
  depth,
  projectStore,
  dispatch,
}: {
  group: GroupMeta;
  depth: number;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  return (
    <div
      className={`${ROW} flex items-center gap-2 pr-2.5 border-b border-line bg-center`}
      style={{ paddingLeft: 10 + depth * INDENT }}
    >
      <button
        type="button"
        aria-expanded={!group.collapsed}
        title={group.collapsed ? "Expand group" : "Collapse group"}
        onClick={() =>
          projectStore.setGroupCollapsed(group.id, !group.collapsed)
        }
        className="w-3.5 text-[9px] text-muted cursor-pointer shrink-0"
      >
        {group.collapsed ? "▸" : "▾"}
      </button>
      <span className="font-mono text-[11px] tracking-wide uppercase text-bright flex-1 min-w-0 truncate">
        {group.name}
      </span>
      <button
        type="button"
        title={group.muted ? "Unmute group" : "Mute group"}
        onClick={() =>
          dispatch({ type: "setGroup", groupId: group.id, muted: !group.muted })
        }
        className={`font-mono w-6 h-6 rounded-md border text-xs cursor-pointer shrink-0 ${
          group.muted
            ? "border-claude text-claude"
            : "border-line bg-card text-ink"
        }`}
      >
        M
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={group.volume}
        title="Group volume"
        onChange={(e) =>
          dispatch({
            type: "setGroup",
            groupId: group.id,
            volume: Number(e.target.value),
          })
        }
        className="w-12 shrink-0"
      />
      <button
        type="button"
        title="Remove group and its contents"
        onClick={() => dispatch({ type: "removeGroup", groupId: group.id })}
        className="font-mono w-6 h-6 rounded-md border border-line bg-card text-ink cursor-pointer shrink-0"
      >
        ×
      </button>
    </div>
  );
}

function TrackHeader({
  track,
  depth,
  selected,
  projectStore,
  dispatch,
}: {
  track: TrackMeta;
  depth: number;
  selected: boolean;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  return (
    <div
      onClick={() => projectStore.selectTrack(track.id)}
      className={`${ROW} flex items-center gap-2 pr-2.5 border-b border-line-soft cursor-pointer ${
        selected
          ? "bg-you/10 shadow-[inset_3px_0_0_var(--color-you)]"
          : "bg-panel"
      }`}
      style={{ paddingLeft: 10 + depth * INDENT }}
    >
      <button
        type="button"
        title={track.muted ? "Unmute" : "Mute"}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({
            type: "setTrack",
            trackId: track.id,
            muted: !track.muted,
          });
        }}
        className={`font-mono w-6 h-6 rounded-md border text-xs cursor-pointer shrink-0 ${
          track.muted
            ? "border-claude text-claude"
            : "border-line bg-card text-ink"
        }`}
      >
        M
      </button>
      <span className="font-mono text-[13px] text-bright flex-1 min-w-0 truncate">
        {track.name}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={track.volume}
        title="Volume"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) =>
          dispatch({
            type: "setTrack",
            trackId: track.id,
            volume: Number(e.target.value),
          })
        }
        className="w-14 shrink-0"
      />
      <button
        type="button"
        title="Remove track"
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: "removeTrack", trackId: track.id });
        }}
        className="font-mono w-6 h-6 rounded-md border border-line bg-card text-ink cursor-pointer shrink-0"
      >
        ×
      </button>
    </div>
  );
}

export function ArrangementTimeline({
  projectStore,
  scheduler,
  dispatch,
  isPlaying,
  started,
}: {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  dispatch: Dispatch;
  isPlaying: boolean;
  started: boolean;
}) {
  const project = useProject(projectStore);
  const playheadRef = useRef<HTMLDivElement>(null);
  const lengthBeats = project.lengthBeats;
  const rows = flattenRows(project.groups, project.tracks);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = playheadRef.current;
      if (el) {
        el.style.left = `${((scheduler.getPositionBeats() % lengthBeats) / lengthBeats) * 100}%`;
        el.style.opacity = scheduler.isPlaying ? "1" : "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scheduler, lengthBeats]);

  return (
    <div className="[grid-area:timeline] bg-ground border-t border-line flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-3.5 py-1.5 border-b border-line bg-rail">
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">
          Arrangement
        </span>
        <button
          type="button"
          onClick={() => dispatch({ type: "createGroup", id: newGroupId() })}
          title="Add a top-level group"
          className="font-mono text-[10px] tracking-wide text-muted border border-line rounded px-1.5 py-0.5 cursor-pointer hover:text-ink"
        >
          + Group
        </button>
        <span className="w-px h-5 bg-line shrink-0" />
        <TransportBar
          projectStore={projectStore}
          scheduler={scheduler}
          dispatch={dispatch}
          isPlaying={isPlaying}
          started={started}
        />
        <span className="ml-auto font-mono text-[10px] text-faint tracking-[0.4em]">
          1&nbsp;&nbsp;2&nbsp;&nbsp;3&nbsp;&nbsp;4
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 grid place-items-center text-muted text-sm p-5">
          No tracks yet. Add an instrument from the library.
        </div>
      ) : (
        <div className="grid grid-cols-[220px_1fr] flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col border-r border-line">
            {rows.map((row) =>
              row.kind === "group" ? (
                <GroupHeader
                  key={row.group.id}
                  group={row.group}
                  depth={row.depth}
                  projectStore={projectStore}
                  dispatch={dispatch}
                />
              ) : (
                <TrackHeader
                  key={row.track.id}
                  track={row.track}
                  depth={row.depth}
                  selected={row.track.id === project.selectedTrackId}
                  projectStore={projectStore}
                  dispatch={dispatch}
                />
              ),
            )}
          </div>

          <div className="relative flex flex-col">
            {rows.map((row) => {
              if (row.kind === "group") {
                return (
                  <div
                    key={row.group.id}
                    className={`${ROW} border-b border-line bg-center/40`}
                  />
                );
              }
              const meta = row.track;
              const track = projectStore.getTrack(meta.id);
              return (
                <div
                  key={meta.id}
                  className={`${ROW} relative border-b border-line-soft lane-grid`}
                >
                  {track && (
                    <LaneClips track={track} lengthBeats={lengthBeats} />
                  )}
                </div>
              );
            })}
            <div
              ref={playheadRef}
              className="absolute top-0 bottom-0 w-px bg-you pointer-events-none opacity-0 z-5"
            />
          </div>
        </div>
      )}
    </div>
  );
}

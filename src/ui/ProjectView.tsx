/**
 * The Project view (a library-rail view): a project explorer for the current project
 * - a tree of groups and their tracks. Clicking a track selects it (which drives the
 * timeline and workbench, since selection is one shared value); expanding a track
 * reveals compact mixer controls (mute / solo / gain; sends are a future placeholder).
 * The tree is a navigator, so deeper editing stays in the workbench. Switching /
 * creating projects lives in the panel header's menu (LibraryHeader).
 *
 * Selection is a direct store call (not an edit); mute/solo/gain go through the edit
 * log (undoable). The tree re-renders from `useProject` on any structural change.
 */
import { useEffect, useRef, useState } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { Dispatch } from "../audio/commands/types";
import type { GroupMeta, TrackMeta } from "../audio/project/types";
import { useProject } from "../audio/project/useProject";
import { newTrackId } from "../audio/commands/ids";
import { EMPTY_INSTRUMENT } from "../audio/instruments/catalog";
import { Fader, MuteSolo } from "./MixerControls";
import { Menu } from "./Menu";

/** One flattened tree row: a group header or a track, tagged with its depth. */
type Row = { kind: "group"; group: GroupMeta; depth: number } | { kind: "track"; track: TrackMeta; depth: number };

/** Depth-first flatten of the group/track forest (parentId links), honouring collapse. */
function flattenTree(groups: GroupMeta[], tracks: TrackMeta[], collapsed: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const group of groups.filter((candidate) => candidate.parentId === parentId)) {
      rows.push({ kind: "group", group, depth });
      if (collapsed.has(group.id)) continue;
      walk(group.id, depth + 1); // subgroups first, then this group's tracks
      for (const track of tracks.filter((candidate) => candidate.parentId === group.id))
        rows.push({ kind: "track", track, depth: depth + 1 });
    }
  };
  walk(null, 0);
  // Surface any orphan tracks (parent group missing) so nothing is hidden.
  const groupIds = new Set(groups.map((group) => group.id));
  for (const track of tracks.filter((track) => !groupIds.has(track.parentId)))
    rows.push({ kind: "track", track, depth: 0 });
  return rows;
}

/** The expandable per-track detail: compact mixer controls (sends are future). */
function TrackDetail({ track, dispatch }: { track: TrackMeta; dispatch: Dispatch }) {
  return (
    <div className="flex flex-col gap-2 pr-3 pb-2 pl-9 text-[11px] text-muted">
      <div className="flex items-center gap-2">
        <MuteSolo
          muted={track.muted}
          solo={track.solo}
          onMute={() => dispatch({ type: "setTrack", trackId: track.id, muted: !track.muted })}
          onSolo={() => dispatch({ type: "setTrack", trackId: track.id, solo: !track.solo })}
        />
        <span className="ml-1 w-8 shrink-0 font-mono text-faint">gain</span>
        <Fader
          value={track.volume}
          title="Track gain"
          width={96}
          onChange={(volume) => dispatch({ type: "setTrack", trackId: track.id, volume })}
        />
        <span className="w-8 shrink-0 text-right font-mono text-faint">{Math.round(track.volume * 100)}</span>
      </div>
      <div className="flex items-center gap-2 text-faint/70">
        <span className="font-mono">sends</span>
        <span className="italic">coming soon</span>
      </div>
    </div>
  );
}

export function ProjectView({ projectStore, dispatch }: { projectStore: ProjectStore; dispatch: Dispatch }) {
  const project = useProject(projectStore);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [expandedTracks, setExpandedTracks] = useState<Set<string>>(() => new Set());
  const selectedRowRef = useRef<HTMLDivElement>(null);

  const selectedId = project.selectedTrackId;
  const rows = flattenTree(project.groups, project.tracks, collapsedGroups);

  // Keep the selected track visible: when selection changes (e.g. from a timeline
  // click while this view is open), scroll its row into view.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto py-1">
      {rows.map((row) => {
        const indent = { paddingLeft: `${8 + row.depth * 14}px` };
        if (row.kind === "group") {
          const open = !collapsedGroups.has(row.group.id);
          return (
            <div key={`g-${row.group.id}`} className="group/grp flex items-center pr-2 hover:bg-you/10">
              <button
                type="button"
                onClick={() => setCollapsedGroups((set) => toggle(set, row.group.id))}
                style={indent}
                className="flex items-center gap-1.5 flex-1 min-w-0 text-left pr-2 py-1 text-[11.5px] font-semibold text-muted hover:text-ink cursor-pointer"
              >
                <span className="w-2.5 text-center text-[16px] text-muted">{open ? "▾" : "▸"}</span>
                <span className="truncate uppercase tracking-wide">{row.group.name}</span>
              </button>
              <div className="shrink-0 opacity-60 group-hover/grp:opacity-100">
                <Menu
                  align="left"
                  trigger="+"
                  label={`Add a track to ${row.group.name}`}
                  triggerClassName="w-5 text-center text-[14px] leading-none text-faint hover:text-bright cursor-pointer"
                  items={[
                    {
                      label: "New MIDI track",
                      onClick: () =>
                        dispatch({
                          type: "createTrack",
                          instrumentType: EMPTY_INSTRUMENT,
                          id: newTrackId(),
                          groupId: row.group.id,
                        }),
                    },
                    {
                      label: "New audio track",
                      onClick: () => dispatch({ type: "createAudioTrack", id: newTrackId(), groupId: row.group.id }),
                    },
                  ]}
                />
              </div>
            </div>
          );
        }

        const track = row.track;
        const selected = track.id === selectedId;
        const expanded = expandedTracks.has(track.id);
        const kind =
          track.kind === "audio" ? "audio" : track.instrumentType === EMPTY_INSTRUMENT ? "empty" : track.instrumentType;
        return (
          <div key={`t-${track.id}`} ref={selected ? selectedRowRef : undefined}>
            <div
              className={`group flex items-center pr-2 cursor-pointer ${
                selected ? "bg-you/10 shadow-[inset_2px_0_0_var(--color-you)]" : "hover:bg-you/10"
              }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedTracks((set) => toggle(set, track.id));
                }}
                style={indent}
                aria-label={expanded ? "Collapse track" : "Expand track"}
                className="shrink-0 w-4 text-center text-[10px] text-faint hover:text-ink py-1.5 cursor-pointer"
              >
                {expanded ? "▾" : "▸"}
              </button>
              <button
                type="button"
                data-testid="tree-track"
                onClick={() => projectStore.selectTrack(track.id)}
                title={track.name}
                className="flex items-center gap-2 flex-1 min-w-0 text-left py-1.5 pr-2 cursor-pointer"
              >
                <span
                  aria-hidden="true"
                  className={`w-1.75 h-1.75 shrink-0 ${track.kind === "audio" ? "rounded-full" : "rounded-sm"} ${
                    selected ? "bg-you" : "bg-line"
                  }`}
                />
                <span className={`truncate text-[12.5px] ${selected ? "text-bright" : "text-ink"}`}>{track.name}</span>
                {track.muted && <span className="shrink-0 font-mono text-[9px] text-claude">M</span>}
                {track.solo && <span className="shrink-0 font-mono text-[9px] text-warn">S</span>}
                <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-faint">
                  {kind}
                </span>
              </button>
            </div>
            {expanded && <TrackDetail track={track} dispatch={dispatch} />}
          </div>
        );
      })}
    </div>
  );
}

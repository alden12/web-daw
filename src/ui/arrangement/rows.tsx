/**
 * The arrangement's left-column rows: a `GroupHeader` (collapse / mute-solo /
 * volume / actions) and, for tracks, a `TrackRow` that pairs a sticky `TrackHeader`
 * with its `Lane`. Selection, arm state, and geometry come from the timeline shell
 * as props; these just render and dispatch.
 */
import type { GroupMeta, TrackMeta, Placement } from "../../audio/project/types";
import type { ProjectStore } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { newTrackId } from "../../audio/commands/ids";
import { trackKey } from "../../audio/commands/authorship";
import { voiceOf } from "../authorVoice";
import { EMPTY_INSTRUMENT } from "../../audio/instruments/catalog";
import { Menu } from "../Menu";
import { InlineRename } from "../InlineRename";
import { Fader, MuteSolo } from "../MixerControls";
import { Lane } from "./Lane";
import { ROW, GUTTER, GUTTER_PAD, INDENT, type Selection } from "./shared";

export function GroupHeader({
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
      className={`${ROW} flex items-center gap-2 pr-2.5 border-b border-r border-line bg-ground`}
      style={{ paddingLeft: GUTTER_PAD + depth * INDENT }}
    >
      {/* Leading gutter (shared with track rows) holds the collapse arrow, so the
          mute/solo controls line up between group and track headers. */}
      <button
        type="button"
        aria-expanded={!group.collapsed}
        title={group.collapsed ? "Expand group" : "Collapse group"}
        onClick={() => projectStore.setGroupCollapsed(group.id, !group.collapsed)}
        className={`${GUTTER} flex items-center justify-center text-2xl leading-none text-muted cursor-pointer`}
      >
        {group.collapsed ? "▸" : "▾"}
      </button>
      <MuteSolo
        muted={group.muted}
        solo={group.solo}
        onMute={() => dispatch({ type: "setGroup", groupId: group.id, muted: !group.muted })}
        onSolo={() => dispatch({ type: "setGroup", groupId: group.id, solo: !group.solo })}
      />
      <InlineRename
        value={group.name}
        onCommit={(name) => dispatch({ type: "setGroup", groupId: group.id, name })}
        className="font-mono text-[11px] tracking-wide uppercase text-bright flex-1 min-w-0"
      />
      <Fader
        value={group.volume}
        title="Group volume"
        width={48}
        onChange={(v) => dispatch({ type: "setGroup", groupId: group.id, volume: v })}
      />
      <Menu
        label="Group actions"
        items={[
          {
            label: "Add MIDI track",
            onClick: () =>
              dispatch({
                type: "createTrack",
                instrumentType: EMPTY_INSTRUMENT,
                id: newTrackId(),
                groupId: group.id,
              }),
          },
          {
            label: "Add audio track",
            onClick: () => dispatch({ type: "createAudioTrack", id: newTrackId(), groupId: group.id }),
          },
          {
            label: "Delete group and its contents",
            danger: true,
            onClick: () => dispatch({ type: "removeGroup", groupId: group.id }),
          },
        ]}
      />
    </div>
  );
}

function TrackHeader({
  track,
  depth,
  selected,
  armed,
  onArmToggle,
  projectStore,
  dispatch,
}: {
  track: TrackMeta;
  depth: number;
  selected: boolean;
  /** Audio tracks only: armed to receive the next recorded take. */
  armed: boolean;
  onArmToggle: () => void;
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  // Always-on left accent in the track's last-editor colour (a live CSS var, so it recolours with
  // the swatch). Selection is carried by the background tint, so the two cues don't fight one edge.
  const accent = `var(--color-${voiceOf(projectStore.authorOf(trackKey(track.id)) ?? "you")})`;
  return (
    <div
      onClick={() => projectStore.selectTrack(track.id)}
      className={`${ROW} flex items-center gap-2 pr-2.5 border-b border-r border-line-soft cursor-pointer ${
        selected ? "bg-[color-mix(in_oklab,var(--color-you)_12%,var(--color-panel))]" : "bg-panel"
      }`}
      style={{ paddingLeft: GUTTER_PAD + depth * INDENT, boxShadow: `inset 3px 0 0 ${accent}` }}
    >
      {/* Leading gutter (same slot as a group's collapse arrow): the audio
          record-enable lives here so mute/solo align with group rows. */}
      <div className={`${GUTTER} flex items-center justify-center`}>
        {track.kind === "audio" && (
          <button
            type="button"
            aria-label="Record enable"
            aria-pressed={armed}
            title={armed ? "Armed for recording" : "Arm for recording"}
            onClick={(e) => {
              e.stopPropagation();
              onArmToggle();
            }}
            className={`w-2.5 h-2.5 rounded-full border cursor-pointer ${
              armed ? "bg-claude border-claude" : "border-muted hover:border-claude"
            }`}
          />
        )}
      </div>
      <MuteSolo
        muted={track.muted}
        solo={track.solo}
        onMute={() => dispatch({ type: "setTrack", trackId: track.id, muted: !track.muted })}
        onSolo={() => dispatch({ type: "setTrack", trackId: track.id, solo: !track.solo })}
      />
      <InlineRename
        value={track.name}
        onCommit={(name) => dispatch({ type: "setTrack", trackId: track.id, name })}
        className="font-mono text-[13px] text-bright flex-1 min-w-0"
      />
      <Fader
        value={track.volume}
        title="Volume"
        width={56}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onChange={(v) => dispatch({ type: "setTrack", trackId: track.id, volume: v })}
      />
      <Menu
        label="Track actions"
        items={[
          {
            label: "Delete track",
            danger: true,
            onClick: () => dispatch({ type: "removeTrack", trackId: track.id }),
          },
        ]}
      />
    </div>
  );
}

export function TrackRow({
  meta,
  depth,
  selectedTrack,
  armed,
  onArmToggle,
  projectStore,
  dispatch,
  headerW,
  laneWidth,
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
}: {
  meta: TrackMeta;
  depth: number;
  selectedTrack: boolean;
  armed: boolean;
  onArmToggle: () => void;
  projectStore: ProjectStore;
  dispatch: Dispatch;
  headerW: number;
  laneWidth: number;
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
}) {
  const track = projectStore.getTrack(meta.id);
  return (
    <div className="flex" data-track-id={meta.id}>
      <div className="sticky left-0 z-10 shrink-0" style={{ width: headerW }}>
        <TrackHeader
          track={meta}
          depth={depth}
          selected={selectedTrack}
          armed={armed}
          onArmToggle={onArmToggle}
          projectStore={projectStore}
          dispatch={dispatch}
        />
      </div>
      {track ? (
        <Lane
          track={track}
          width={laneWidth}
          pxPerBeat={pxPerBeat}
          beatsPerBar={beatsPerBar}
          snapOn={snapOn}
          snapDiv={snapDiv}
          selection={selection}
          markerBeat={markerBeat}
          dropBeat={dropBeat}
          onSelect={onSelect}
          onMark={onMark}
          onHover={onHover}
          dispatch={dispatch}
          projectStore={projectStore}
        />
      ) : (
        <div className={`${ROW} border-b border-line-soft`} style={{ width: laneWidth }} />
      )}
    </div>
  );
}

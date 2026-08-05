/**
 * The contract both shells render against (MOBILE-1: "swap the shell, not the app").
 *
 * `AppShell` owns the stores, the engine and every effect; a shell is a pure layout
 * over this one prop bag, so the desktop grid and the touch shell are two projections
 * of the same state rather than two versions of the app. Anything a shell may not
 * differ on lives here; anything that is pure geometry (panel widths, the timeline
 * split) stays private to the shell that has it.
 */
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { Recorder } from "../../audio/recording/recorder";
import type { LiveNotes } from "../../audio/live/liveNotes";
import type { EditLog } from "../../audio/commands/editLog";
import type { VersionStore } from "../../audio/commands/history";
import type { Dispatch } from "../../audio/commands/types";
import type { McpStatus } from "../../audio/mcp/bridge";
import type { WsStatus } from "../../contract/client";
import type { LibraryView } from "../ActivityRail";

export interface ShellProps {
  projectStore: ProjectStore;
  scheduler: Scheduler;
  recorder: Recorder;
  editLog: EditLog;
  versionStore: VersionStore;
  dispatch: Dispatch;
  /**
   * Live note input, routed to the selected track's instrument *and* the recorder. The
   * computer keyboard and hardware MIDI reach it from `AppShell`; the touch shell's pads
   * (MOBILE-6) need it too, and they are the only way to play a note on a phone.
   */
  liveNotes: LiveNotes;
  /** The track the workbench edits; `undefined` shows the workbench's empty state. */
  selectedTrack: Track | undefined;
  isPlaying: boolean;
  /** Audio is unlocked (the start gesture happened); until then the transport is inert. */
  started: boolean;
  mcpStatus: McpStatus;
  /** `null` in local (no-sync) mode. */
  syncStatus: WsStatus | null;
  /** Whether a BYOK key is set; drives the agent panel's empty state. */
  hasApiKey: boolean;

  /** The single library view on show, and the search box that can jump to "search". */
  libView: LibraryView;
  onSelectView: (view: LibraryView) => void;
  search: string;
  onSearch: (query: string) => void;

  /**
   * Panel collapse lives here rather than in the desktop shell because `onSelectView`
   * and `onSearch` both expand the library panel as a side effect, and those live with
   * the view state in `AppShell`. The touch shell ignores both flags - it shows one
   * panel at a time, so there is nothing to collapse.
   */
  libCollapsed: boolean;
  onToggleLibCollapsed: () => void;
  agentCollapsed: boolean;
  onSetAgentCollapsed: (collapsed: boolean) => void;

  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onOpenShare: (projectId: string, projectName: string) => void;
}

/**
 * Sync-connection UI: a small status chip (mirrors the MCP chip in the workbench status bar) and a
 * tiered offline banner. Both are projections of the transport's `WsStatus` (src/contract/client.ts).
 *
 * The banner tiers by whether the current project is collaborative: a solo project offline is benign
 * (edits are saved locally and flush on reconnect), so it gets a quiet note; a shared project offline
 * carries reconnect-conflict risk (a teammate may edit the same thing meanwhile), so it gets a louder
 * warning. Only shown while genuinely offline - the idle/hidden suspend is a normal paused state.
 */
import type { WsStatus } from "../contract/client";

const DOT: Record<WsStatus, string> = {
  connecting: "bg-faint animate-pulse",
  online: "bg-good",
  offline: "bg-warn",
  idle: "bg-faint",
};

const LABEL: Record<WsStatus, string> = {
  connecting: "Connecting…",
  online: "Synced",
  offline: "Offline",
  idle: "Idle",
};

const TITLE: Record<WsStatus, string> = {
  connecting: "Connecting to the sync server…",
  online: "Connected and synced",
  offline: "Offline - reconnecting. Edits are saved locally.",
  idle: "Paused while idle - reconnects on activity",
};

/** The compact connection chip for the workbench status bar. */
export function SyncChip({ status }: { status: WsStatus }): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted" title={TITLE[status]}>
      <span className={`w-2 h-2 rounded-full ${DOT[status]}`} />
      {LABEL[status]}
    </span>
  );
}

/** A full-screen load veil shown until the project bundle is ready (fast from the local cache, or a
 *  round-trip to the server on a first open). Matches the StartDialog overlay treatment. */
export function LoadingOverlay(): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-ground/90">
      <span
        className="w-8 h-8 rounded-full border-2 border-faint border-t-transparent animate-spin"
        aria-hidden="true"
      />
      <span className="font-mono text-[12px] text-muted">Loading project…</span>
    </div>
  );
}

/** The offline banner, tiered by whether the current project is shared. Render only while offline. */
export function OfflineBanner({ shared }: { shared: boolean }): React.ReactElement {
  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 px-3 py-1.5 text-[12px] font-medium ${
        shared ? "bg-warn/20 text-warn" : "bg-panel text-muted"
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${shared ? "bg-warn" : "bg-faint"}`} />
      {shared
        ? "Offline - edits to this shared project may conflict when you reconnect."
        : "Offline - reconnecting. Your edits are saved locally."}
    </div>
  );
}

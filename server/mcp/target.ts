/**
 * What the MCP tools read and edit through, so the same tools can drive two very different things
 * (AGENT-28): a browser tab over a local WebSocket, where the tab owns the project and the audio, and
 * a project stored on the sync service, where nobody is listening but the room.
 */
import type { ProjectStore } from "../../src/audio/project/projectStore";
import type { HistoryMethod, PatchMethod, ServerToBrowser } from "../../src/audio/mcp/protocol";

/** A round-trip's answer: the tab's `historyReply` / `patchReply`, or the hosted equivalent. */
export type Reply = { ok: boolean; result?: unknown; error?: string };

export interface DawTarget {
  /** The project as the tools should read it. A getter, because the hosted target swaps it per call. */
  readonly project: ProjectStore;
  /**
   * Hand a message to whatever applies it. Durable ones are edit commands; the rest (selection, live
   * notes, transport, feed notes) are the tab's business. False when nothing could take it.
   */
  send(message: ServerToBrowser): boolean;
  /** Whether `send` has somewhere to go right now. */
  connected(): boolean;
  /** Version history, which the tab keeps and the hosted target answers from the log. */
  requestHistory(method: HistoryMethod, params?: Record<string, unknown>): Promise<Reply>;
  /** The patch library. */
  requestPatch(method: PatchMethod, params?: Record<string, unknown>): Promise<Reply>;
}
